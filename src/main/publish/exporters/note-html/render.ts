/**
 * Markdown → standalone-HTML rendering for the note-html exporter (#248).
 *
 * Separate markdown-it instance from the Preview pane — Preview emits
 * interactive DOM (data-attrs the click handler hooks) that has no
 * meaning in an exported file. Here the wiki-link rule emits real HTML:
 * an anchor when the link policy resolves a href, an italicised title
 * otherwise. Images get inlined as base64 when the asset policy asks for
 * it, so the result is a single self-contained artifact.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
// markdown-it 15 ships its own types: the default export is a callable value, so
// the instance type is imported as the named `MarkdownIt` type (aliased here to
// avoid clashing with the value import).
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import hljs from 'highlight.js';
import { buildLinkResolverContext } from '../../link-resolver';
import { installMath } from '../../../../shared/markdown/math-plugin';
import { renderVegaBlocks } from '../../vega-render';
import { renderYouTubeBlocks } from '../../youtube-render';
import { resolveTransclusions } from '../../transclusion-resolve';
import { linkifyLocalMedia } from '../../media-export';
import type { ExportPlanFile, ExportPlan } from '../../types';
import type { CitationRenderer } from '../../csl';
import { escapeHtmlFull as escapeHtml, escapeHtmlFull as escapeAttr } from '../../../../shared/text-escape';
import { stripFrontmatter } from '../../../../shared/frontmatter-strip';

/**
 * Returns the rendered body HTML — just the article content, no `<html>`
 * shell. The optional `renderer` overrides the one the cite rule would
 * otherwise pull off `plan.citations`; pass it when the caller wants
 * to collect cited ids across multiple `renderNoteBody` invocations
 * (e.g. a bundle renderer aggregating a single References section).
 */
export async function renderNoteBody(
  file: ExportPlanFile,
  plan: ExportPlan,
  renderer?: CitationRenderer,
): Promise<string> {
  const md = buildMd(plan, renderer, file.relativePath);
  // #906 — inline `![[note]]` / `![[note#H]]` / `![[note^block]]` embeds before
  // anything else, so the embedded content's own charts / links get processed
  // by the passes below. Resolved against the export's note set (in memory).
  const inlined = resolveTransclusions(stripFrontmatter(file.content), file.relativePath, plan.inputs);
  // #831 — pre-render ```vega-lite / ```vega fences to static SVG images
  // before markdown rendering (md.render is sync; vega's toSVG is async).
  // The result is `<img>` markdown, so it survives the `html: false` instance.
  const withCharts = await renderVegaBlocks(inlined, { rootPath: plan.rootPath });
  // #904 — degrade `youtube` fences to a linked thumbnail (an `<img>` in a
  // link, so it survives `html: false`). Sync; order vs. Vega is irrelevant —
  // the two operate on disjoint fence languages.
  const withYouTube = renderYouTubeBlocks(withCharts);
  // #908 — degrade local audio/video image-refs to links (inlining media into a
  // single-file export isn't sensible; keep the reference).
  const bodyMarkdown = linkifyLocalMedia(withYouTube);
  return md.render(bodyMarkdown);
}

function buildMd(plan: ExportPlan, renderer?: CitationRenderer, fromPath?: string): MarkdownItInstance {
  const md = new MarkdownIt({
    html: false,        // drop raw HTML in notes — export is for trust-limited readers
    linkify: true,
    typographer: true,
    breaks: false,
    highlight(str: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
          return `<pre><code class="hljs language-${escapeAttr(lang)}">${out}</code></pre>`;
        } catch { /* fall through */ }
      }
      return `<pre><code>${escapeHtml(str)}</code></pre>`;
    },
  });
  // Allow `data:image/svg+xml` image URIs (#831). markdown-it's default
  // validateLink whitelists only gif/png/jpeg/webp data URIs (SVG can carry
  // <script>), but an SVG referenced from an `<img src>` is rendered in a
  // non-scripting context — the script never runs — so it's safe, and it's
  // how the export pipeline embeds rendered Vega charts.
  const defaultValidateLink = md.validateLink.bind(md);
  md.validateLink = (url: string): boolean =>
    url.trim().toLowerCase().startsWith('data:image/svg+xml') || defaultValidateLink(url);
  md.use(footnote);
  // `$…$` / `$$…$$` → KaTeX HTML (#327). Same plugin Preview uses so
  // the export and the editor preview render math identically.
  installMath(md);
  installWikiLinkRule(md, plan, fromPath);
  installTagRule(md);
  installCiteStubRule(md, plan, renderer);
  return md;
}

/**
 * Wiki-link rule: matches `[[target]]`, `[[target|display]]`, and typed
 * prefixes (`[[references::target]]`). Emits HTML per the plan's
 * linkPolicy. `[[cite::…]]` and `[[quote::…]]` are left to the cite
 * stub rule (below).
 */
function installWikiLinkRule(md: MarkdownItInstance, plan: ExportPlan, fromPath?: string): void {
  const ctx = buildLinkResolverContext(plan);
  // Directory of the note being rendered. `follow-to-file` hrefs are made
  // relative to it so a link resolves correctly from a nested page — a
  // root-relative href like `fm/x.html` doubles the folder when the page
  // itself lives under `fm/` (#252 follow-up: multi-page sites mirror the
  // note folder tree). Absent fromPath keeps the old root-relative shape.
  const fromDir = fromPath ? path.posix.dirname(fromPath) : null;

  md.inline.ruler.before('emphasis', 'wiki_link', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const close = src.indexOf(']]', pos + 2);
    if (close < 0) return false;
    const inner = src.slice(pos + 2, close);
    // Reject nested [[ — a stray `[[` elsewhere shouldn't swallow a run.
    if (inner.includes('[[')) return false;
    if (silent) { state.pos = close + 2; return true; }

    if (/^(cite|quote)::/i.test(inner)) {
      // Cite / quote handled by the stub rule; let it fall through.
      return false;
    }

    // Split out `display` after the pipe.
    const pipe = inner.indexOf('|');
    const targetRaw = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const display = pipe >= 0 ? inner.slice(pipe + 1).trim() : null;
    const untyped = targetRaw.replace(/^[a-z][a-z0-9_]*::/i, '').trim();
    const hashIdx = untyped.indexOf('#');
    const target = hashIdx >= 0 ? untyped.slice(0, hashIdx).trim() : untyped;
    const anchor = hashIdx >= 0 ? untyped.slice(hashIdx + 1).trim() : null;

    const title = findTitle(target, ctx.titleByTarget);

    const token = state.push('html_inline', '', 0);
    if (ctx.linkPolicy === 'follow-to-file') {
      const asMd = target.endsWith('.md') ? target : `${target}.md`;
      if (ctx.includedPaths.has(asMd)) {
        const label = display ?? title ?? target;
        const targetHtml = asMd.replace(/\.md$/, '.html');
        const rel = relativeHref(fromDir, targetHtml);
        const href = anchor ? `${rel}#${anchor}` : rel;
        token.content = `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`;
      } else {
        token.content = `<em class="wikilink-unresolved">${escapeHtml(title ?? display ?? target)}</em>`;
      }
    } else if (ctx.linkPolicy === 'inline-title') {
      token.content = `<em>${escapeHtml(title ?? display ?? target)}</em>`;
    } else {
      // 'drop'
      token.content = escapeHtml(display ?? title ?? target);
    }

    state.pos = close + 2;
    return true;
  });
}

/**
 * A note-relative href for a `follow-to-file` link. `fromDir` is the directory
 * of the linking note (null → single-file / flat output, keep root-relative).
 * `path.posix.relative` gives `../` climbs and same-dir shortening; an empty
 * result (self-link) falls back to the bare filename.
 */
function relativeHref(fromDir: string | null, targetHtml: string): string {
  if (fromDir === null) return targetHtml;
  const rel = path.posix.relative(fromDir, targetHtml);
  return rel === '' ? path.posix.basename(targetHtml) : rel;
}

/**
 * Strip interactive-only bits from the body:
 *   - `#tag` inline tags render as plain text (no click-to-filter handler
 *     when read standalone).
 *
 * Implemented as a cheap post-processing pass rather than a new rule so
 * we don't duplicate the Preview's tag grammar.
 */
function installTagRule(_md: MarkdownItInstance): void {
  // The existing Preview wraps `#tag` in a .note-tag span. For exports
  // we let markdown-it emit the raw `#tag` text — readers see it as
  // unstyled prose, which is the correct rendering outside the app.
  // No-op by design; keeping the hook so future per-rule work has a home.
}

/**
 * Cite / quote rule — resolves `[[cite::id]]` and `[[quote::id]]`
 * through a CSL renderer (#247). Precedence: explicit `renderer` arg
 * (when the caller owns the session for bibliography aggregation),
 * then `plan.citations.createRenderer()` at rule-install time. Without
 * either, falls back to a visible stub so nothing leaks raw wiki-link
 * syntax into the exported output.
 *
 * Consecutive cites separated only by whitespace are collected into a
 * single citation cluster (#298) — `[[cite::a]] [[cite::b]]` becomes
 * `(Foo 2020; Bar 2021)` instead of two adjacent parentheticals. The
 * merge is skipped when any id in the run is missing so each missing
 * marker stays visible in its original position.
 */
function installCiteStubRule(
  md: MarkdownItInstance,
  plan: ExportPlan,
  explicitRenderer?: CitationRenderer,
): void {
  const citations = plan.citations;
  const activeRenderer = explicitRenderer
    ?? (citations ? citations.createRenderer() : null);
  md.inline.ruler.after('wiki_link', 'cite_stub', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    const first = parseCiteAt(src, pos);
    if (!first) return false;
    if (silent) { state.pos = first.endPos; return true; }

    const items: ParsedCite[] = [first];
    let scanPos = first.endPos;
    while (true) {
      let p = scanPos;
      while (p < src.length && isInlineWhitespace(src.charCodeAt(p))) p++;
      const next = parseCiteAt(src, p);
      if (!next) break;
      items.push(next);
      scanPos = next.endPos;
    }

    const token = state.push('html_inline', '', 0);
    token.content = renderCiteRun(items, activeRenderer, citations);
    state.pos = scanPos;
    return true;
  });
}

interface ParsedCite {
  kind: 'cite' | 'quote';
  id: string;
  /** Alias-derived locator + label (#299). null when no parseable locator was supplied. */
  aliasLocator: ParsedLocator | null;
  endPos: number;
}

interface ParsedLocator {
  locator: string;
  label: string;
}

function parseCiteAt(src: string, pos: number): ParsedCite | null {
  if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return null;
  const close = src.indexOf(']]', pos + 2);
  if (close < 0) return null;
  const inner = src.slice(pos + 2, close);
  const m = inner.match(/^(cite|quote)::(.+)$/i);
  if (!m) return null;
  const rawTarget = m[2]!;
  const pipe = rawTarget.indexOf('|');
  const id = (pipe >= 0 ? rawTarget.slice(0, pipe) : rawTarget).trim();
  const alias = pipe >= 0 ? rawTarget.slice(pipe + 1).trim() : '';
  return {
    kind: m[1]!.toLowerCase() as 'cite' | 'quote',
    id,
    aliasLocator: parseLocatorAlias(alias),
    endPos: close + 2,
  };
}

/**
 * Map common locator-shaped aliases to CSL `{ locator, label }` (#299).
 *
 * Recognises bare page references (`42`, `42-45`, `iv-xii`), `p.` / `pp.`
 * prefixes, and the ten most-used CSL labels (chapter, section, figure,
 * table, note, paragraph, volume, line, verse, column). Anything else
 * returns null and the caller drops the alias silently — matches
 * wiki-link convention: an alias that doesn't parse as a locator is
 * display text, and citations don't have display text.
 */
export function parseLocatorAlias(alias: string): ParsedLocator | null {
  if (!alias) return null;
  // Match all hyphen-shaped dashes: ASCII '-', en-dash, em-dash, figure-dash.
  const RANGE = '[\\u2010-\\u2015\\-]';
  const PAGE_LIKE_RE = new RegExp(`^[0-9ivxlcdm]+(?:${RANGE}[0-9ivxlcdm]+)?$`, 'i');

  // Labelled form: "ch. 3", "chapter 3", "§ 4", "¶ 7".
  const labelled = alias.match(/^([A-Za-z§¶]+)\.?\s+(.+)$/);
  if (labelled) {
    const tag = labelled[1]!.toLowerCase();
    const value = labelled[2]!.trim();
    const label = LOCATOR_LABEL_BY_TAG[tag];
    if (label) {
      // For page labels, prefer the bare-number form: "pp. 42-45" → "42-45".
      // Other labels keep what's provided ("section 4.2", "ch. 3").
      return { locator: value, label };
    }
  }
  // Bare form: "42", "42-45", "iv-xii".
  if (PAGE_LIKE_RE.test(alias)) {
    return { locator: alias.trim(), label: 'page' };
  }
  return null;
}

/**
 * Common label aliases → canonical CSL locator label. Keep the keys
 * lowercased; matched case-insensitively. Page-y synonyms collapse to
 * 'page' since CSL has only one page-locator label.
 */
const LOCATOR_LABEL_BY_TAG: Record<string, string> = {
  p: 'page', pp: 'page', page: 'page', pages: 'page',
  ch: 'chapter', chap: 'chapter', chapter: 'chapter', chapters: 'chapter',
  sec: 'section', section: 'section', sections: 'section', '§': 'section',
  fig: 'figure', figure: 'figure', figures: 'figure',
  tbl: 'table', table: 'table', tables: 'table',
  n: 'note', note: 'note', notes: 'note',
  para: 'paragraph', paragraph: 'paragraph', paragraphs: 'paragraph', '¶': 'paragraph',
  vol: 'volume', volume: 'volume', volumes: 'volume',
  l: 'line', line: 'line', lines: 'line',
  v: 'verse', verse: 'verse', verses: 'verse',
  col: 'column', column: 'column', columns: 'column',
};

function isInlineWhitespace(code: number): boolean {
  return code === 0x20 /* space */ || code === 0x09 /* tab */ || code === 0x0a /* LF */ || code === 0x0d /* CR */;
}

function renderCiteRun(
  items: ParsedCite[],
  activeRenderer: CitationRenderer | null,
  citations: ExportPlan['citations'],
): string {
  if (!activeRenderer || !citations) {
    return items
      .map((item) => `<sup class="cite-stub" title="${escapeAttr(item.kind + ': ' + item.id)}">[${escapeHtml(item.id)}]</sup>`)
      .join(' ');
  }

  // Resolve each item to (sourceId, locator, label). Missing markers
  // preserve the original kind so users see "missing excerpt" vs
  // "missing: source-id". For locators (#299): an explicit alias
  // (`[[cite::id|p. 42]]`) wins; otherwise a quote falls back to the
  // excerpt's intrinsic page/range; bare cites have no locator.
  type Resolved =
    | { ok: true; sourceId: string; locator?: string | undefined; label?: string | undefined }
    | { ok: false; missingMarker: string };
  const resolved: Resolved[] = items.map((item) => {
    if (item.kind === 'quote') {
      const ex = citations.excerpts.get(item.id);
      if (!ex) return { ok: false, missingMarker: `<span class="csl-missing">[missing excerpt: ${escapeHtml(item.id)}]</span>` };
      if (!citations.items.has(ex.sourceId)) return { ok: false, missingMarker: `<span class="csl-missing">[missing: ${escapeHtml(ex.sourceId)}]</span>` };
      const locator = item.aliasLocator?.locator ?? ex.locator;
      const label = item.aliasLocator?.label;
      return { ok: true, sourceId: ex.sourceId, locator, label };
    }
    if (!citations.items.has(item.id)) return { ok: false, missingMarker: `<span class="csl-missing">[missing: ${escapeHtml(item.id)}]</span>` };
    return {
      ok: true,
      sourceId: item.id,
      locator: item.aliasLocator?.locator,
      label: item.aliasLocator?.label,
    };
  });

  // Any missing → render each item independently so missing markers
  // stay visible in their original positions. Single item → also
  // independent (no merge to perform).
  if (items.length === 1 || resolved.some((r) => !r.ok)) {
    return resolved
      .map((r) => (r.ok ? activeRenderer.renderCitation(r.sourceId, r.locator, r.label) : r.missingMarker))
      .join(' ');
  }

  // All items resolved → single merged cluster.
  return activeRenderer.renderCitationCluster(
    resolved.map((r) => {
      // Type narrowing: we proved every r is { ok: true } above.
      const ok = r as Extract<Resolved, { ok: true }>;
      return { id: ok.sourceId, locator: ok.locator, label: ok.label };
    }),
  );
}

// ── Asset inlining ─────────────────────────────────────────────────────────

/**
 * Walk the rendered HTML and inline every local `<img src="...">` as a
 * base64 data URL when `assetPolicy === 'inline-base64'`. Leaves
 * http(s) / data: URIs alone. Cap at 5 MB per image to keep single-file
 * outputs reasonable — oversized images fall back to keep-relative.
 */
export async function inlineImages(
  html: string,
  file: ExportPlanFile,
  rootPath: string,
  assetPolicy: ExportPlan['assetPolicy'],
): Promise<string> {
  if (assetPolicy !== 'inline-base64') return html;

  const MAX_BYTES = 5 * 1024 * 1024;
  const IMG_RE = /<img([^>]*?)\ssrc="([^"]+)"([^>]*)>/g;
  const matches: Array<{ full: string; before: string; src: string; after: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = IMG_RE.exec(html)) !== null) {
    matches.push({ full: m[0], before: m[1]!, src: m[2]!, after: m[3]! });
  }

  const sourceDir = path.posix.dirname(file.relativePath);
  for (const match of matches) {
    if (/^(https?:|data:|mailto:)/i.test(match.src)) continue;
    const relToRoot = path.posix.normalize(path.posix.join(sourceDir, match.src));
    // Guard against path traversal out of the project root.
    if (relToRoot.startsWith('..')) continue;
    const abs = path.join(rootPath, relToRoot);
    try {
      const stat = await fs.stat(abs);
      if (stat.size > MAX_BYTES) continue;
      const bytes = await fs.readFile(abs);
      const mime = mimeForExt(path.extname(abs));
      const data = bytes.toString('base64');
      const replacement = `<img${match.before} src="data:${mime};base64,${data}"${match.after}>`;
      html = html.replace(match.full, replacement);
    } catch {
      // Missing / unreadable image — leave the src as-is; the exported
      // file will render with a broken-image icon rather than crashing
      // the whole export.
    }
  }
  return html;
}

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.gif') return 'image/gif';
  if (e === '.webp') return 'image/webp';
  if (e === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findTitle(target: string, titleByTarget: Map<string, string>): string | null {
  return (
    titleByTarget.get(target) ??
    titleByTarget.get(stripMd(target)) ??
    titleByTarget.get(`${target}.md`) ??
    null
  );
}

function stripMd(p: string): string {
  return p.replace(/\.md$/i, '');
}

