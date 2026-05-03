/**
 * Markdown-it plugin that renders Obsidian-style callouts (#465).
 *
 * A blockquote whose first line is `[!type]` (optionally followed by
 * `+` or `-` for collapsibility and a custom title) becomes a styled
 * box with an icon and title bar. Examples:
 *
 *     > [!note]
 *     > Body.
 *
 *     > [!warning] Custom title
 *     > Body.
 *
 *     > [!tip]+ Default-expanded collapsible
 *     > Body.
 *
 *     > [!info]- Default-collapsed collapsible
 *     > Body hidden until clicked.
 *
 * Nested callouts work for free because nested blockquotes already do —
 * the core rule walks every blockquote_open token independently.
 *
 * Collapsibles render as <details>/<summary> so keyboard a11y comes
 * for free; non-collapsibles render as plain <div>s.
 */

import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';

/**
 * First-line marker. Title whitespace is restricted to spaces/tabs so a
 * newline never sneaks the body's first line into the title (otherwise
 * `> [!note]\n> Body.` would title the callout "Body.").
 */
const MARKER_RE = /^\[!([a-zA-Z][\w-]*)\]([+-]?)(?:[ \t]+([^\n]*?))?(?:\n|$)/;

const TITLE_DEFAULTS: Record<string, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  success: 'Success',
  question: 'Question',
  warning: 'Warning',
  failure: 'Failure',
  danger: 'Danger',
  bug: 'Bug',
  example: 'Example',
  quote: 'Quote',
  abstract: 'Abstract',
  todo: 'Todo',
};

const KNOWN_TYPES = new Set(Object.keys(TITLE_DEFAULTS));

export function installCallouts(md: MarkdownIt): void {
  md.core.ruler.after('block', 'callout', (state) => calloutCoreRule(state));

  const defaultBlockquoteOpen = md.renderer.rules.blockquote_open;
  const defaultBlockquoteClose = md.renderer.rules.blockquote_close;

  md.renderer.rules.blockquote_open = (tokens, idx, opts, env, self) => {
    const tok = tokens[idx];
    const type = tok.attrGet('data-callout');
    if (type === null) {
      return defaultBlockquoteOpen
        ? defaultBlockquoteOpen(tokens, idx, opts, env, self)
        : self.renderToken(tokens, idx, opts);
    }
    const title = tok.attrGet('data-callout-title') ?? '';
    const fold = tok.attrGet('data-callout-fold');
    const collapsible = fold === 'open' || fold === 'closed';
    const isOpen = fold !== 'closed';
    const known = KNOWN_TYPES.has(type);
    const classes = [
      'callout',
      `callout-${known ? type : 'unknown'}`,
      collapsible ? 'callout-collapsible' : null,
    ].filter(Boolean).join(' ');
    const titleInner = `<span class="callout-icon" aria-hidden="true"></span><span class="callout-title-text">${escapeHtml(title)}</span>`;
    const safeType = escapeAttr(type);
    if (collapsible) {
      return `<details class="${classes}" data-callout="${safeType}"${isOpen ? ' open' : ''}><summary class="callout-title">${titleInner}</summary><div class="callout-content">\n`;
    }
    return `<div class="${classes}" data-callout="${safeType}"><div class="callout-title">${titleInner}</div><div class="callout-content">\n`;
  };

  md.renderer.rules.blockquote_close = (tokens, idx, opts, env, self) => {
    const open = findMatchingBlockquoteOpen(tokens, idx);
    if (open && open.attrGet('data-callout') !== null) {
      const fold = open.attrGet('data-callout-fold');
      const collapsible = fold === 'open' || fold === 'closed';
      return collapsible ? '</div></details>\n' : '</div></div>\n';
    }
    return defaultBlockquoteClose
      ? defaultBlockquoteClose(tokens, idx, opts, env, self)
      : self.renderToken(tokens, idx, opts);
  };
}

function calloutCoreRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'blockquote_open') {
      tryCalloutOnBlockquote(tokens, i);
    } else if (tokens[i].type === 'paragraph_open') {
      // Lenient extension to the standard syntax: a paragraph whose
      // first line is `[!type]` becomes a callout too. Obsidian and
      // GitHub require the leading `>`, but users in this repo write
      // the bare form often enough that supporting it removes friction.
      // Bare callouts are non-collapsible (no DOM container we can
      // toggle without inventing more syntax).
      tryCalloutOnBareParagraph(tokens, i);
    }
  }
}

function tryCalloutOnBlockquote(tokens: Token[], i: number): void {
  const pIdx = i + 1;
  if (pIdx >= tokens.length || tokens[pIdx].type !== 'paragraph_open') return;
  const inlineIdx = pIdx + 1;
  if (inlineIdx >= tokens.length || tokens[inlineIdx].type !== 'inline') return;
  const inline = tokens[inlineIdx];
  const m = inline.content.match(MARKER_RE);
  if (!m) return;
  applyCalloutAttrs(tokens[i], m);
  stripMarkerFromParagraph(tokens, pIdx, m[0].length);
}

function tryCalloutOnBareParagraph(tokens: Token[], pIdx: number): void {
  const inlineIdx = pIdx + 1;
  if (inlineIdx >= tokens.length || tokens[inlineIdx].type !== 'inline') return;
  const inline = tokens[inlineIdx];
  const m = inline.content.match(MARKER_RE);
  if (!m) return;
  // Only fire on a top-level paragraph — nested-in-list/blockquote
  // paragraphs already get handled (or correctly ignored) by the
  // blockquote pass. The token stream's `level` field tracks nesting.
  if (tokens[pIdx].level !== 0) return;

  // Bare callouts: rewrite `paragraph_open`/`paragraph_close` into
  // synthetic `blockquote_open`/`blockquote_close` so the existing
  // render rules (which key off `data-callout` on the blockquote token)
  // produce the same wrapper without divergent code paths.
  const closeIdx = findMatchingParagraphClose(tokens, pIdx);
  if (closeIdx === -1) return;

  const TokenCtor = tokens[pIdx].constructor as new (
    type: string, tag: string, nesting: -1 | 0 | 1,
  ) => Token;
  const open = new TokenCtor('blockquote_open', 'blockquote', 1);
  open.block = true;
  open.markup = '>';
  applyCalloutAttrs(open, m);
  const close = new TokenCtor('blockquote_close', 'blockquote', -1);
  close.block = true;

  tokens[pIdx] = open;
  tokens[closeIdx] = close;

  // Wrap the original inline back in a paragraph so the renderer still
  // emits a <p> for the body. Insert paragraph_open before inline and
  // paragraph_close after it.
  const newPOpen = new TokenCtor('paragraph_open', 'p', 1);
  newPOpen.block = true;
  const newPClose = new TokenCtor('paragraph_close', 'p', -1);
  newPClose.block = true;
  tokens.splice(closeIdx, 0, newPClose);
  tokens.splice(pIdx + 1, 0, newPOpen);

  // pIdx+1 is now newPOpen, pIdx+2 is the inline.
  stripMarkerFromInline(tokens, pIdx + 2, m[0].length);
}

function applyCalloutAttrs(blockquoteOpen: Token, m: RegExpMatchArray): void {
  const type = m[1].toLowerCase();
  const fold = m[2];
  const titleRaw = (m[3] ?? '').trim();
  const title = titleRaw.length > 0
    ? titleRaw
    : (TITLE_DEFAULTS[type] ?? capitalize(type));
  blockquoteOpen.attrSet('data-callout', type);
  blockquoteOpen.attrSet('data-callout-title', title);
  if (fold === '+') blockquoteOpen.attrSet('data-callout-fold', 'open');
  else if (fold === '-') blockquoteOpen.attrSet('data-callout-fold', 'closed');
}

function stripMarkerFromParagraph(tokens: Token[], pIdx: number, markerLen: number): void {
  const inline = tokens[pIdx + 1];
  const remainder = inline.content.slice(markerLen);
  if (remainder.trim().length === 0) {
    tokens.splice(pIdx, 3);
  } else {
    stripMarkerFromInline(tokens, pIdx + 1, markerLen);
  }
}

function stripMarkerFromInline(tokens: Token[], inlineIdx: number, markerLen: number): void {
  const inline = tokens[inlineIdx];
  inline.content = inline.content.slice(markerLen);
  // Don't touch inline.children — the core inline rule that runs next
  // will tokenize the new content and appends to children, so any
  // pre-tokenization would double-render.
}

function findMatchingParagraphClose(tokens: Token[], openIdx: number): number {
  for (let i = openIdx + 1; i < tokens.length; i++) {
    if (tokens[i].type === 'paragraph_close' && tokens[i].level === tokens[openIdx].level) {
      return i;
    }
  }
  return -1;
}

/**
 * Walk back from a `blockquote_close` to the matching `blockquote_open`
 * at the same nesting level. Used by the close render rule to decide
 * whether the close belongs to a callout (and therefore needs the
 * wrapper close tags) or a plain blockquote.
 */
function findMatchingBlockquoteOpen(tokens: Token[], closeIdx: number): Token | null {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    const t = tokens[i];
    if (t.type === 'blockquote_close') depth++;
    else if (t.type === 'blockquote_open') {
      depth--;
      if (depth === 0) return t;
    }
  }
  return null;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
