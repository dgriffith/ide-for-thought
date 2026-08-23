/**
 * Direct handler tests for the six smallest IPC registrars (#1840).
 *
 * `tags`, `sites`, `git`, `views`, `clipper` and `app` are each under 50 lines
 * and were all in `KNOWN_UNTESTED`. They share a file because they share a
 * harness and none of them justifies its own: what's interesting about them is
 * mostly the project-scoping decision each handler makes, which is exactly what
 * CLAUDE.md's #1631 rules are about and exactly what nothing was checking.
 *
 * Each `describe` drives the real `register*()` with its domain module mocked,
 * and the project-scoping helpers reproduced (not stubbed away) so a handler
 * that swaps `withRootPath` for `withRootPathOr` — or drops the guard — fails
 * here rather than shipping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROOT = '/vault';
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/** What `rootPathFromEvent` reports; `null` models "no project open". */
let openProject: string | null = ROOT;

const { handlers, listeners, h } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  listeners: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  h: {
    // graph (tags)
    listTags: vi.fn(), notesByTag: vi.fn(), notesByTagPrefix: vi.fn(),
    sourcesByTag: vi.fn(), allTags: vi.fn(),
    // privileged sites
    listSites: vi.fn(), addSite: vi.fn(), removeSite: vi.fn(),
    logoutSite: vi.fn(), openLoginWindow: vi.fn(),
    // git
    getStatus: vi.fn(), commitAll: vi.fn(),
    // saved views
    listSavedViews: vi.fn(), saveView: vi.fn(), deleteView: vi.fn(),
    renameView: vi.fn(), setViewOrder: vi.fn(),
    // clipper
    getClipperConfig: vi.fn(), setClipperEnabled: vi.fn(), regenerateClipperSecret: vi.fn(),
    getClipperInfo: vi.fn(), applyClipperConfigChange: vi.fn(),
    // menu (app)
    getMenuShortcuts: vi.fn(), setMenuThemeMode: vi.fn(), setMenuEditorState: vi.fn(),
    fromWebContents: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); },
    on: (channel: string, fn: Handler) => { listeners.set(channel, fn); },
  },
  app: { getName: () => 'Minerva', getVersion: () => '2.0.0-test' },
  BrowserWindow: { fromWebContents: (...a: unknown[]) => h.fromWebContents(...a) },
}));

// The real project-scoping semantics, not a stub: `withRootPath` throws with no
// project, `withRootPathOr` answers its fallback. A registrar that picks the
// wrong one is the bug class these tests exist to catch.
vi.mock('../../../src/main/ipc/helpers', () => ({
  rootPathFromEvent: () => openProject,
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, ...args);
      },
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (openProject ? fn(openProject, ...args) : fallback),
}));

vi.mock('../../../src/main/graph/index', () => ({
  listTags: h.listTags, notesByTag: h.notesByTag, notesByTagPrefix: h.notesByTagPrefix,
  sourcesByTag: h.sourcesByTag, allTags: h.allTags,
}));
vi.mock('../../../src/main/project-context-types', () => ({
  projectContext: (rootPath: string) => ({ rootPath }),
}));
vi.mock('../../../src/main/privileged-sites', () => ({
  listSites: h.listSites, addSite: h.addSite, removeSite: h.removeSite,
  logoutSite: h.logoutSite, openLoginWindow: h.openLoginWindow,
}));
vi.mock('../../../src/main/git/index', () => ({ getStatus: h.getStatus, commitAll: h.commitAll }));
vi.mock('../../../src/main/saved-views', () => ({
  listSavedViews: h.listSavedViews, saveView: h.saveView, deleteView: h.deleteView,
  renameView: h.renameView, setViewOrder: h.setViewOrder,
}));
vi.mock('../../../src/main/clipper/clipper-config', () => ({
  getClipperConfig: h.getClipperConfig,
  setClipperEnabled: h.setClipperEnabled,
  regenerateClipperSecret: h.regenerateClipperSecret,
}));
vi.mock('../../../src/main/clipper/lifecycle', () => ({ getClipperInfo: h.getClipperInfo }));
vi.mock('../../../src/main/window-manager', () => ({ applyClipperConfigChange: h.applyClipperConfigChange }));
vi.mock('../../../src/main/menu', () => ({
  getMenuShortcuts: h.getMenuShortcuts,
  setMenuThemeMode: h.setMenuThemeMode,
  setMenuEditorState: h.setMenuEditorState,
}));

import { Channels } from '../../../src/shared/channels';
import { registerTags } from '../../../src/main/ipc/register-tags';
import { registerSites } from '../../../src/main/ipc/register-sites';
import { registerGit } from '../../../src/main/ipc/register-git';
import { registerViews } from '../../../src/main/ipc/register-views';
import { registerClipper } from '../../../src/main/ipc/register-clipper';
import { registerApp } from '../../../src/main/ipc/register-app';

registerTags();
registerSites();
registerGit();
registerViews();
registerClipper();
registerApp();

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
const send = (channel: string, event: unknown, ...args: unknown[]) => listeners.get(channel)!(event, ...args);

beforeEach(() => {
  openProject = ROOT;
  vi.clearAllMocks();
});

describe('register-tags (#1840)', () => {
  const cases: Array<[string, unknown[], keyof typeof h]> = [
    [Channels.TAGS_LIST, [], 'listTags'],
    [Channels.TAGS_NOTES_BY_TAG, ['x'], 'notesByTag'],
    [Channels.TAGS_NOTES_BY_TAG_PREFIX, ['x/'], 'notesByTagPrefix'],
    [Channels.TAGS_SOURCES_BY_TAG, ['x'], 'sourcesByTag'],
    [Channels.TAGS_ALL_NAMES, [], 'allTags'],
  ];

  it.each(cases)('%s answers with an empty list and no graph read when no project is open', (channel, args, fn) => {
    // Every handler here is `withRootPathOr([])`, and that is the right call:
    // "no project" and "a project with no tags" both render as an empty panel,
    // so the fallback isn't an error wearing a value's clothes (#1631 rule 2).
    openProject = null;
    expect(call(channel, ...args)).toEqual([]);
    expect(h[fn]).not.toHaveBeenCalled();
  });

  it('scopes each read to the open project', () => {
    h.listTags.mockReturnValue([{ tag: 'a', noteCount: 1, sourceCount: 0 }]);
    expect(call(Channels.TAGS_LIST)).toEqual([{ tag: 'a', noteCount: 1, sourceCount: 0 }]);
    expect(h.listTags).toHaveBeenCalledWith({ rootPath: ROOT });

    call(Channels.TAGS_NOTES_BY_TAG_PREFIX, 'area/');
    expect(h.notesByTagPrefix).toHaveBeenCalledWith({ rootPath: ROOT }, 'area/');
  });
});

describe('register-sites (#1840)', () => {
  it('needs no project — privileged logins are per-machine', () => {
    // Deliberately unscoped: these persist to userData, not to a thoughtbase.
    openProject = null;
    h.listSites.mockReturnValue([{ id: 's1', domain: 'example.com' }]);
    expect(call(Channels.SITES_LIST)).toEqual([{ id: 's1', domain: 'example.com' }]);
  });

  it('passes the domain and optional label through to the store', () => {
    call(Channels.SITES_ADD, 'example.com', 'Example');
    expect(h.addSite).toHaveBeenCalledWith('example.com', 'Example');
    call(Channels.SITES_ADD, 'bare.com');
    expect(h.addSite).toHaveBeenLastCalledWith('bare.com', undefined);
  });

  it('delegates remove and logout by id', () => {
    call(Channels.SITES_REMOVE, 's1');
    expect(h.removeSite).toHaveBeenCalledWith('s1');
    call(Channels.SITES_LOGOUT, 's1');
    expect(h.logoutSite).toHaveBeenCalledWith('s1');
  });

  it('awaits the login window and resolves with nothing', async () => {
    h.openLoginWindow.mockResolvedValue('ignored');
    await expect(call(Channels.SITES_LOGIN, 's1')).resolves.toBeUndefined();
    expect(h.openLoginWindow).toHaveBeenCalledWith('s1');
  });
});

describe('register-git (#1840)', () => {
  it('reports "not a repo" rather than throwing when no project is open', () => {
    // A legitimate project-less answer: with nothing open there is nothing
    // under version control, which is what the status bar renders anyway.
    openProject = null;
    // The fallback is a plain value while the success path is a promise — the
    // handler's own type says `GitStatus | Promise<GitStatus>`. Electron wraps
    // either at the IPC boundary; a direct call sees the difference.
    expect(call(Channels.GIT_STATUS)).toEqual({ isRepo: false, branch: null, files: [] });
    expect(h.getStatus).not.toHaveBeenCalled();
  });

  it('delegates status to the git module for the open project', async () => {
    h.getStatus.mockResolvedValue({ isRepo: true, branch: 'main', files: [] });
    await expect(call(Channels.GIT_STATUS)).resolves.toMatchObject({ branch: 'main' });
    expect(h.getStatus).toHaveBeenCalledWith(ROOT);
  });

  it('throws on commit with no project — a write, not a query', () => {
    openProject = null;
    expect(() => call(Channels.GIT_COMMIT, 'msg')).toThrow('No project open');
    expect(h.commitAll).not.toHaveBeenCalled();
  });

  it('returns the sha of the commit it made', async () => {
    h.commitAll.mockResolvedValue('abc1234');
    // NOTE: `success: true` is hardcoded — any real failure throws out of
    // `commitAll` before this returns. It's on CLAUDE.md's #1631 backlog as
    // vestigial, so this pins the sha and the delegation, not the flag's
    // meaning, which would be blessing it.
    await expect(call(Channels.GIT_COMMIT, 'msg')).resolves.toMatchObject({ sha: 'abc1234' });
    expect(h.commitAll).toHaveBeenCalledWith(ROOT, 'msg');
  });
});

describe('register-views (#1840)', () => {
  it('hands the store a null root when no project is open', () => {
    // Deliberate (see the module docstring): saved views exist in a global
    // scope too, so the store decides what a project-less list means. The
    // registrar's job is only to report the truth about the window.
    openProject = null;
    h.listSavedViews.mockReturnValue([]);
    expect(call(Channels.VIEWS_LIST)).toEqual([]);
    expect(h.listSavedViews).toHaveBeenCalledWith(null);
  });

  it('scopes list and save to the open project', () => {
    call(Channels.VIEWS_LIST);
    expect(h.listSavedViews).toHaveBeenCalledWith(ROOT);
    const input = { typeId: 't', name: 'v' };
    call(Channels.VIEWS_SAVE, 'project', input);
    expect(h.saveView).toHaveBeenCalledWith(ROOT, 'project', input);
  });

  it('addresses delete, rename and reorder by file path, not by project', () => {
    // These take an absolute path the caller already has, so they work the
    // same with or without a project open.
    openProject = null;
    call(Channels.VIEWS_DELETE, '/p/v.md');
    call(Channels.VIEWS_RENAME, '/p/v.md', 'new');
    call(Channels.VIEWS_SET_ORDER, [{ filePath: '/p/v.md', order: 1 }]);
    expect(h.deleteView).toHaveBeenCalledWith('/p/v.md');
    expect(h.renameView).toHaveBeenCalledWith('/p/v.md', 'new');
    expect(h.setViewOrder).toHaveBeenCalledWith([{ filePath: '/p/v.md', order: 1 }]);
  });
});

describe('register-clipper (#1840)', () => {
  beforeEach(() => {
    h.getClipperConfig.mockResolvedValue({ enabled: true, secret: 'sec' });
    h.getClipperInfo.mockReturnValue({ port: 4321 });
  });

  it('reports a pairing code only when the server is actually running', async () => {
    await expect(call(Channels.CLIPPER_GET_STATE)).resolves.toMatchObject({
      enabled: true, running: true, port: 4321,
    });
    const running = await call(Channels.CLIPPER_GET_STATE) as { pairingCode: string | null };
    expect(running.pairingCode).toBeTruthy();

    // Enabled in config but not listening: a code the browser can't reach
    // would be worse than none, so it's null.
    h.getClipperInfo.mockReturnValue(null);
    await expect(call(Channels.CLIPPER_GET_STATE)).resolves.toMatchObject({
      running: false, port: null, pairingCode: null,
    });
  });

  it('withholds the pairing code when there is no secret yet', async () => {
    h.getClipperConfig.mockResolvedValue({ enabled: true, secret: '' });
    await expect(call(Channels.CLIPPER_GET_STATE)).resolves.toMatchObject({ pairingCode: null });
  });

  it('applies the lifecycle change before reporting the new state', async () => {
    const order: string[] = [];
    h.setClipperEnabled.mockImplementation(async () => { order.push('persist'); });
    h.applyClipperConfigChange.mockImplementation(async () => { order.push('apply'); });
    h.getClipperConfig.mockImplementation(async () => { order.push('read'); return { enabled: true, secret: 's' }; });

    await call(Channels.CLIPPER_SET_ENABLED, true);

    // Reading state before starting/stopping the server would report the old
    // `running` value — the flip the user just asked for, missing.
    expect(order).toEqual(['persist', 'apply', 'read']);
  });

  it('rotates the secret, restarts, and answers with the fresh state', async () => {
    await call(Channels.CLIPPER_REGENERATE_SECRET);
    expect(h.regenerateClipperSecret).toHaveBeenCalled();
    expect(h.applyClipperConfigChange).toHaveBeenCalled();
    expect(h.getClipperConfig).toHaveBeenCalled();
  });
});

describe('register-app (#1840)', () => {
  it('reports build metadata, falling back when the build-time defines are absent', () => {
    // `__APP_COMMIT__` / `__BUILD_DATE__` are injected by vite's `define`; in a
    // test (and in `pnpm dev`) they don't exist, and the About dialog should
    // say "unknown" rather than crashing on a ReferenceError.
    const info = call(Channels.APP_GET_INFO) as Record<string, string>;
    expect(info).toMatchObject({ name: 'Minerva', version: '2.0.0-test', commit: 'unknown', buildDate: 'unknown' });
    expect(info.node).toBe(process.versions.node);
  });

  it('exposes the menu shortcut reference', () => {
    h.getMenuShortcuts.mockReturnValue([{ label: 'Save', accelerator: 'CmdOrCtrl+S' }]);
    expect(call(Channels.APP_GET_SHORTCUTS)).toEqual([{ label: 'Save', accelerator: 'CmdOrCtrl+S' }]);
  });

  it('records the theme the renderer reports, for the native View menu', () => {
    send(Channels.MENU_REPORT_THEME, {}, 'dark');
    expect(h.setMenuThemeMode).toHaveBeenCalledWith('dark');
  });

  it('scopes reported editor state to the reporting window', () => {
    h.fromWebContents.mockReturnValue({ id: 7 });
    send(Channels.MENU_REPORT_EDITOR_STATE, { sender: 'wc' }, { hasNote: true });
    expect(h.setMenuEditorState).toHaveBeenCalledWith(7, { hasNote: true });
  });

  it('ignores state from a window that has already gone', () => {
    // The report can arrive after the window closed; a null lookup must not
    // become `setMenuEditorState(undefined, …)` on some other window's menu.
    h.fromWebContents.mockReturnValue(null);
    send(Channels.MENU_REPORT_EDITOR_STATE, { sender: 'wc' }, { hasNote: true });
    expect(h.setMenuEditorState).not.toHaveBeenCalled();
  });
});
