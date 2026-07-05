/**
 * Format-on-paste (#160). On every text paste we run two things over the
 * pasted fragment:
 *
 *   1. the **paste-safe subset of the user's enabled formatter rules** —
 *      paste formatting follows the house style + their toggles, with no
 *      separate `*-on-paste` settings (`formatPasteSafe`); and
 *   2. a few **always-on, context-aware paste tidies** that have no
 *      document-at-rest equivalent: outer-whitespace trim, list/checklist
 *      marker de-duplication, and (inside a blockquote) footnote-marker
 *      stripping + `>` continuation indentation.
 *
 * The caller (Editor's paste handler) is responsible for skipping this
 * entirely when the cursor sits inside a protected region (code fence /
 * math / inline code) — pasted code must not be reformatted.
 *
 * Importing this module also registers the formatter rules into the
 * renderer's registry (the side-effect barrel below), so paste formatting
 * works without the Settings dialog having been opened.
 */

import '../../../shared/formatter/rules/index';
import { formatPasteSafe, type FormatSettings } from '../../../shared/formatter/engine';

export interface PasteContext {
  /** The cursor line's text up to the insertion point. Carries the leading
   *  list/checklist marker and blockquote prefix the tidies key off. */
  lineBeforeCursor: string;
  /** True when the cursor sits on a blockquote line. */
  inBlockquote: boolean;
}

/**
 * Strip blank (whitespace-only) lines at the start and end of the paste,
 * but preserve content-line indentation and join-spaces. A single-line
 * paste is left untouched — so pasting a word to join (`foo` + ` bar`)
 * keeps its leading space rather than silently producing `foobar`.
 */
export function blockTrim(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
}

/**
 * Drop a leading list/checklist marker from the pasted text when the cursor
 * already sits on an (empty) marker line — otherwise you get `- - item`.
 * Checklist lines are matched before plain-list lines (more specific).
 */
export function dedupeMarker(text: string, ctx: PasteContext): string {
  const cur = ctx.lineBeforeCursor;
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  const rest = nl === -1 ? '' : text.slice(nl);

  // Cursor on an empty "- [ ] " checklist item.
  if (/^\s*[-*+]\s+\[[ xX]\]\s*$/.test(cur)) {
    const stripped = first.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '');
    return stripped === first ? text : stripped + rest;
  }
  // Cursor on an empty "- " / "1. " list item.
  if (/^\s*([-*+]|\d+[.)])\s*$/.test(cur)) {
    const stripped = first.replace(/^\s*([-*+]|\d+[.)])\s+/, '');
    return stripped === first ? text : stripped + rest;
  }
  return text;
}

/** Strip inline footnote references (`[^id]`) from pasted quoted text, while
 *  leaving footnote *definitions* (`[^id]: …`) intact. */
export function stripFootnoteRefs(text: string): string {
  return text.replace(/\[\^[^\]\s]+\](?!:)/g, '');
}

/**
 * Keep multi-line content inside the blockquote it's pasted into: prefix
 * every line after the first with the current line's quote prefix (`> `,
 * `>> `, …). Lines that already begin a quote are left alone.
 */
export function addBlockquoteIndent(text: string, ctx: PasteContext): string {
  const lines = text.split('\n');
  if (lines.length < 2) return text;
  const m = ctx.lineBeforeCursor.match(/^(\s*>+\s?)/);
  const prefix = m ? m[1]! : '> ';
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*>/.test(lines[i]!)) lines[i] = prefix + lines[i];
  }
  return lines.join('\n');
}

/**
 * Full paste pipeline. Returns the text to insert; equal to `text` when
 * nothing changed (the caller then lets the native paste run, preserving
 * CodeMirror's own undo/scroll behaviour).
 */
export function formatPaste(text: string, settings: FormatSettings, ctx: PasteContext): string {
  let out = blockTrim(text);
  out = formatPasteSafe(out, settings);
  out = dedupeMarker(out, ctx);
  if (ctx.inBlockquote) {
    out = stripFootnoteRefs(out);
    out = addBlockquoteIndent(out, ctx);
  }
  return out;
}
