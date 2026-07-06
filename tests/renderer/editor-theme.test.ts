/**
 * @vitest-environment happy-dom
 *
 * Smoke coverage for the editor theme builders extracted from Editor.svelte
 * (#672). They return opaque CodeMirror extensions, so this just pins that each
 * builds without throwing — catching a broken `EditorView.theme(...)` spec.
 */
import { describe, it, expect } from 'vitest';
import { cmTheme, minervaEditorTheme, fontSizeTheme } from '../../src/renderer/lib/editor/editor-theme';

describe('editor-theme builders (#672)', () => {
  it('minervaEditorTheme builds an extension', () => {
    expect(minervaEditorTheme()).toBeTruthy();
  });

  it('fontSizeTheme builds an extension for a given size', () => {
    expect(fontSizeTheme(16)).toBeTruthy();
  });

  // After #1117 cmTheme is env-free (token-driven surface + shared highlight,
  // no theme-mode read), so it can build here without a DOM.
  it('cmTheme builds the token-driven surface + highlight', () => {
    expect(cmTheme()).toBeTruthy();
  });
});
