/**
 * Menu accelerator-collision check (#398).
 *
 * The cheapest valuable menu test: build the application menu
 * template, walk it, assert that no two items inside the same
 * top-level menu share an accelerator. CodeMirror's keymap is
 * separately tested; this catches the menu-side half of the cross-
 * keymap collision risk by at least flagging within-menu duplicates,
 * which would render the second item's accelerator dead.
 *
 * Mocks the entire Electron + project-state surface that menu.ts
 * pulls in — the production code queries focused-window state, recent
 * projects, saved queries, etc. at template-build time, and we don't
 * care about any of that for the accelerator walk.
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
}));

// ── The actual test ──────────────────────────────────────────────────────

import { rebuildMenu, collectAcceleratorsByMenu } from '../../src/main/menu';

describe('collectAcceleratorsByMenu (#398)', () => {
  it('returns empty for an empty template', () => {
    expect(collectAcceleratorsByMenu([])).toEqual(new Map());
  });

  it('skips top-level menus that have no accelerators', () => {
    const map = collectAcceleratorsByMenu([
      { label: 'Help', submenu: [{ label: 'About' /* no accelerator */ }] },
    ]);
    expect(map.size).toBe(0);
  });

  it('collects accelerators per top-level menu, with the path', () => {
    const map = collectAcceleratorsByMenu([
      {
        label: 'File',
        submenu: [
          { label: 'New', accelerator: 'CmdOrCtrl+N' },
          { label: 'Open', accelerator: 'CmdOrCtrl+O' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Copy', accelerator: 'CmdOrCtrl+C' },
        ],
      },
    ]);
    expect(map.get('File')?.map((e) => e.accelerator).sort())
      .toEqual(['CmdOrCtrl+N', 'CmdOrCtrl+O']);
    expect(map.get('Edit')?.map((e) => e.accelerator)).toEqual(['CmdOrCtrl+C']);
    expect(map.get('File')?.[0].path).toEqual(['File', 'New']);
  });

  it('descends into nested submenus', () => {
    const map = collectAcceleratorsByMenu([
      {
        label: 'View',
        submenu: [
          {
            label: 'Theme',
            submenu: [
              { label: 'Light', accelerator: 'CmdOrCtrl+1' },
              { label: 'Dark', accelerator: 'CmdOrCtrl+2' },
            ],
          },
        ],
      },
    ]);
    expect(map.get('View')?.map((e) => e.accelerator)).toEqual(['CmdOrCtrl+1', 'CmdOrCtrl+2']);
    expect(map.get('View')?.[0].path).toEqual(['View', 'Theme', 'Light']);
  });
});

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
