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
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const close = src.indexOf(']]', pos + 2);
    if (close < 0) return false;
    const inner = src.slice(pos + 2, close);
    const m = inner.match(/^(cite|quote)::(.+)$/i);
    if (!m) return false;
    if (silent) { state.pos = close + 2; return true; }
    const kind = m[1].toLowerCase();
    const id = m[2].trim();
    const token = state.push('html_inline', '', 0);

    if (activeRenderer && citations) {
      if (kind === 'quote') {
        const ex = citations.excerpts.get(id);
        if (ex) {
          token.content = activeRenderer.renderCitation(ex.sourceId, ex.locator);
        } else {
          token.content = `<span class="csl-missing">[missing excerpt: ${escapeHtml(id)}]</span>`;
        }
      } else {
        token.content = activeRenderer.renderCitation(id);
      }
    } else {
      token.content = `<sup class="cite-stub" title="${escapeAttr(kind + ': ' + id)}">[${escapeHtml(id)}]</sup>`;
    }
    state.pos = close + 2;
    return true;
  });
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
