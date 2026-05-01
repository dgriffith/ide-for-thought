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
import footnote from 'markdown-it-footnote';
import hljs from 'highlight.js';
import { buildLinkResolverContext } from '../../link-resolver';
import type { ExportPlanFile, ExportPlan } from '../../types';
import type { CitationRenderer } from '../../csl';

/**
 * Returns the rendered body HTML — just the article content, no `<html>`
 * shell. The optional `renderer` overrides the one the cite rule would
 * otherwise pull off `plan.citations`; pass it when the caller wants
 * to collect cited ids across multiple `renderNoteBody` invocations
 * (e.g. a bundle renderer aggregating a single References section).
 */
export function renderNoteBody(
  file: ExportPlanFile,
  plan: ExportPlan,
  renderer?: CitationRenderer,
): string {
  const md = buildMd(plan, renderer);
  const bodyMarkdown = stripFrontmatter(file.content);
  return md.render(bodyMarkdown);
}

function buildMd(plan: ExportPlan, renderer?: CitationRenderer): MarkdownIt {
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
  md.use(footnote);
  installWikiLinkRule(md, plan);
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
function installWikiLinkRule(md: MarkdownIt, plan: ExportPlan): void {
  const ctx = buildLinkResolverContext(plan);

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
        const href = anchor ? `${asMd.replace(/\.md$/, '.html')}#${anchor}` : asMd.replace(/\.md$/, '.html');
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
 * Strip interactive-only bits from the body:
 *   - `#tag` inline tags render as plain text (no click-to-filter handler
 *     when read standalone).
 *
 * Implemented as a cheap post-processing pass rather than a new rule so
 * we don't duplicate the Preview's tag grammar.
 */
function installTagRule(_md: MarkdownIt): void {
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
  md: MarkdownIt,
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
  endPos: number;
}

function parseCiteAt(src: string, pos: number): ParsedCite | null {
  if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return null;
  const close = src.indexOf(']]', pos + 2);
  if (close < 0) return null;
  const inner = src.slice(pos + 2, close);
  const m = inner.match(/^(cite|quote)::(.+)$/i);
  if (!m) return null;
  return {
    kind: m[1].toLowerCase() as 'cite' | 'quote',
    id: m[2].trim(),
    endPos: close + 2,
  };
}

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

  // Resolve each item to (sourceId, locator). Missing markers preserve
  // the original kind so users see "missing excerpt" vs "missing source".
  type Resolved =
    | { ok: true; sourceId: string; locator?: string }
    | { ok: false; missingMarker: string };
  const resolved: Resolved[] = items.map((item) => {
    if (item.kind === 'quote') {
      const ex = citations.excerpts.get(item.id);
      if (!ex) return { ok: false, missingMarker: `<span class="csl-missing">[missing excerpt: ${escapeHtml(item.id)}]</span>` };
      if (!citations.items.has(ex.sourceId)) return { ok: false, missingMarker: `<span class="csl-missing">[missing: ${escapeHtml(ex.sourceId)}]</span>` };
      return { ok: true, sourceId: ex.sourceId, locator: ex.locator };
    }
    if (!citations.items.has(item.id)) return { ok: false, missingMarker: `<span class="csl-missing">[missing: ${escapeHtml(item.id)}]</span>` };
    return { ok: true, sourceId: item.id, locator: undefined };
  });

  // Any missing → render each item independently so missing markers
  // stay visible in their original positions. Single item → also
  // independent (no merge to perform).
  if (items.length === 1 || resolved.some((r) => !r.ok)) {
    return resolved
      .map((r) => (r.ok ? activeRenderer.renderCitation(r.sourceId, r.locator) : r.missingMarker))
      .join(' ');
  }

  // All items resolved → single merged cluster.
  return activeRenderer.renderCitationCluster(
    resolved.map((r) => {
      // Type narrowing: we proved every r is { ok: true } above.
      const ok = r as Extract<Resolved, { ok: true }>;
      return { id: ok.sourceId, locator: ok.locator };
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
    matches.push({ full: m[0], before: m[1], src: m[2], after: m[3] });
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

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
