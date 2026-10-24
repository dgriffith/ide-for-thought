/**
 * @vitest-environment node
 *
 * `register-plugins.ts` (#2634): every change goes through `changePlugins`
 * (so it's applied app-wide) and answers with the new list; install picks
 * the folder and asks Replace? natively in main; reveal takes only a plugin
 * id, never a path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
  showItemInFolder: vi.fn(),
  setPluginEnabled: vi.fn(),
  setCorePluginEnabled: vi.fn(),
  confirmNative: vi.fn(),
  removePlugin: vi.fn(),
  installPluginFromFolder: vi.fn(),
  installPluginFromZip: vi.fn(),
  installPluginFromGit: vi.fn(),
  installPluginFromDraft: vi.fn(),
  saveSkillDraft: vi.fn(),
  saveDraftToFolder: vi.fn(),
  reloadSkills: vi.fn(),
  rebuildMenu: vi.fn(),
  readPluginSettings: vi.fn(),
  savePluginSettings: vi.fn(),
  encrypted: true,
  reconcile: vi.fn(),
  changed: [] as string[],
  openSession: vi.fn(),
  setSessionScope: vi.fn(),
  closeSession: vi.fn(),
  sessionEvent: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showOpenDialog: h.showOpenDialog, showMessageBox: h.showMessageBox },
  shell: { showItemInFolder: h.showItemInFolder },
}));
vi.mock('../../../src/main/ipc/helpers', () => ({
  winFromEvent: () => ({ id: 1 }),
  withRootPathOr: (_fallback: unknown, fn: (root: string, ...a: unknown[]) => unknown) => (_e: unknown, ...a: unknown[]) => fn('/tb', ...a),
  withRootPath: (fn: (root: string, ...a: unknown[]) => unknown) => (_e: unknown, ...a: unknown[]) => fn('/tb', ...a),
}));
vi.mock('../../../src/main/plugin-commands', () => ({ runPluginCommand: h.runCommand }));
vi.mock('../../../src/main/mcp-servers/registry', () => ({ reconcilePluginServers: h.reconcile }));
vi.mock('../../../src/main/plugins/settings', () => ({
  readPluginSettings: h.readPluginSettings,
  savePluginSettings: h.savePluginSettings,
}));
vi.mock('../../../src/main/secret-storage', () => ({
  secretStorageStatus: () => ({ encrypted: h.encrypted, reason: h.encrypted ? 'os-keystore' : 'no-keystore' }),
}));
vi.mock('../../../src/main/plugins/recommendations', () => ({
  pluginRecommendations: async (root: string) => [{ id: 'lab', types: [], status: 'missing', root }],
}));
vi.mock('../../../src/main/plugins/registry', () => ({
  activePluginsDir: () => '/home/u/.minerva/plugins',
  pluginsAppVersion: () => '4.0.0',
  getPluginInventory: async () => ({
    installed: [{
      plugin: {
        manifest: { id: 'lab', name: 'Lab', version: '1.0.0', minerva: '>=4', description: 'Lab tools', author: 'Ada', contributes: {}, settings: [{ key: 'token', title: 'Token', kind: 'secret' }] },
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
vi.mock('../../../src/main/plugins/lifecycle', () => ({
  setPluginEnabled: h.setPluginEnabled,
  removePlugin: h.removePlugin,
  installPluginFromFolder: h.installPluginFromFolder,
  installPluginFromZip: h.installPluginFromZip,
  installPluginFromGit: h.installPluginFromGit,
  installPluginFromDraft: h.installPluginFromDraft,
}));
vi.mock('../../../src/main/extensions/draft-apply', () => ({ saveSkillDraft: h.saveSkillDraft, saveDraftToFolder: h.saveDraftToFolder }));
vi.mock('../../../src/main/skills/register', () => ({ reloadAndRegisterSkills: h.reloadSkills }));
vi.mock('../../../src/main/menu', () => ({ rebuildMenu: h.rebuildMenu }));
vi.mock('../../../src/main/native-confirm', () => ({ confirmNative: h.confirmNative }));
vi.mock('../../../src/main/plugins/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/main/plugins/core')>(),
  setCorePluginEnabled: h.setCorePluginEnabled,
}));
vi.mock('../../../src/main/plugins-apply', () => ({
  changePlugins: async <T>(op: () => Promise<T>) => { const r = await op(); h.changed.push('applied'); return r; },
}));

vi.mock('../../../src/main/plugin-sessions', () => ({
  openPluginSession: h.openSession,
  setPluginSessionScope: h.setSessionScope,
  closePluginSession: h.closeSession,
  sendPluginSessionEvent: h.sessionEvent,
}));

import { registerPlugins } from '../../../src/main/ipc/register-plugins';
import { _setCorePluginsForTests } from '../../../src/main/plugins/core';
import { Channels } from '../../../src/shared/channels';
import type { ReplacePolicy } from '../../../src/main/plugins/lifecycle';
import { pendingExtensionDrafts } from '../../../src/main/ipc/extension-draft-offers';
import type { ExtensionDraftOutcome } from '../../../src/shared/extensions/drafts';

registerPlugins();
const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => await (h.handlers.get(channel)!({}, ...args) as Promise<T>);

/** An install that finds "lab" already there, and asks its replace policy. */
const overInstalled = async (...args: unknown[]) => {
  const { replace } = args[3] as { replace: ReplacePolicy };
  return typeof replace === 'function' && (await replace('lab')) ? { manifest: { id: 'lab', name: 'Lab' } } : null;
};

const LIST = {
  // The built-in plugins as shipped (#2820): Python, off on a new install
  // (#2822), Kanban (#2828), Timeline and Calendar (#2829), on, and the
  // Reading Queue (#2640), off, listed with the global view it draws.
  core: [{
    id: 'python', name: 'Python', version: '1.0.0',
    description: 'Run Python code cells in notes, in an interpreter you choose: pandas, numpy, matplotlib and anything else you install.',
    enabled: false, source: { kind: 'core' }, contributes: {}, capabilities: ['process'],
  }, {
    id: 'kanban', name: 'Kanban', version: '1.0.0',
    description: 'Show a type view as a board: a column per option of a choice property, cards you drag between them.',
    enabled: true, source: { kind: 'core' }, contributes: {}, capabilities: ['notes:read', 'notes:write-properties', 'ui'],
  }, {
    id: 'timeline', name: 'Timeline', version: '1.0.0',
    description: 'Show a type view on a time axis: each dated note a point or a bar, zoomed and panned with the pointer or the keyboard.',
    enabled: true, source: { kind: 'core' }, contributes: {}, capabilities: ['notes:read', 'ui'],
  }, {
    id: 'calendar', name: 'Calendar', version: '1.0.0',
    description: 'Show a type view as a month grid: each dated note on its day, dragged to another day to reschedule it.',
    enabled: true, source: { kind: 'core' }, contributes: {}, capabilities: ['notes:read', 'notes:write-properties', 'ui'],
  }, {
    id: 'reading-queue', name: 'Reading Queue', version: '1.0.0',
    description: "A sidebar panel of the books and articles you're reading and those still to read, each marked read with one click — and a reading-queue block to put the same list in a note.",
    enabled: false, source: { kind: 'core' }, contributes: {}, capabilities: ['graph:query', 'notes:write-properties', 'ui'],
    views: [{ id: 'queue', title: 'Reading Queue', place: 'left-sidebar', entry: 'index.html', query: 'queue.rq', icon: 'bookmark' }],
    blocks: [{ id: 'queue', title: 'Reading queue', fence: 'reading-queue', entry: 'index.html', query: 'queue.rq' }],
  }, {
    id: 'list-tools', name: 'List Tools', version: '1.0.0',
    description: "Sort the Markdown list in your selection, from the command palette or the editor's right-click menu. Nested items move with their parent.",
    enabled: false, source: { kind: 'core' }, contributes: {}, capabilities: ['notes:read'],
    commands: [{ id: 'sort-selection', title: 'Sort List in Selection', when: 'selection', editorMenu: true, run: { handler: 'sortSelection' } }],
  }],
  installed: [{
    id: 'lab', name: 'Lab', version: '1.0.0', description: 'Lab tools', author: 'Ada', enabled: false,
    source: { kind: 'folder', path: '/work/lab' }, installedAt: '2026-10-15T00:00:00Z',
    contributes: { skills: 2, 'object-types': 1 }, settings: 1,
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
    expect(h.installPluginFromFolder).toHaveBeenCalledWith('/home/u/.minerva/plugins', '/work/lab', '4.0.0', { replace: expect.any(Function) });
    expect(h.changed).toEqual(['applied']);
  });

  it('install over an installed id asks Replace? natively — Replace replaces, Cancel is null', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/work/lab'] });
    h.installPluginFromFolder.mockImplementation(overInstalled);
    h.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await call(Channels.PLUGINS_INSTALL_FOLDER)).toEqual({ id: 'lab', name: 'Lab' });
    expect(h.showMessageBox).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({ message: 'A plugin "lab" is already installed.' }));
    expect(h.installPluginFromFolder).toHaveBeenCalledTimes(1); // asked mid-install, not installed twice

    h.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await call(Channels.PLUGINS_INSTALL_FOLDER)).toBeNull();
  });

  it('install from a zip: a .zip picker, then the archive is installed and applied', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/dl/lab.zip'] });
    h.installPluginFromZip.mockResolvedValue({ manifest: { id: 'lab', name: 'Lab' } });
    expect(await call(Channels.PLUGINS_INSTALL_ZIP)).toEqual({ id: 'lab', name: 'Lab' });
    expect(h.showOpenDialog).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({ properties: ['openFile'], filters: [{ name: 'Zip archive', extensions: ['zip'] }] }));
    expect(h.installPluginFromZip).toHaveBeenCalledWith('/home/u/.minerva/plugins', '/dl/lab.zip', '4.0.0', { replace: expect.any(Function) });
    expect(h.changed).toEqual(['applied']);
  });

  it('install from a zip over an installed id asks Replace? too', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/dl/lab.zip'] });
    h.installPluginFromZip.mockImplementation(overInstalled);
    h.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await call(Channels.PLUGINS_INSTALL_ZIP)).toEqual({ id: 'lab', name: 'Lab' });
    expect(h.installPluginFromZip).toHaveBeenCalledTimes(1);
  });

  it('install from a git URL: the typed URL goes to main\'s installer, applied; Replace? asked once', async () => {
    h.installPluginFromGit.mockResolvedValueOnce({ manifest: { id: 'lab', name: 'Lab' } });
    expect(await call(Channels.PLUGINS_INSTALL_GIT, 'https://github.com/ada/lab#v1.0.0')).toEqual({ id: 'lab', name: 'Lab' });
    expect(h.installPluginFromGit).toHaveBeenCalledWith('/home/u/.minerva/plugins', 'https://github.com/ada/lab#v1.0.0', '4.0.0', { replace: expect.any(Function) });
    expect(h.changed).toEqual(['applied']);

    h.installPluginFromGit.mockImplementation(overInstalled);
    h.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await call(Channels.PLUGINS_INSTALL_GIT, 'https://github.com/ada/lab')).toBeNull();
    expect(h.installPluginFromGit).toHaveBeenCalledTimes(2); // fetched once per install, never again to replace
    await expect(call(Channels.PLUGINS_INSTALL_GIT, 42)).rejects.toThrow(/git URL/);
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

  it('recommendations reads the window\'s thoughtbase, and changes nothing (#2635)', async () => {
    expect(await call(Channels.PLUGINS_RECOMMENDATIONS)).toEqual([{ id: 'lab', types: [], status: 'missing', root: '/tb' }]);
    expect(h.changed).toEqual([]);
    expect(h.installPluginFromGit).not.toHaveBeenCalled();
  });

  it('settings: an installed plugin\'s view, with whether secrets would be encrypted (#2636)', async () => {
    const secretField = { key: 'token', title: 'Token', kind: 'secret' };
    h.readPluginSettings.mockResolvedValue({ fields: [secretField], values: {}, secretsSet: { token: true } });
    expect(await call(Channels.PLUGINS_SETTINGS, 'lab')).toEqual({ fields: [secretField], values: {}, secretsSet: { token: true }, secretsEncrypted: true });
    expect(h.readPluginSettings.mock.calls[0]![0]).toBe('/home/u/.minerva/plugins');
    expect(h.readPluginSettings.mock.calls[0]![1]).toMatchObject({ id: 'lab' });

    h.encrypted = false;
    h.savePluginSettings.mockResolvedValue({ fields: [secretField], values: {}, secretsSet: { token: false } });
    expect(await call(Channels.PLUGINS_SET_SETTINGS, 'lab', { token: null })).toMatchObject({ secretsEncrypted: false });
    expect(h.savePluginSettings.mock.calls[0]![2]).toEqual({ token: null });
    // A plugin's MCP servers get the new values (#2646).
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    h.encrypted = true;

    // No secret fields: nothing to say about storage.
    h.readPluginSettings.mockResolvedValue({ fields: [], values: {}, secretsSet: {} });
    expect(await call(Channels.PLUGINS_SETTINGS, 'lab')).toEqual({ fields: [], values: {}, secretsSet: {} });
  });

  it('settings refuses an id that isn\'t installed, or a malformed patch', async () => {
    await expect(call(Channels.PLUGINS_SETTINGS, '../../etc')).rejects.toThrow(/isn't a plugin id/);
    await expect(call(Channels.PLUGINS_SETTINGS, 'other')).rejects.toThrow(/No plugin "other" is installed/);
    await expect(call(Channels.PLUGINS_SET_SETTINGS, 'lab', ['x'])).rejects.toThrow(/must be an object/);
    await expect(call(Channels.PLUGINS_SET_SETTINGS, 'lab', null)).rejects.toThrow(/must be an object/);
    expect(h.savePluginSettings).not.toHaveBeenCalled();
  });
});

describe('core plugins (#2820)', () => {
  const CORE = { id: 'python', name: 'Python cells', version: '1.0.0', minerva: '>=4.0.0', description: 'Run Python in a note.', contributes: {}, code: { capabilities: ['process'] } };
  beforeEach(() => { _setCorePluginsForTests([{ manifest: CORE, defaultEnabled: false }]); });
  afterEach(() => { _setCorePluginsForTests(null); });

  it('are listed apart from installed plugins, at their default state, built in', async () => {
    const list = await call<{ core: unknown[] }>(Channels.PLUGINS_LIST);
    expect(list.core).toEqual([{
      id: 'python', name: 'Python cells', version: '1.0.0', description: 'Run Python in a note.',
      enabled: false, source: { kind: 'core' }, contributes: {}, capabilities: ['process'],
    }]);
  });

  it('a toggle goes to the core setter, applied app-wide; the installed-plugin setter is not touched', async () => {
    h.confirmNative.mockResolvedValue({ confirmed: true, checked: false });
    await call(Channels.PLUGINS_SET_ENABLED, 'python', true);
    expect(h.setCorePluginEnabled).toHaveBeenCalledWith('/home/u/.minerva/plugins', 'python', true);
    expect(h.setPluginEnabled).not.toHaveBeenCalled();
    expect(h.changed).toEqual(['applied']);
  });

  it('turning on one whose code runs programs asks natively first, saying what it can do (#2821)', async () => {
    h.confirmNative.mockResolvedValue({ confirmed: true, checked: false });
    await call(Channels.PLUGINS_SET_ENABLED, 'python', true);
    expect(h.confirmNative).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({
      message: 'Turn on Python cells?',
      confirmLabel: 'Turn On',
      detail: expect.stringContaining('Run Python in a note.\n\nIt can run a program on this machine.'),
    }));
    expect(h.setCorePluginEnabled).toHaveBeenCalledWith('/home/u/.minerva/plugins', 'python', true);
  });

  it('declined, nothing changes, and the list comes back as it was (#2821)', async () => {
    h.confirmNative.mockResolvedValue({ confirmed: false, checked: false });
    const list = await call<{ core: Array<{ enabled: boolean }> }>(Channels.PLUGINS_SET_ENABLED, 'python', true);
    expect(h.setCorePluginEnabled).not.toHaveBeenCalled();
    expect(h.changed).toEqual([]);
    expect(list.core[0]!.enabled).toBe(false);
  });

  it('turning one off, or on when its code runs no programs, asks nothing (#2821)', async () => {
    await call(Channels.PLUGINS_SET_ENABLED, 'python', false);
    _setCorePluginsForTests([{ manifest: { ...CORE, id: 'kanban', code: { capabilities: ['notes:read'], api: '^1.0.0' } }, defaultEnabled: false }]);
    await call(Channels.PLUGINS_SET_ENABLED, 'kanban', true);
    expect(h.confirmNative).not.toHaveBeenCalled();
    expect(h.setCorePluginEnabled).toHaveBeenCalledTimes(2);
  });

  it('can\'t be removed or revealed: they have no folder', async () => {
    await expect(call(Channels.PLUGINS_REMOVE, 'python')).rejects.toThrow(/built into Minerva; it can be turned off, not removed/);
    expect(h.removePlugin).not.toHaveBeenCalled();
    await expect(call(Channels.PLUGINS_REVEAL, 'python')).rejects.toThrow(/built into Minerva; it has no folder/);
    expect(h.showItemInFolder).not.toHaveBeenCalled();
  });
});

describe('a drafted extension\'s card (#2652)', () => {
  const SKILL = { kind: 'skill' as const, id: 'my.weekly', name: 'Weekly', summary: 's', files: [{ path: 'weekly.md', content: '---' }] };
  const PLUGIN = { kind: 'plugin' as const, id: 'lab', name: 'Lab', summary: 's', files: [{ path: 'plugin.json', content: '{}' }] };
  let settled: ExtensionDraftOutcome[];
  const offer = (draft: typeof SKILL | typeof PLUGIN, winId = 1) => {
    pendingExtensionDrafts.set('o1', { winId, draft, settle: (o) => { settled.push(o); pendingExtensionDrafts.delete('o1'); } });
  };
  beforeEach(() => { settled = []; pendingExtensionDrafts.clear(); });

  it('answers only the window that was shown it, and only while it waits', async () => {
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'nope', 'save')).toEqual({ ok: false, error: 'This draft is no longer waiting for an answer.' });
    offer(SKILL, 2);
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'o1', 'save')).toMatchObject({ ok: false });
    expect(h.saveSkillDraft).not.toHaveBeenCalled();
    expect(settled).toEqual([]);
  });

  it('saves a skill from main\'s copy, then reloads the skills and the menu', async () => {
    offer(SKILL);
    h.saveSkillDraft.mockResolvedValue('/home/u/.minerva/skills/weekly.md');
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'o1', 'save')).toEqual({ ok: true, action: 'save', where: '/home/u/.minerva/skills/weekly.md' });
    expect(h.saveSkillDraft).toHaveBeenCalledWith(SKILL);
    expect(h.reloadSkills).toHaveBeenCalled();
    expect(h.rebuildMenu).toHaveBeenCalled();
    expect(settled).toEqual([{ kind: 'saved', where: '/home/u/.minerva/skills/weekly.md' }]);
  });

  it('installs a plugin app-wide, asking natively before replacing one', async () => {
    offer(PLUGIN);
    h.installPluginFromDraft.mockImplementation(overInstalled);
    h.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'o1', 'save')).toEqual({ ok: true, action: 'save', where: '/home/u/.minerva/plugins/lab' });
    expect(h.installPluginFromDraft).toHaveBeenCalledWith('/home/u/.minerva/plugins', PLUGIN.files, '4.0.0', expect.anything());
    expect(h.changed).toEqual(['applied']);
    expect(settled).toEqual([{ kind: 'saved', where: '/home/u/.minerva/plugins/lab' }]);
  });

  it('a declined replace, a cancelled picker or a failed save keeps the card waiting', async () => {
    offer(PLUGIN);
    h.installPluginFromDraft.mockImplementation(overInstalled);
    h.showMessageBox.mockResolvedValue({ response: 1 });
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'o1', 'save')).toEqual({ ok: false, cancelled: true });
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'o1', 'save-folder')).toEqual({ ok: false, cancelled: true });
    h.installPluginFromDraft.mockRejectedValue(new Error('It can\'t be installed: nope'));
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'o1', 'save')).toEqual({ ok: false, error: 'It can\'t be installed: nope' });
    expect(settled).toEqual([]);
    expect(pendingExtensionDrafts.has('o1')).toBe(true);
  });

  it('saves into the folder the user picks', async () => {
    offer(PLUGIN);
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/work'] });
    h.saveDraftToFolder.mockResolvedValue('/work/lab');
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'o1', 'save-folder')).toEqual({ ok: true, action: 'save-folder', where: '/work/lab' });
    expect(h.saveDraftToFolder).toHaveBeenCalledWith(PLUGIN, '/work');
    expect(settled).toEqual([{ kind: 'saved-folder', where: '/work/lab' }]);
  });

  it('anything else is Not now: nothing is written', async () => {
    offer(SKILL);
    expect(await call(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, 'o1', 'rm -rf')).toEqual({ ok: true, action: 'dismiss' });
    expect(settled).toEqual([{ kind: 'dismissed' }]);
    expect(h.saveSkillDraft).not.toHaveBeenCalled();
    expect(h.installPluginFromDraft).not.toHaveBeenCalled();
  });
});

describe('plugin sessions (#2825)', () => {
  it('opens, rescopes and closes a session for the calling window, passing only strings as scope', async () => {
    h.openSession.mockReturnValue({ sessionId: 's1' });
    expect(await call(Channels.PLUGINS_OPEN_SESSION, 'board', ['a.md', 7, null, 'b.md'])).toEqual({ sessionId: 's1' });
    expect(h.openSession).toHaveBeenCalledWith({ id: 1 }, 'board', ['a.md', 'b.md'], undefined);
    await call(Channels.PLUGINS_SET_SESSION_SCOPE, 's1', 'not-a-list');
    expect(h.setSessionScope).toHaveBeenCalledWith({ id: 1 }, 's1', []);
    await call(Channels.PLUGINS_CLOSE_SESSION, 's1');
    expect(h.closeSession).toHaveBeenCalledWith({ id: 1 }, 's1');
  });

  it('refuses an id that is not a plugin id before opening anything', async () => {
    h.openSession.mockClear();
    await expect(call(Channels.PLUGINS_OPEN_SESSION, '../evil', [])).rejects.toThrow("isn't a plugin id");
    expect(h.openSession).not.toHaveBeenCalled();
  });

  it("opens a global view's session by the view's id, and refuses one that isn't an id (#2640)", async () => {
    h.openSession.mockClear();
    h.openSession.mockReturnValue({ sessionId: 'gv' });
    expect(await call(Channels.PLUGINS_OPEN_SESSION, 'reading-queue', [], { view: 'queue' })).toEqual({ sessionId: 'gv' });
    expect(h.openSession).toHaveBeenCalledWith({ id: 1 }, 'reading-queue', [], { view: 'queue' });
    await expect(call(Channels.PLUGINS_OPEN_SESSION, 'reading-queue', [], { view: '../q' })).rejects.toThrow("isn't a view id");
    expect(h.openSession).toHaveBeenCalledTimes(1);
  });

  it("opens a live block's session with its note and text, checked for shape (#2641)", async () => {
    h.openSession.mockClear();
    h.openSession.mockReturnValue({ sessionId: 'lb' });
    const block = { block: 'queue', notePath: 'n.md', source: 'limit: 2', exportMode: true };
    expect(await call(Channels.PLUGINS_OPEN_SESSION, 'reading-queue', ['ignored.md'], block)).toEqual({ sessionId: 'lb' });
    expect(h.openSession).toHaveBeenCalledWith({ id: 1 }, 'reading-queue', ['ignored.md'], block);
    await expect(call(Channels.PLUGINS_OPEN_SESSION, 'reading-queue', [], { block: 'Bad', notePath: 'n.md', source: '' })).rejects.toThrow("isn't a block id");
    await expect(call(Channels.PLUGINS_OPEN_SESSION, 'reading-queue', [], { block: 'queue', notePath: '', source: '' })).rejects.toThrow("A block's note must be a path");
    await expect(call(Channels.PLUGINS_OPEN_SESSION, 'reading-queue', [], { block: 'queue', notePath: 'n.md', source: 'x'.repeat(300_000) })).rejects.toThrow("A block's text is at most");
    await expect(call(Channels.PLUGINS_OPEN_SESSION, 'reading-queue', [], 'queue')).rejects.toThrow('A session target is a view or a block');
    expect(h.openSession).toHaveBeenCalledTimes(1);
  });
});

describe('plugin session events (#2827)', () => {
  it('passes a theme or a drop on, and refuses anything else', async () => {
    const drop = { kind: 'drop', paths: ['a.md'], x: 1, y: 2 };
    await call(Channels.PLUGINS_SESSION_EVENT, 's1', drop);
    expect(h.sessionEvent).toHaveBeenCalledWith({ id: 1 }, 's1', drop);
    await expect(call(Channels.PLUGINS_SESSION_EVENT, 's1', { kind: 'approve' })).rejects.toThrow('a theme, a drop, a view, an export request, a preview or a query refresh');
    await expect(call(Channels.PLUGINS_SESSION_EVENT, 's1', null)).rejects.toThrow('a theme, a drop, a view, an export request, a preview or a query refresh');
    await call(Channels.PLUGINS_SESSION_EVENT, 's1', { kind: 'exportRequest', requestId: 'r' });
    expect(h.sessionEvent).toHaveBeenLastCalledWith({ id: 1 }, 's1', { kind: 'exportRequest', requestId: 'r' });
    await call(Channels.PLUGINS_SESSION_EVENT, 's1', { kind: 'view', state: {} });
    expect(h.sessionEvent).toHaveBeenLastCalledWith({ id: 1 }, 's1', { kind: 'view', state: {} });
    await call(Channels.PLUGINS_SESSION_EVENT, 's1', { kind: 'refreshQuery' });
    expect(h.sessionEvent).toHaveBeenLastCalledWith({ id: 1 }, 's1', { kind: 'refreshQuery' });
  });
});

describe('plugin commands (#2643)', () => {
  it('runs a command in the thoughtbase, passing on only a string note and selection', async () => {
    h.runCommand.mockResolvedValue({ kind: 'result', replaceSelection: 'x' });
    expect(await call(Channels.PLUGINS_RUN_COMMAND, 'list-tools', 'sort-selection', { note: 'a.md', selection: '- b\n- a', extra: 1 }))
      .toEqual({ kind: 'result', replaceSelection: 'x' });
    expect(h.runCommand).toHaveBeenCalledWith('/tb', 'list-tools', 'sort-selection', { note: 'a.md', selection: '- b\n- a' });
    await call(Channels.PLUGINS_RUN_COMMAND, 'list-tools', 'sort-selection', { note: 7, selection: null });
    expect(h.runCommand).toHaveBeenLastCalledWith('/tb', 'list-tools', 'sort-selection', {});
  });

  it('refuses an id that is not a plugin id before running anything', async () => {
    h.runCommand.mockClear();
    await expect(call(Channels.PLUGINS_RUN_COMMAND, '../evil', 'x', {})).rejects.toThrow("isn't a plugin id");
    expect(h.runCommand).not.toHaveBeenCalled();
  });
});
