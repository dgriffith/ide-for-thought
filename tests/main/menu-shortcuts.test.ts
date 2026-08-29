/**
 * Menu-shortcuts reference + accelerator-collision check (#398, #804).
 *
 * The cheapest valuable menu test: build the application menu
 * template, walk it, assert that no two items inside the same
 * top-level menu share an accelerator. CodeMirror's keymap is
 * separately tested; this catches the menu-side half of the cross-
 * keymap collision risk by at least flagging within-menu duplicates,
 * which would render the second item's accelerator dead.
 *
 * `rebuildMenu()` / `getMenuShortcuts()` are impure — they build the real
 * Electron menu template and query project/window state — so this file still
 * mocks the entire Electron + project-state surface `menu.ts` pulls in at
 * template-build time. `collectAcceleratorsByMenu` / `formatAccelerator`
 * themselves are pure and Electron-free (moved to `menu/accelerators.ts`,
 * #1906); their own unit tests live mock-free in
 * `tests/main/menu/accelerators.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';

// ── Electron + project-state mocks ───────────────────────────────────────
//
// menu.ts imports BrowserWindow / Menu / shell / dialog / app from
// 'electron' plus a half-dozen project modules at top level. The
// template-build then queries them at call time. Stub each with the
// thinnest shape the build path actually touches.

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (t: unknown) => t,
    setApplicationMenu: () => undefined,
  },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromId: () => null,
  },
  shell: { openExternal: () => Promise.resolve() },
  dialog: {},
  app: { getPath: () => os.tmpdir() },
}));

vi.mock('../../src/main/recent-projects', () => ({
  getRecentProjects: () => [],
  clearRecentProjects: () => undefined,
}));

vi.mock('../../src/main/window-manager', () => ({
  createWindow: () => ({ webContents: { once: () => undefined, send: () => undefined } }),
  openProjectInWindow: async () => undefined,
  getRootPath: () => null,
}));

vi.mock('../../src/main/graph/index', () => ({ exportGraph: async () => undefined }));
vi.mock('../../src/main/project-context-types', () => ({ projectContext: () => ({}) }));
vi.mock('../../src/main/search/index', () => ({}));
vi.mock('../../src/main/sources/tables', () => ({}));
vi.mock('../../src/main/saved-queries', () => ({ listSavedQueries: () => [] }));
vi.mock('../../src/main/compute/python-kernel', () => ({ restartKernel: () => undefined }));
vi.mock('../../src/main/publish', () => ({
  listExporters: () => [],
  listExportGroups: () => [],
}));

// ── The actual test ──────────────────────────────────────────────────────

import { rebuildMenu, getMenuShortcuts } from '../../src/main/menu';
import { collectAcceleratorsByMenu } from '../../src/main/menu/accelerators';

describe('production menu has no within-menu accelerator collisions (#398)', () => {
  it('every top-level menu uses each accelerator at most once', () => {
    const template = rebuildMenu();
    const byMenu = collectAcceleratorsByMenu(template);
    const collisions: string[] = [];
    for (const [menuLabel, entries] of byMenu) {
      const seen = new Map<string, string[][]>();
      for (const { accelerator, path } of entries) {
        const list = seen.get(accelerator) ?? [];
        list.push(path);
        seen.set(accelerator, list);
      }
      for (const [acc, paths] of seen) {
        if (paths.length > 1) {
          collisions.push(
            `${menuLabel} ▸ ${acc} fires for ${paths.length} items: ${paths.map((p) => p.join(' › ')).join(' | ')}`,
          );
        }
      }
    }
    expect(collisions, collisions.join('\n')).toEqual([]);
  });
});

describe('getMenuShortcuts (#804)', () => {
  it('groups the live accelerators by top-level menu, top label dropped', () => {
    rebuildMenu(); // populate the cached template
    const groups = getMenuShortcuts();
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(typeof g.menu).toBe('string');
      expect(g.items.length).toBeGreaterThan(0);
      for (const item of g.items) {
        expect(item.label).not.toBe('');
        expect(item.keys).not.toBe('');
        // The top-level menu label is dropped from the item label.
        expect(item.label.startsWith(`${g.menu} › `)).toBe(false);
      }
    }
  });
});
