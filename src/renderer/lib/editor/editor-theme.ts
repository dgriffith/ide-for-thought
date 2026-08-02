/**
 * CodeMirror theme builders for the editor (#672).
 *
 * Pure config extracted out of Editor.svelte: each returns a CodeMirror
 * `Extension`. The component still owns the compartments that swap these in/out
 * at runtime — this is just the styling, kept in one testable place.
 */

import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { minervaSurfaceTheme, minervaSyntaxHighlighting } from './minerva-highlight';

/** The token-driven surface chrome + shared syntax highlight (#1117), replacing
 *  the old `oneDark` (dark) / empty (light) split. One palette for every theme;
 *  `minervaEditorTheme` layers the gutter / active-line tokens on top. Kept as a
 *  function so it can be reconfigured through the theme compartment on a theme
 *  swap (a no-op for the `var()`-based colors, which re-skin live). */
export function cmTheme(): Extension {
  return [minervaSurfaceTheme(), minervaSyntaxHighlighting()];
}

/** Minerva-specific gutter + active-line styling per IMPLEMENTATION.md §8.2.
 *  Layered on top of `cmTheme()`'s token-driven surface + highlight. */
export function minervaEditorTheme(): Extension {
  return EditorView.theme({
    '.cm-gutters': {
      // Match the content surface (--bg-inset, #1080) so the gutter and code
      // area read as one panel rather than a two-tone seam.
      backgroundColor: 'var(--bg-inset)',
      border: 'none',
      color: 'var(--text-faint)',
      fontFamily: 'var(--font-mono)',
    },
    '.cm-lineNumbers': { minWidth: '56px' },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 10px 0 0',
      color: 'var(--text-faint)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--accent)',
    },
    // Bar marks the boundary between gutters and content. Painting it on the
    // content row (rather than the gutter's right edge) means a single line
    // regardless of how many gutter columns are stacked — the compute gutter
    // would otherwise paint its own bar on fence lines, doubling up.
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in oklch, var(--accent) 6%, transparent)',
      boxShadow: 'inset 2px 0 0 var(--accent)',
    },
  });
}

/** Content + gutter font-size theme. */
export function fontSizeTheme(size: number): Extension {
  return EditorView.theme({
    '.cm-content': { fontSize: `${size}px` },
    '.cm-gutters': { fontSize: `${size}px` },
  });
}

/** Hides the line-number gutter (when the `lineNumbers` setting is off). The
 *  `!important` is required to beat @codemirror/view's built-in
 *  `.cm-gutter { display: flex !important }`. Swapped in via the line-numbers
 *  compartment at init and in applySettings. */
export function hiddenLineNumbersTheme(): Extension {
  return EditorView.theme({
    '.cm-gutter.cm-lineNumbers': { display: 'none !important' },
  });
}
