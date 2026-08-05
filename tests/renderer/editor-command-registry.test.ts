/**
 * @vitest-environment jsdom
 *
 * Editor command registry — default keybindings and the override merge.
 *
 * The guard that matters here is the `Alt-<letter>` one. On macOS Option is the
 * character-compose modifier, so the browser reports `event.key` as the composed
 * glyph (Option-Shift-m → "Â") rather than a plain letter. CodeMirror matches
 * bindings on that reported name, so an `Alt-<letter>` default silently never
 * fires on macOS *and* types a stray character into the note. That is exactly
 * how CodeMirror's own `Shift-Alt-m` default for `toggleTabFocusMode` became
 * unreachable, which is why this registry rebinds it to `Ctrl-m`.
 *
 * `Alt-<non-letter>` is fine and stays allowed — Option-ArrowUp doesn't compose,
 * which is why the existing Extend/Shrink Selection bindings are unaffected.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { COMMAND_REGISTRY, resolveKeyBindings, saveOverrides } from '../../src/renderer/lib/editor/command-registry';

// Clean in-memory localStorage — the renderer harness only sets up a partial
// stub (same approach as editor-settings.test.ts).
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

describe('editor command registry', () => {
  beforeEach(() => localStorage.clear());

  it('binds a default key to something', () => {
    // A guard over an empty registry would pass vacuously.
    expect(COMMAND_REGISTRY.filter((e) => e.defaultKey).length).toBeGreaterThan(5);
  });

  it('never defaults to Alt-<letter>, which macOS Option-composes away', () => {
    const trapped = COMMAND_REGISTRY
      .filter((e) => /(^|-)Alt-[A-Za-z]$/.test(e.defaultKey))
      .map((e) => `${e.id}: ${e.defaultKey}`);
    expect(
      trapped,
      'On macOS, Option turns these into a composed character, so the binding ' +
        'never fires and the glyph is typed into the note instead. Use Ctrl- or ' +
        'Mod- for letter keys; Alt- is only safe with non-letters (arrows, Tab).',
    ).toEqual([]);
  });

  it('keeps Tab-moves-focus reachable — the escape hatch for Tab-indents', () => {
    const entry = COMMAND_REGISTRY.find((e) => e.id === 'editor.toggleTabFocusMode');
    expect(entry, 'editor.toggleTabFocusMode must stay registered').toBeDefined();
    expect(entry!.defaultKey).toBe('Ctrl-m');
    expect(resolveKeyBindings().some((b) => b.key === 'Ctrl-m')).toBe(true);
  });

  it('assigns each default key to exactly one command', () => {
    const keys = COMMAND_REGISTRY.map((e) => e.defaultKey).filter(Boolean);
    expect([...new Set(keys)]).toHaveLength(keys.length);
  });

  it('lets a user override replace a default key', () => {
    saveOverrides([{ key: 'Ctrl-Alt-m', command: 'editor.toggleTabFocusMode' }]);
    const keys = resolveKeyBindings().map((b) => b.key);
    expect(keys).toContain('Ctrl-Alt-m');
    expect(keys).not.toContain('Ctrl-m');
  });

  it('drops a command whose default key is empty until it is bound', () => {
    const unbound = COMMAND_REGISTRY.find((e) => !e.defaultKey);
    expect(unbound, 'expected at least one intentionally unbound command').toBeDefined();
    saveOverrides([{ key: 'Ctrl-Alt-9', command: unbound!.id }]);
    expect(resolveKeyBindings().some((b) => b.key === 'Ctrl-Alt-9')).toBe(true);
  });
});
