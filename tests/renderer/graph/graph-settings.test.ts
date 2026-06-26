/**
 * @vitest-environment jsdom
 *
 * Auto-navigate setting (#849) — persisted, off by default, toggleable.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getGraphSettings, __resetGraphSettingsForTests } from '../../../src/renderer/lib/stores/graph-settings.svelte';

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    },
    configurable: true,
  });
}
installFakeLocalStorage();

beforeEach(() => {
  localStorage.clear();
  __resetGraphSettingsForTests();
});

describe('graph auto-navigate setting', () => {
  it('defaults to off', () => {
    expect(getGraphSettings().autoNavigate).toBe(false);
  });

  it('persists when set, and surfaces the new value', () => {
    getGraphSettings().setAutoNavigate(true);
    expect(getGraphSettings().autoNavigate).toBe(true);
    expect(localStorage.getItem('minerva.graph.autoNavigate')).toBe('true');
  });

  it('toggles', () => {
    const s = getGraphSettings();
    s.toggleAutoNavigate();
    expect(s.autoNavigate).toBe(true);
    s.toggleAutoNavigate();
    expect(s.autoNavigate).toBe(false);
  });

  it('reads a persisted value on (re)load', () => {
    localStorage.setItem('minerva.graph.autoNavigate', 'true');
    __resetGraphSettingsForTests();
    expect(getGraphSettings().autoNavigate).toBe(true);
  });
});
