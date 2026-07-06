/**
 * The single token-driven CodeMirror highlight + surface theme (#1117).
 *
 * Replaces the off-the-shelf `oneDark` theme, which ignored every design token
 * and dropped a cold `#282c34` slab with `#c678dd`/`#61afef`/`#98c379` syntax
 * colors into the warm "Honey" chrome. One `HighlightStyle`, shared by the note
 * editor (`editor-theme.ts`) and the query panel (`QueryPanel.svelte`), keeps
 * every code surface on the same palette.
 *
 * Colors are `var(--token)` references, not resolved hex. CodeMirror's
 * `HighlightStyle`/`EditorView.theme` emit their rules through a StyleModule —
 * plain CSS the browser resolves at paint — so `var(--iris)` re-skins live on a
 * theme swap with no rebuild, exactly as `minervaEditorTheme()`'s `var(--bg)`
 * gutters already do. (The theme-change hooks still reconfigure their
 * compartments; with `var()` colors that's simply a no-op for the palette.)
 *
 * Palette (tokens defined per theme in global.css, AA-verified on --bg-inset in
 * dark/light/contrast): iris keywords, honey/accent functions & headings, sage
 * strings, rust numbers/atoms, faint-italic comments, muted operators &
 * punctuation.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/** The shared token-driven highlight style. Stable (colors are `var()`), so a
 *  single instance serves every editor and re-skins via the CSS cascade. */
export const minervaHighlightStyle = HighlightStyle.define([
  // Keywords & control flow → iris.
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.modifier,
      t.self,
    ],
    color: 'var(--iris)',
  },
  // Types, classes, namespaces, markup tags → iris (structural, like keywords).
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName],
    color: 'var(--iris)',
  },
  // Functions, definitions, labels → honey (accent).
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.definition(t.function(t.variableName)),
      t.labelName,
      t.macroName,
    ],
    color: 'var(--accent)',
  },
  // Plain identifiers → body text.
  {
    tag: [t.variableName, t.propertyName, t.attributeName],
    color: 'var(--text)',
  },
  // Strings, regexps, links → sage.
  {
    tag: [t.string, t.special(t.string), t.regexp, t.link, t.url],
    color: 'var(--sage)',
  },
  // Numbers, booleans, atoms, escapes → rust.
  {
    tag: [t.number, t.integer, t.float, t.bool, t.atom, t.null, t.escape, t.character],
    color: 'var(--rust)',
  },
  // Comments → faint italic.
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--text-faint)',
    fontStyle: 'italic',
  },
  // Operators, punctuation, brackets, meta → muted.
  {
    tag: [
      t.operator,
      t.derefOperator,
      t.arithmeticOperator,
      t.logicOperator,
      t.compareOperator,
      t.bitwiseOperator,
      t.punctuation,
      t.separator,
      t.bracket,
      t.squareBracket,
      t.paren,
      t.brace,
      t.meta,
      t.annotation,
    ],
    color: 'var(--text-muted)',
  },
  // Markdown inline structure.
  { tag: t.heading, color: 'var(--accent)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  // Errors → rust (a signal color, not alarm red, per the UI philosophy).
  { tag: t.invalid, color: 'var(--rust)' },
]);

/** The shared highlighter extension for any CodeMirror instance. Non-fallback,
 *  so it wins over basicSetup's `defaultHighlightStyle` (which is registered as
 *  a fallback and only fills tags this style doesn't map). */
export function minervaSyntaxHighlighting(): Extension {
  return syntaxHighlighting(minervaHighlightStyle);
}

/** Token-driven surface chrome (background, cursor, selection, matches) that
 *  `oneDark` used to supply. Layered under `minervaEditorTheme()`'s gutter /
 *  active-line rules. Shared by the note editor and the query panel. */
export function minervaSurfaceTheme(): Extension {
  return EditorView.theme({
    '&': {
      color: 'var(--text)',
      backgroundColor: 'var(--bg)',
    },
    '.cm-content': {
      caretColor: 'var(--accent)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'color-mix(in oklch, var(--accent) 22%, transparent)',
      },
    '.cm-selectionMatch': {
      backgroundColor: 'color-mix(in oklch, var(--accent) 16%, transparent)',
    },
    '&.cm-focused .cm-matchingBracket, .cm-matchingBracket': {
      backgroundColor: 'color-mix(in oklch, var(--accent) 20%, transparent)',
      color: 'inherit',
      outline: '1px solid color-mix(in oklch, var(--accent) 40%, transparent)',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: 'color-mix(in oklch, var(--rust) 22%, transparent)',
    },
  });
}
