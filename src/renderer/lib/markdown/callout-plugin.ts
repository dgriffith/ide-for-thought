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
    if (tokens[i].type !== 'blockquote_open') continue;
    const pIdx = i + 1;
    if (pIdx >= tokens.length || tokens[pIdx].type !== 'paragraph_open') continue;
    const inlineIdx = pIdx + 1;
    if (inlineIdx >= tokens.length || tokens[inlineIdx].type !== 'inline') continue;
    const inline = tokens[inlineIdx];
    const m = inline.content.match(MARKER_RE);
    if (!m) continue;
    const type = m[1].toLowerCase();
    const fold = m[2];
    const titleRaw = (m[3] ?? '').trim();
    const title = titleRaw.length > 0
      ? titleRaw
      : (TITLE_DEFAULTS[type] ?? capitalize(type));

    tokens[i].attrSet('data-callout', type);
    tokens[i].attrSet('data-callout-title', title);
    if (fold === '+') tokens[i].attrSet('data-callout-fold', 'open');
    else if (fold === '-') tokens[i].attrSet('data-callout-fold', 'closed');

    const remainder = inline.content.slice(m[0].length);
    if (remainder.trim().length === 0) {
      // Strip the marker-only paragraph entirely (open + inline + close).
      tokens.splice(pIdx, 3);
    } else {
      // Strip the marker prefix; the core `inline` rule (which runs
      // after this one) will tokenize `inline.content` into children.
      // Don't touch `inline.children` here — that rule APPENDS to the
      // existing children, so any pre-tokenization would render twice.
      inline.content = remainder;
    }
  }
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
