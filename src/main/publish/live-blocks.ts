/**
 * Live blocks in exports (#2508, #2510): blocks that render live in the
 * preview — ```object-view and `:::query-*` — rendered for an export by the SAME
 * components the preview uses, in the window that asked for the export, and
 * spliced into the exported HTML.
 *
 * Main never re-implements a view (a second implementation drifts from the
 * preview). It does three things around the window's render:
 *
 *   1. `extractLiveBlocks` swaps each block in the markdown for a placeholder
 *      paragraph markdown-it passes through untouched;
 *   2. the plan's `renderLiveBlocks` (window-bound, from the export's IPC
 *      handler) renders the batch;
 *   3. `spliceLiveBlocks` puts each block's HTML where its placeholder
 *      rendered, resolving the block's note links through the export's link
 *      policy.
 *
 * Nothing here can fail an export: no renderer (a test, a closed window), a
 * timeout, or one block's error each degrade that block to a one-line note —
 * never to the raw spec, which is what every export printed before.
 */
import MarkdownIt from 'markdown-it';
import { parseFenceInfo } from '../../shared/markdown/fence-info';
import { NOTE_LINK_ATTR, type LiveBlockKind, type LiveBlockRequest, type LiveBlockResult } from '../../shared/live-blocks';
import { escapeHtmlFull as escapeHtml, escapeHtmlFull as escapeAttr } from '../../shared/text-escape';

export type LiveBlockRenderer = (blocks: LiveBlockRequest[]) => Promise<LiveBlockResult[]>;

/** Fence languages rendered as live blocks, and their kind. */
const LIVE_FENCES: Readonly<Record<string, LiveBlockKind>> = { 'object-view': 'object-view' };

/** Letters and digits only: no markdown syntax can reach into it. */
const placeholder = (n: number): string => `MINERVALIVEBLOCK${n}Z`;

const scanner = new MarkdownIt();

/**
 * Replace every live block in `markdown` with a placeholder paragraph. Returns
 * the rewritten markdown and one request per block, in document order. Hidden
 * fences are not live blocks — the renderer drops them.
 */
export function extractLiveBlocks(markdown: string, notePath: string): { markdown: string; blocks: LiveBlockRequest[] } {
  const lines = markdown.split('\n');
  const found: Array<{ start: number; end: number; kind: LiveBlockKind; source: string }> = [];
  const code: Array<[number, number]> = [];
  for (const tok of scanner.parse(markdown, {})) {
    if ((tok.type !== 'fence' && tok.type !== 'code_block') || !tok.map) continue;
    code.push([tok.map[0], tok.map[1]]);
    if (tok.type !== 'fence') continue;
    const info = parseFenceInfo(tok.info);
    const kind = LIVE_FENCES[info.lang];
    if (!kind || info.hidden) continue;
    found.push({ start: tok.map[0], end: tok.map[1], kind, source: tok.content });
  }
  found.push(...findQueryDirectives(lines, code));
  if (found.length === 0) return { markdown, blocks: [] };
  found.sort((a, b) => a.start - b.start);
  const blocks: LiveBlockRequest[] = found.map((f, i) => ({ id: placeholder(i), kind: f.kind, source: f.source, notePath }));
  // Bottom-up, so earlier line numbers stay valid.
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i]!;
    lines.splice(f.start, f.end - f.start, '', blocks[i]!.id, '');
  }
  return { markdown: lines.join('\n'), blocks };
}

/**
 * `:::query-TYPE` … `:::` directives (#2512), by the preview plugin's rules:
 * an opening line of exactly `:::query-<word>`, closed by the first line that
 * is `:::`; an unclosed one isn't a directive. Inside a code block (fenced or
 * indented) it's code, not a directive. The source sent to the window is the
 * whole directive, which the preview's own parser reads back.
 */
function findQueryDirectives(lines: string[], code: Array<[number, number]>): Array<{ start: number; end: number; kind: LiveBlockKind; source: string }> {
  const inCode = (i: number) => code.some(([s, e]) => i >= s && i < e);
  const out: Array<{ start: number; end: number; kind: LiveBlockKind; source: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (inCode(i) || !/^\s{0,3}:::query-\w+\s*$/.test(lines[i]!)) continue;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j]!.trim() === ':::') { close = j; break; }
    }
    if (close < 0) continue;
    out.push({ start: i, end: close + 1, kind: 'query', source: lines.slice(i, close + 1).join('\n') });
    i = close;
  }
  return out;
}

/** Render a batch, never throwing: any failure becomes per-block errors. */
export async function renderLiveBlocks(
  blocks: LiveBlockRequest[],
  renderer: LiveBlockRenderer | undefined,
): Promise<Map<string, LiveBlockResult>> {
  const byId = new Map<string, LiveBlockResult>();
  if (blocks.length === 0) return byId;
  let results: LiveBlockResult[] = [];
  let failure = 'Live views can only be rendered from an open Minerva window.';
  if (renderer) {
    try {
      results = await renderer(blocks);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
  }
  for (const r of results) byId.set(r.id, r);
  for (const b of blocks) if (!byId.has(b.id)) byId.set(b.id, { id: b.id, ok: false, error: failure });
  return byId;
}

/**
 * Put each block's HTML where its placeholder paragraph rendered. `hrefFor`
 * maps a note path to an href under the export's link policy, or null for no
 * link (the element stays, as plain text — `<a>` without `href`).
 */
export function spliceLiveBlocks(
  html: string,
  results: Map<string, LiveBlockResult>,
  hrefFor: (notePath: string) => string | null,
): string {
  if (results.size === 0) return html;
  return html.replace(/<p>(MINERVALIVEBLOCK\d+Z)<\/p>/g, (whole, id: string) => {
    const r = results.get(id);
    if (!r) return whole;
    if (!r.ok) return `<p class="live-block-unavailable"><em>${escapeHtml(`This view couldn't be rendered for export: ${r.error}`)}</em></p>`;
    return resolveNoteLinks(r.html, hrefFor);
  });
}

const NOTE_LINK_RE = new RegExp(` ${NOTE_LINK_ATTR}="([^"]*)"`, 'g');

function resolveNoteLinks(html: string, hrefFor: (notePath: string) => string | null): string {
  return html.replace(NOTE_LINK_RE, (_m, raw: string) => {
    const href = hrefFor(decodeAttr(raw));
    return href === null ? '' : ` href="${escapeAttr(href)}"`;
  });
}

/** Undo the entity escaping the DOM serializer applied to an attribute value. */
function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
