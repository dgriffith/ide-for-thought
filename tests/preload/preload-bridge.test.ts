/**
 * Contract test for the preload contextBridge surface (#676 / QA Q-H2).
 *
 * preload.ts (`contextBridge.exposeInMainWorld('api', { … })`) is the entire
 * renderer↔main bridge and had zero tests — the E2E smoke catches a broken
 * bridge only at boot. This loads the real preload against a mocked electron,
 * captures the exposed object, and pins its shape: the namespace set, that
 * every leaf is a function, and a snapshot of the full method surface so any
 * add / remove / rename of a bridge method is a deliberate, reviewed change.
 */

import { describe, it, expect, vi } from 'vitest';

const { exposed } = vi.hoisted(() => ({ exposed: {} }));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => { exposed[key] = api; },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn() },
}));

// Importing the preload runs exposeInMainWorld('api', …) as a side effect.
import '../../src/preload/preload';

const api = () => exposed.api as Record<string, Record<string, unknown>>;

/** namespace → sorted function-named keys. */
function methodShape(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [ns, val] of Object.entries(api())) {
    if (val && typeof val === 'object') {
      out[ns] = Object.entries(val)
        .filter(([, v]) => typeof v === 'function')
        .map(([k]) => k)
        .sort();
    }
  }
  return out;
}

describe('preload contextBridge contract (#676)', () => {
  it('exposes window.api', () => {
    expect(exposed.api).toBeTruthy();
    expect(typeof exposed.api).toBe('object');
  });

  it('exposes exactly the expected namespace set', () => {
    expect(Object.keys(api()).sort()).toEqual([
      'app', 'bibliography', 'bookmarks', 'citations', 'clipper', 'collections', 'compute',
      'conversations', 'csl', 'embeddings', 'export', 'files', 'formatter', 'git', 'graph',
      'links', 'menu', 'notebase', 'proposals', 'publish', 'queries',
      'refactor', 'search', 'shell', 'sites', 'skills', 'sources', 'tables',
      'tabs', 'tags', 'templates', 'tools', 'view',
    ]);
  });

  it('every leaf on every namespace is a function (no leaked non-callable)', () => {
    for (const [ns, methods] of Object.entries(api())) {
      for (const [name, val] of Object.entries(methods)) {
        expect(typeof val, `${ns}.${name}`).toBe('function');
      }
    }
  });

  it('keeps the Trust-critical proposals surface intact', () => {
    // The approval engine's renderer side — never let these silently vanish.
    for (const m of ['list', 'approve', 'reject'] as const) {
      expect(typeof api().proposals[m], `proposals.${m}`).toBe('function');
    }
  });

  it('matches the full method surface (snapshot — drift must be reviewed)', () => {
    expect(methodShape()).toMatchSnapshot();
  });
});
