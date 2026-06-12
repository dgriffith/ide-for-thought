/**
 * CodeMirror theme builders for the editor (#672).
 *
 * Pure config extracted out of Editor.svelte: each returns a CodeMirror
 * `Extension`. The component still owns the compartments that swap these in/out
 * at runtime — this is just the styling, kept in one testable place.
 */

import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { getEffectiveTheme, getThemeMode } from '../theme';

/** oneDark in dark mode, an empty base in light/contrast — `minervaEditorTheme`
 *  layers the shared tokens on top either way. */
export function cmTheme(): Extension {
  return getEffectiveTheme(getThemeMode()) === 'dark' ? oneDark : [];
}

/** Minerva-specific gutter + active-line styling per IMPLEMENTATION.md §8.2.
 *  Layered on top of `cmTheme()` so both dark oneDark and the empty light base
 *  inherit the same tokens. */
export function minervaEditorTheme(): Extension {
  return EditorView.theme({
    '.cm-gutters': {
      backgroundColor: 'var(--bg)',
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
