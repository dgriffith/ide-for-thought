/**
 * @vitest-environment happy-dom
 *
 * Smoke coverage for the editor theme builders extracted from Editor.svelte
 * (#672). They return opaque CodeMirror extensions, so this just pins that each
 * builds without throwing — catching a broken `EditorView.theme(...)` spec.
 */
import { describe, it, expect } from 'vitest';
import { minervaEditorTheme, fontSizeTheme } from '../../src/renderer/lib/editor/editor-theme';

describe('editor-theme builders (#672)', () => {
  it('minervaEditorTheme builds an extension', () => {
    expect(minervaEditorTheme()).toBeTruthy();
  });

  it('fontSizeTheme builds an extension for a given size', () => {
    expect(fontSizeTheme(16)).toBeTruthy();
  });
  // cmTheme reads the theme mode (localStorage/matchMedia) so it's exercised via
  // the app at runtime, not here — these two are the env-free pure builders.
});
