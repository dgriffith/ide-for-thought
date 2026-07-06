/**
 * @vitest-environment jsdom
 *
 * Editor settings persistence (#1120 added `numberedHeadings`). The key
 * guarantee is the DEFAULTS merge: a user whose stored `editorSettings`
 * predates a new field still reads its default rather than `undefined`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getEditorSettings, saveEditorSettings } from '../../src/renderer/lib/editor/settings';

// Clean in-memory localStorage — the renderer harness only sets up a partial
// stub (same approach as command-palette.test.ts).
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    },
    configurable: true,
  });
}
installFakeLocalStorage();

describe('editor settings', () => {
  beforeEach(() => localStorage.clear());

  it('defaults numberedHeadings to false', () => {
    expect(getEditorSettings().numberedHeadings).toBe(false);
  });

  it('round-trips numberedHeadings through localStorage', () => {
    saveEditorSettings({ ...getEditorSettings(), numberedHeadings: true });
    expect(getEditorSettings().numberedHeadings).toBe(true);
  });

  it('fills numberedHeadings for settings stored before the field existed', () => {
    // Simulate an older persisted blob with no numberedHeadings key.
    localStorage.setItem(
      'editorSettings',
      JSON.stringify({ tabSize: 4, wordWrap: false, lineNumbers: true, showWhitespace: false, alwaysCollapseFrontmatter: false }),
    );
    const s = getEditorSettings();
    expect(s.tabSize).toBe(4);
    expect(s.numberedHeadings).toBe(false);
  });
});
