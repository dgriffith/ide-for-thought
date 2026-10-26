/**
 * Plugin commands in the menu bar (#2879): `rebuildMenu` puts each at the
 * end of the menu its plugin names, under a separator after Minerva's own
 * items, with the key it kept as its accelerator, gated like a core command
 * (no thoughtbase → off). What each menu gets is `plugins/command-menu.ts`'s.
 */
import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';

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

vi.mock('../../src/main/plugins/command-menu', () => ({
  pluginMenuCommands: () => new Map([['edit', [{ pluginId: 'shelf', commandId: 'find', title: 'Find on the Shelf', when: 'selection', key: 'CmdOrCtrl+Alt+J' }]]]),
}));

import { rebuildMenu } from '../../src/main/menu';

describe('plugin commands in the menu bar (#2879)', () => {
  it('go at the end of the menu they name, after a separator, with their key, gated', () => {
    const edit = rebuildMenu().find((m) => m.label === 'Edit')!;
    const items = edit.submenu as Electron.MenuItemConstructorOptions[];
    const last = items.at(-1)!;
    expect(items.at(-2)).toEqual({ type: 'separator' });
    expect(last).toMatchObject({ label: 'Find on the Shelf', accelerator: 'CmdOrCtrl+Alt+J', enabled: false });
    expect(typeof last.click).toBe('function');
    expect(rebuildMenu().find((m) => m.label === 'View')!.submenu).not.toContainEqual(expect.objectContaining({ label: 'Find on the Shelf' }));
  });
});
