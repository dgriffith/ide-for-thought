/**
 * Live blocks in exports (#2508, #2510): blocks that render live in the
 * preview — ```object-view, ```mermaid, ```output, `:::query-*`, `:::argument` and block-level
 * link cards — rendered for an export by the SAME
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
import type { Token } from 'markdown-it';
import { parseFenceInfo } from '../../shared/markdown/fence-info';
import {
  LIVE_BLOCKS, LIVE_DIRECTIVE_OPENERS, LIVE_FENCE_LANGS, NOTE_LINK_ATTR,
  type CardBlockKind, type MainBlockKind, type LiveBlockRequest, type LiveBlockResult, type WindowBlockKind,
} from '../../shared/live-blocks';
import { renderVegaBlocks } from './vega-render';
import { renderYouTubeBlocks } from './youtube-render';
import { escapeHtmlFull as escapeHtml, escapeHtmlFull as escapeAttr } from '../../shared/text-escape';

export type LiveBlockRenderer = (blocks: LiveBlockRequest[]) => Promise<LiveBlockResult[]>;

const WINDOW_KINDS: ReadonlySet<string> = new Set(LIVE_BLOCKS.filter((d) => d.export === 'window').map((d) => d.kind));
const isWindowKind = (k: string): k is WindowBlockKind => WINDOW_KINDS.has(k);

/** Fence languages an export asks the window to render, and their kind —
 *  derived from the registry (`shared/live-blocks.ts`, #2624). */
export const LIVE_FENCES: Readonly<Record<string, WindowBlockKind>> = Object.fromEntries(
  [...LIVE_FENCE_LANGS].filter(([, kind]) => isWindowKind(kind)),
) as Record<string, WindowBlockKind>;

/**
 * The export half of each `main` kind (#2624): a transform of the note's
 * markdown, run in registry order. Keyed by kind, so a `main` kind registered
 * without one doesn't compile.
 */
export const MAIN_TRANSFORMS: Record<MainBlockKind, (markdown: string, ctx: { rootPath?: string | undefined }) => string | Promise<string>> = {
  // ```vega / ```vega-lite → a static SVG image (#831). Async: vega's toSVG is.
  vega: (md, ctx) => renderVegaBlocks(md, { rootPath: ctx.rootPath }),
  // ```youtube → a linked thumbnail (#904).
  youtube: (md) => renderYouTubeBlocks(md),
};

/** Run every `main` kind's transform over `markdown`, in registry order. */
export async function applyMainTransforms(markdown: string, ctx: { rootPath?: string | undefined }): Promise<string> {
  let out = markdown;
  for (const d of LIVE_BLOCKS) {
    if (d.export === 'main') out = await MAIN_TRANSFORMS[d.kind](out, ctx);
  }
  return out;
}

/** The kind a lone-link paragraph is extracted as. */
const CARD_KIND: CardBlockKind = LIVE_BLOCKS.find((d) => 'cardLink' in d.syntax)!.kind as CardBlockKind;

/** Letters and digits only: no markdown syntax can reach into it. */
const placeholder = (n: number): string => `MINERVALIVEBLOCK${n}Z`;

const scanner = new MarkdownIt();

/**
 * Replace every live block in `markdown` with a placeholder paragraph. Returns
 * the rewritten markdown and one request per block, in document order. Hidden
 * fences are not live blocks — the renderer drops them.
 */
export function extractLiveBlocks(markdown: string, notePath: string, opts: { paged?: boolean | undefined } = {}): { markdown: string; blocks: LiveBlockRequest[] } {
  const lines = markdown.split('\n');
  const found: Array<{ start: number; end: number; kind: WindowBlockKind; source: string }> = [];
  const code: Array<[number, number]> = [];
  const tokens = scanner.parse(markdown, {});
  found.push(...findLinkCards(tokens));
  for (const tok of tokens) {
    if ((tok.type !== 'fence' && tok.type !== 'code_block') || !tok.map) continue;
    code.push([tok.map[0], tok.map[1]]);
    if (tok.type !== 'fence') continue;
    const info = parseFenceInfo(tok.info);
    const kind = LIVE_FENCES[info.lang];
    if (!kind || info.hidden) continue;
    found.push({ start: tok.map[0], end: tok.map[1], kind, source: tok.content });
  }
  found.push(...findDirectives(lines, code));
  if (found.length === 0) return { markdown, blocks: [] };
  found.sort((a, b) => a.start - b.start);
  const blocks: LiveBlockRequest[] = found.map((f, i) => ({
    id: placeholder(i), kind: f.kind, source: f.source, notePath, ...(opts.paged ? { paged: true } : {}),
  }));
  // Bottom-up, so earlier line numbers stay valid.
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i]!;
    lines.splice(f.start, f.end - f.start, '', blocks[i]!.id, '');
  }
  return { markdown: lines.join('\n'), blocks };
}

/** A paragraph that is one plain `[[link]]` or `[[quote::id]]` and nothing
 *  else — what the preview's typed-card pass considers (#1071). */
const CARD_LINK = /^\[\[(?:quote::)?(?![a-z][\w-]*::)[^[\]\n]+\]\]$/;

/**
 * Block-level links that the preview may promote to a typed-note or excerpt
 * card (#2526). Only top-level paragraphs: a line inside a quote or list
 * can't be swapped for a placeholder without breaking its container. The
 * window decides whether it really is a card (an untyped note isn't); when it
 * isn't, the export renders the paragraph as an ordinary link.
 */
function findLinkCards(tokens: Token[]): Array<{ start: number; end: number; kind: WindowBlockKind; source: string }> {
  const out: Array<{ start: number; end: number; kind: WindowBlockKind; source: string }> = [];
  tokens.forEach((tok, i) => {
    if (tok.type !== 'paragraph_open' || tok.level !== 0 || !tok.map) return;
    const inline = tokens[i + 1];
    if (!inline || inline.type !== 'inline' || !CARD_LINK.test(inline.content.trim())) return;
    out.push({ start: tok.map[0], end: tok.map[1], kind: CARD_KIND, source: inline.content.trim() });
  });
  return out;
}

/** Directive opening lines rendered as live blocks, and their kind — the
 *  registry's openers, allowing up to three spaces of indent as markdown does. */
export const LIVE_DIRECTIVES: ReadonlyArray<[RegExp, WindowBlockKind]> = LIVE_DIRECTIVE_OPENERS
  .filter(([kind]) => isWindowKind(kind))
  .map(([kind, opener]) => [new RegExp(`^\\s{0,3}${opener.source.replace(/^\^/, '')}`), kind as WindowBlockKind]);

/**
 * `:::query-TYPE` (#2512) and `:::argument` (#2514) directives, by the
 * preview plugins' rules: an exact opening line, closed by the first line that
 * is `:::`; an unclosed one isn't a directive. Inside a code block (fenced or
 * indented) it's code, not a directive. The source sent to the window is the
 * whole directive, which the preview's own parser reads back.
 */
function findDirectives(lines: string[], code: Array<[number, number]>): Array<{ start: number; end: number; kind: WindowBlockKind; source: string }> {
  const inCode = (i: number) => code.some(([s, e]) => i >= s && i < e);
  const out: Array<{ start: number; end: number; kind: WindowBlockKind; source: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const kind = inCode(i) ? undefined : LIVE_DIRECTIVES.find(([re]) => re.test(lines[i]!))?.[1];
    if (!kind) continue;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j]!.trim() === ':::') { close = j; break; }
    }
    if (close < 0) continue;
    out.push({ start: i, end: close + 1, kind, source: lines.slice(i, close + 1).join('\n') });
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
