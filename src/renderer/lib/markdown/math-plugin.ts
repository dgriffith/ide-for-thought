/**
 * Markdown-it plugin that renders `$…$` as inline math and `$$…$$` as
 * block math via KaTeX (#227).
 *
 * Inline rule registered before `escape` so `$` takes its math meaning
 * before backslash-escape consumes it. Block rule registered before
 * `fence` so doubled-dollar blocks are detected regardless of
 * surrounding content. Code fences and inline code still win because
 * markdown-it tokenises those earlier — math text inside ```…``` or
 * ` ` is never passed to our rule.
 *
 * Malformed LaTeX renders as KaTeX's red error span (via
 * `throwOnError: false`) instead of nuking the whole preview.
 */

import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import katex from 'katex';

export function installMath(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.renderer.rules.math_inline = (tokens, idx) => {
    const displayMode = tokens[idx].markup === '$$';
    return renderTex(tokens[idx].content, displayMode);
  };
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderTex(tokens[idx].content, true)}</div>\n`;
}

function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode });
  } catch (err) {
    // renderToString should not throw with throwOnError:false, but guard
    // against pathological inputs so one bad line can't brick preview.
    const msg = err instanceof Error ? err.message : String(err);
    return `<span class="katex-error" title="${escapeAttr(msg)}">${escapeHtml(tex)}</span>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/**
 * Inline math: both `$…$` (text-mode) and `$$…$$` (display-mode, when
 * appearing mid-paragraph — the block rule only fires at start-of-line).
 *
 * Rejects, following pandoc + CommonMark math conventions:
 *  - zero-width bodies
 *  - multi-line bodies (an unescaped `\n` inside terminates)
 *  - whitespace right after the opening `$` (so "cost: $5 today" in
 *    prose stays prose — there's no math-that-starts-with-space)
 *  - whitespace right before the closing `$` (for the same reason —
 *    it resolves "$foo $ bar$" to the outer pair)
 *
 * Digits after the opening `$` are allowed — formulas like `$0.6<z<4$`
 * are legitimate, and the whitespace-before-close rule keeps
 * "$5 today $50 tomorrow" from getting swept into a span anyway.
 */
function mathInline(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false;

  const isDisplay = state.src.charCodeAt(state.pos + 1) === 0x24;
  const openLen = isDisplay ? 2 : 1;
  const bodyStart = state.pos + openLen;

  // Whitespace immediately after opening → not math.
  const afterOpen = state.src.charCodeAt(bodyStart);
  if (afterOpen === 0x20 || afterOpen === 0x09 || afterOpen === 0x0a) {
    // For display mode `$$ … $$` (with spaces), pandoc allows the
    // spaces. Keep that behaviour: only reject the whitespace rule for
    // text-mode single-$; display-mode spaces are fine.
    if (!isDisplay) return false;
  }

  // Scan forward for the closing delimiter. `\$` is escaped, not a
  // terminator. For display mode we need `$$`.
  let end = bodyStart;
  while (end < state.src.length) {
    const c = state.src.charCodeAt(end);
    if (c === 0x0a) return false;
    if (c === 0x24 /* $ */ && state.src.charCodeAt(end - 1) !== 0x5c /* \ */) {
      if (isDisplay) {
        if (state.src.charCodeAt(end + 1) === 0x24) break;
      } else {
        break;
      }
    }
    end++;
  }
  if (end >= state.src.length) return false;
  const content = state.src.slice(bodyStart, end);
  if (content.length === 0) return false;

  if (!isDisplay) {
    const beforeClose = state.src.charCodeAt(end - 1);
    if (beforeClose === 0x20 || beforeClose === 0x09) return false;
  }

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = content.replace(/\\\$/g, '$').trim();
    token.markup = isDisplay ? '$$' : '$';
  }
  state.pos = end + (isDisplay ? 2 : 1);
  return true;
}

/**
 * Block `$$ … $$`. Opening line starts with `$$` (possibly followed by
 * more content on the same line, for one-liner blocks). Closing is
 * `$$` at the end of some subsequent (or the same) line.
 */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const openPos = state.bMarks[startLine] + state.tShift[startLine];
  const openEnd = state.eMarks[startLine];
  if (openEnd - openPos < 2) return false;
  if (state.src.charCodeAt(openPos) !== 0x24 || state.src.charCodeAt(openPos + 1) !== 0x24) {
    return false;
  }

  const firstLine = state.src.slice(openPos + 2, openEnd);
  // One-liner: $$…$$ on a single line.
  if (firstLine.trimEnd().endsWith('$$') && firstLine.trim().length >= 2) {
    const body = firstLine.replace(/\$\$\s*$/, '');
    if (silent) return true;
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = body.trim();
    token.markup = '$$';
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }

  // Multi-line: walk forward for a line ending with `$$`.
  let line = startLine + 1;
  let foundLine = -1;
  while (line < endLine) {
    const lineStart = state.bMarks[line] + state.tShift[line];
    const lineEnd = state.eMarks[line];
    const text = state.src.slice(lineStart, lineEnd);
    if (text.trimEnd().endsWith('$$')) { foundLine = line; break; }
    line++;
  }
  if (foundLine === -1) return false;
  if (silent) return true;

  const bodyLines: string[] = [];
  if (firstLine.trim().length > 0) bodyLines.push(firstLine);
  for (let i = startLine + 1; i < foundLine; i++) {
    bodyLines.push(state.src.slice(state.bMarks[i] + state.tShift[i], state.eMarks[i]));
  }
  const tail = state.src.slice(state.bMarks[foundLine] + state.tShift[foundLine], state.eMarks[foundLine]);
  const tailBody = tail.replace(/\$\$\s*$/, '');
  if (tailBody.trim().length > 0) bodyLines.push(tailBody);

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = bodyLines.join('\n').trim();
  token.markup = '$$';
  token.map = [startLine, foundLine + 1];
  state.line = foundLine + 1;
  return true;
}
