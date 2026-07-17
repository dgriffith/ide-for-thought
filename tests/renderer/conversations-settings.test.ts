/**
 * @vitest-environment jsdom
 *
 * Conversations behavior settings — the "Open Conversations on project load"
 * boolean. Guards the DEFAULTS merge so a blob persisted before the field
 * existed still reads its default rather than `undefined`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConversationsSettings,
  setConversationsSettings,
  __resetConversationsSettingsForTests,
} from '../../src/renderer/lib/conversations/settings';

// The renderer harness only sets up a partial localStorage stub (missing
// clear), so install a clean in-memory one — same approach as editor-settings.
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

describe('conversations settings', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetConversationsSettingsForTests();
  });

  it('defaults openOnLoad to false (preserves launch-hidden behavior)', () => {
    expect(getConversationsSettings().openOnLoad).toBe(false);
  });

  it('round-trips openOnLoad through localStorage', () => {
    setConversationsSettings({ openOnLoad: true });
    expect(getConversationsSettings().openOnLoad).toBe(true);
    // Survives a fresh read of the persisted blob.
    __resetConversationsSettingsForTests();
    expect(getConversationsSettings().openOnLoad).toBe(true);
  });

  it('fills openOnLoad for a blob stored before the field existed', () => {
    localStorage.setItem('conversationsSettings', JSON.stringify({}));
    __resetConversationsSettingsForTests();
    expect(getConversationsSettings().openOnLoad).toBe(false);
  });
});
