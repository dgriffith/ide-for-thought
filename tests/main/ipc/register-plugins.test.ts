/**
 * @vitest-environment node
 *
 * `register-plugins.ts` (#2634): every change goes through `changePlugins`
 * (so it's applied app-wide) and answers with the new list; install picks
 * the folder and asks Replace? natively in main; reveal takes only a plugin
 * id, never a path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
  showItemInFolder: vi.fn(),
  setPluginEnabled: vi.fn(),
  removePlugin: vi.fn(),
  installPluginFromFolder: vi.fn(),
  installPluginFromZip: vi.fn(),
  changed: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showOpenDialog: h.showOpenDialog, showMessageBox: h.showMessageBox },
  shell: { showItemInFolder: h.showItemInFolder },
}));
vi.mock('../../../src/main/ipc/helpers', () => ({ winFromEvent: () => ({ id: 1 }) }));
vi.mock('../../../src/main/plugins/registry', () => ({
  activePluginsDir: () => '/home/u/.minerva/plugins',
  pluginsAppVersion: () => '4.0.0',
  getPluginInventory: async () => ({
    installed: [{
      plugin: {
        manifest: { id: 'lab', name: 'Lab', version: '1.0.0', minerva: '>=4', description: 'Lab tools', author: 'Ada', contributes: {} },
        root: '/home/u/.minerva/plugins/lab', provenance: 'plugin:lab@1.0.0',
        contributions: [
          { point: 'skills', path: 'skills/a.md', absolutePath: '', kind: 'file' },
          { point: 'skills', path: 'skills/b.md', absolutePath: '', kind: 'file' },
          { point: 'object-types', path: 'types/t.md', absolutePath: '', kind: 'file' },
        ],
      },
      record: { enabled: false, source: { kind: 'folder', path: '/work/lab' }, installedAt: '2026-10-15T00:00:00Z' },
    }],
    errors: [{ folder: 'broken', label: 'broken', problems: ['It has no plugin.json.'] }],
  }),
}));
vi.mock('../../../src/main/plugins/lifecycle', async (orig) => ({
  PluginExistsError: (await orig<typeof import('../../../src/main/plugins/lifecycle')>()).PluginExistsError,
  setPluginEnabled: h.setPluginEnabled,
  removePlugin: h.removePlugin,
  installPluginFromFolder: h.installPluginFromFolder,
  installPluginFromZip: h.installPluginFromZip,
}));
vi.mock('../../../src/main/plugins-apply', () => ({
  changePlugins: async <T>(op: () => Promise<T>) => { const r = await op(); h.changed.push('applied'); return r; },
}));

import { registerPlugins } from '../../../src/main/ipc/register-plugins';
import { Channels } from '../../../src/shared/channels';
import { PluginExistsError } from '../../../src/main/plugins/lifecycle';

registerPlugins();
const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => await (h.handlers.get(channel)!({}, ...args) as Promise<T>);

const LIST = {
  installed: [{
    id: 'lab', name: 'Lab', version: '1.0.0', description: 'Lab tools', author: 'Ada', enabled: false,
    source: { kind: 'folder', path: '/work/lab' }, installedAt: '2026-10-15T00:00:00Z',
    contributes: { skills: 2, 'object-types': 1 },
  }],
  errors: [{ folder: 'broken', label: 'broken', problems: ['It has no plugin.json.'] }],
  folder: '/home/u/.minerva/plugins',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.changed.length = 0;
});

describe('register-plugins (#2634)', () => {
  it('lists what\'s installed, with counts per point, and the refused', async () => {
    expect(await call(Channels.PLUGINS_LIST)).toEqual(LIST);
  });

  it('enable / disable and remove apply app-wide, then answer with the list', async () => {
    expect(await call(Channels.PLUGINS_SET_ENABLED, 'lab', true)).toEqual(LIST);
    expect(h.setPluginEnabled).toHaveBeenCalledWith('/home/u/.minerva/plugins', 'lab', true);
    await call(Channels.PLUGINS_REMOVE, 'lab');
    expect(h.removePlugin).toHaveBeenCalledWith('/home/u/.minerva/plugins', 'lab');
    expect(h.changed).toEqual(['applied', 'applied']);
  });

  it('install: a cancelled picker is null and changes nothing', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await call(Channels.PLUGINS_INSTALL_FOLDER)).toBeNull();
    expect(h.installPluginFromFolder).not.toHaveBeenCalled();
    expect(h.changed).toEqual([]);
  });

  it('install: copies the picked folder in, and applies it', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/work/lab'] });
    h.installPluginFromFolder.mockResolvedValue({ manifest: { id: 'lab', name: 'Lab' } });
    expect(await call(Channels.PLUGINS_INSTALL_FOLDER)).toEqual({ id: 'lab', name: 'Lab' });
    expect(h.installPluginFromFolder).toHaveBeenCalledWith('/home/u/.minerva/plugins', '/work/lab', '4.0.0', { replace: false });
    expect(h.changed).toEqual(['applied']);
  });

  it('install over an installed id asks Replace? natively — Replace replaces, Cancel is null', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/work/lab'] });
    h.installPluginFromFolder.mockRejectedValueOnce(new PluginExistsError('lab')).mockResolvedValueOnce({ manifest: { id: 'lab', name: 'Lab' } });
    h.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await call(Channels.PLUGINS_INSTALL_FOLDER)).toEqual({ id: 'lab', name: 'Lab' });
    expect(h.installPluginFromFolder).toHaveBeenLastCalledWith('/home/u/.minerva/plugins', '/work/lab', '4.0.0', { replace: true });

    h.installPluginFromFolder.mockRejectedValueOnce(new PluginExistsError('lab'));
    h.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await call(Channels.PLUGINS_INSTALL_FOLDER)).toBeNull();
  });

  it('install from a zip: a .zip picker, then the archive is installed and applied', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/dl/lab.zip'] });
    h.installPluginFromZip.mockResolvedValue({ manifest: { id: 'lab', name: 'Lab' } });
    expect(await call(Channels.PLUGINS_INSTALL_ZIP)).toEqual({ id: 'lab', name: 'Lab' });
    expect(h.showOpenDialog).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({ properties: ['openFile'], filters: [{ name: 'Zip archive', extensions: ['zip'] }] }));
    expect(h.installPluginFromZip).toHaveBeenCalledWith('/home/u/.minerva/plugins', '/dl/lab.zip', '4.0.0', { replace: false });
    expect(h.changed).toEqual(['applied']);
  });

  it('install from a zip over an installed id asks Replace? too', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/dl/lab.zip'] });
    h.installPluginFromZip.mockRejectedValueOnce(new PluginExistsError('lab')).mockResolvedValueOnce({ manifest: { id: 'lab', name: 'Lab' } });
    h.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await call(Channels.PLUGINS_INSTALL_ZIP)).toEqual({ id: 'lab', name: 'Lab' });
    expect(h.installPluginFromZip).toHaveBeenLastCalledWith('/home/u/.minerva/plugins', '/dl/lab.zip', '4.0.0', { replace: true });
  });

  it('install refused: the problems reach the renderer', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/work/bad'] });
    h.installPluginFromFolder.mockRejectedValue(new Error('It can\'t be installed: "types/x.md" (object-types) doesn\'t exist.'));
    await expect(call(Channels.PLUGINS_INSTALL_FOLDER)).rejects.toThrow(/can't be installed/);
  });

  it('reveal shows the plugins folder or one plugin\'s — shown, never opened — by id only', async () => {
    await call(Channels.PLUGINS_REVEAL);
    await call(Channels.PLUGINS_REVEAL, 'lab');
    expect(h.showItemInFolder.mock.calls).toEqual([['/home/u/.minerva/plugins'], ['/home/u/.minerva/plugins/lab']]);
    await expect(call(Channels.PLUGINS_REVEAL, '../../etc')).rejects.toThrow(/isn't a plugin id/);
  });
});
