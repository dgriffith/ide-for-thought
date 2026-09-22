/**
 * `rebuildMenu()` must not touch the disk on a selection flip (#2221, epic #2229).
 *
 * The menu is rebuilt on window `focus` and, via `setMenuEditorState`, every
 * time the focused note's `hasSelection` flag changes — i.e. every time the
 * user selects or deselects text. Before this fix each of those rebuilds did a
 * fresh `listSavedQueries()` (two `readdirSync`s plus a `readFileSync` per
 * `.rq`/`.sql`), a fresh `getRecentProjects()` read, and a fresh
 * `.minerva/config.json` read per window for the macOS Window menu's labels.
 * Measured on the fixture below — six project + six global queries — that was
 * 14 `readFileSync` + 2 `readdirSync` per rebuild, all synchronous, all on the
 * main process's only thread.
 *
 * The gates here are COUNT-based, not timing-based, deliberately: "this path
 * reads each query file once" holds on a loaded CI box, whereas a millisecond
 * threshold flaps. The two assertions that can't be counted — the recents list
 * and the display name both reach disk through `config-store`'s
 * `import { readFileSync } from 'node:fs'`, which `vi.spyOn(fs, …)` provably
 * cannot intercept (a named import binds a copy, not the namespace property) —
 * are pinned the other way round, by editing the file on disk behind the
 * module's back and asserting the menu does *not* change until invalidation.
 * That is arguably the stronger form: it asserts the absence of a read by its
 * observable consequence rather than by counting syscalls.
 *
 * The staleness half matters at least as much as the speed half: a cached menu
 * that never refreshes is a worse bug than the one being fixed. Every case
 * below therefore has a paired "…and it does refresh when it should".
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const h = vi.hoisted(() => {
  const root = `${process.env.TMPDIR ?? '/tmp'}/minerva-menu-rebuild-io-test`;
  return {
    root,
    userData: `${root}/userData`,
    project: `${root}/project`,
    rootPath: { value: `${root}/project` as string | null },
  };
});

const GLOBAL_QUERIES = path.join(h.userData, 'queries');
const PROJECT_QUERIES = path.join(h.project, '.minerva', 'queries');
const QUERY_COUNT = 6; // per scope

// ── Electron + window-manager mocks ───────────────────────────────────────
//
// Same minimal surface as `menu-shortcuts.test.ts`, with two differences that
// are the point of this file: `saved-queries` and `recent-projects` are NOT
// mocked (they are what we are measuring), and the focused window reports a
// real project root so the project-scope query directory is read too.

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: () => undefined },
  BrowserWindow: {
    getFocusedWindow: () => ({ id: 1, isDestroyed: () => false }),
    getAllWindows: () => [{ id: 1, isDestroyed: () => false }],
    fromId: () => null,
  },
  shell: { openExternal: () => Promise.resolve() },
  dialog: {},
  app: { getPath: (k: string) => (k === 'userData' ? h.userData : os.tmpdir()) },
}));

vi.mock('../../src/main/window-manager', () => ({
  createWindow: () => ({ webContents: { once: () => undefined, send: () => undefined } }),
  openProjectInWindow: async () => undefined,
  getRootPath: () => h.rootPath.value,
  broadcastBackfillProgress: () => undefined,
  broadcastMaintenanceProgress: () => undefined,
}));

vi.mock('../../src/main/graph/index', () => ({ exportGraph: async () => undefined }));
vi.mock('../../src/main/project-context-types', () => ({ projectContext: () => ({}) }));
vi.mock('../../src/main/search/index', () => ({}));
vi.mock('../../src/main/sources/tables', () => ({}));
vi.mock('../../src/main/compute/python-kernel', () => ({ restartKernel: () => undefined }));
vi.mock('../../src/main/publish', () => ({ listExporters: () => [], listExportGroups: () => [] }));

import { rebuildMenu, setMenuEditorState } from '../../src/main/menu';
import { invalidateMenuInputCaches } from '../../src/main/menu-input-caches';
import { saveQuery } from '../../src/main/saved-queries';
import { resolveDisplayName } from '../../src/main/project-config';

// ── Fixture + template helpers ────────────────────────────────────────────

function writeQuery(dir: string, id: string, name: string): void {
  fs.writeFileSync(path.join(dir, `${id}.rq`), `# @name ${name}\nSELECT * WHERE {}\n`, 'utf-8');
}

function seed(): void {
  fs.rmSync(h.root, { recursive: true, force: true });
  fs.mkdirSync(GLOBAL_QUERIES, { recursive: true });
  fs.mkdirSync(PROJECT_QUERIES, { recursive: true });
  for (let i = 0; i < QUERY_COUNT; i++) {
    writeQuery(GLOBAL_QUERIES, `g${i}`, `Global ${i}`);
    writeQuery(PROJECT_QUERIES, `p${i}`, `Project ${i}`);
  }
  fs.writeFileSync(path.join(h.userData, 'recent-projects.json'), JSON.stringify([h.project]), 'utf-8');
  fs.writeFileSync(
    path.join(h.project, '.minerva', 'config.json'),
    JSON.stringify({ displayName: 'Original Name' }),
    'utf-8',
  );
}

type Item = Electron.MenuItemConstructorOptions;

/** Every label in the template, flattened — enough to assert "this query is
 *  offered by the menu" without asserting the whole menu's shape. */
function allLabels(template: Item[]): string[] {
  const out: string[] = [];
  const walk = (items: readonly Item[]): void => {
    for (const item of items) {
      if (typeof item.label === 'string') out.push(item.label);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return out;
}

/** The sublabels under File ▸ Recent Thoughtbases (each recent's full path). */
function recentPaths(template: Item[]): string[] {
  const file = template.find((m) => m.label === 'File');
  const recent = (file?.submenu as Item[] | undefined)?.find((i) => i.label === 'Recent Thoughtbases');
  return ((recent?.submenu as Item[] | undefined) ?? [])
    .map((i) => i.sublabel)
    .filter((s): s is string => typeof s === 'string');
}

/**
 * Count `readdirSync` / `readFileSync` hits against the two query directories
 * while `fn` runs. Scoped to those paths so unrelated reads elsewhere in the
 * template build (there are none today, but that shouldn't be this test's
 * business) can't turn into a false failure.
 */
function countQueryFileIO(fn: () => void): { dirs: number; files: number } {
  const origRead = fs.readFileSync;
  const origDir = fs.readdirSync;
  let dirs = 0;
  let files = 0;
  const underQueryDirs = (p: unknown): boolean =>
    String(p).startsWith(GLOBAL_QUERIES) || String(p).startsWith(PROJECT_QUERIES);
  const spyRead = vi.spyOn(fs, 'readFileSync').mockImplementation(((p: never, o: never) => {
    if (underQueryDirs(p)) files++;
    return origRead(p, o);
  }) as never);
  const spyDir = vi.spyOn(fs, 'readdirSync').mockImplementation(((p: never, o: never) => {
    if (underQueryDirs(p)) dirs++;
    return origDir(p, o);
  }) as never);
  try {
    fn();
  } finally {
    spyRead.mockRestore();
    spyDir.mockRestore();
  }
  return { dirs, files };
}

/** Simulate the renderer reporting a selection change, which is what
 *  `App.svelte` pushes and what `setMenuEditorState` turns into a rebuild.
 *  Flips `hasSelection` on each call so the dedupe in `setMenuEditorState`
 *  never short-circuits — that dedupe is real and useful, but it is not the
 *  thing under test here. */
let selection = false;
function flipSelection(): void {
  selection = !selection;
  setMenuEditorState(1, { hasEditor: true, hasNote: true, hasSelection: selection });
}

beforeEach(() => {
  seed();
  h.rootPath.value = h.project;
  selection = false;
  setMenuEditorState(1, { hasEditor: false, hasNote: false, hasSelection: false });
  invalidateMenuInputCaches();
});

afterAll(() => {
  fs.rmSync(h.root, { recursive: true, force: true });
});

describe('saved queries are read once per focus, not once per rebuild (#2221)', () => {
  it('the first rebuild reads both directories and every query file exactly once', () => {
    const io = countQueryFileIO(() => { rebuildMenu(); });
    expect(io.dirs).toBe(2);              // global + project queries directory
    expect(io.files).toBe(QUERY_COUNT * 2);
  });

  it('twenty selection flips after that read nothing at all', () => {
    rebuildMenu();
    const io = countQueryFileIO(() => {
      for (let i = 0; i < 20; i++) flipSelection();
    });
    expect(io).toEqual({ dirs: 0, files: 0 });
  });

  it('the menu still offers every saved query while serving from cache', () => {
    rebuildMenu();
    const labels = allLabels(rebuildMenu());
    for (let i = 0; i < QUERY_COUNT; i++) {
      expect(labels).toContain(`Project ${i}`);
      expect(labels).toContain(`Global ${i}`);
    }
  });

  it('an externally added query is invisible until focus, and present immediately after', () => {
    rebuildMenu();
    writeQuery(PROJECT_QUERIES, 'added-behind-our-back', 'Added Externally');

    // No focus yet: the cache is authoritative, exactly as it is between two
    // selection flips. (Pre-fix this line would already have seen the file —
    // that difference is the whole trade, and it is bounded by one focus.)
    expect(allLabels(rebuildMenu())).not.toContain('Added Externally');

    invalidateMenuInputCaches(); // what window-manager's `focus` handler does
    expect(allLabels(rebuildMenu())).toContain('Added Externally');
  });

  it('a query saved through the app appears without waiting for focus', () => {
    rebuildMenu();
    saveQuery(h.project, 'project', 'Saved In App', '', 'SELECT * WHERE {}', 'sparql');
    // No `invalidateMenuInputCaches()` here on purpose: an in-app write must
    // not depend on the user leaving and returning to the window.
    expect(allLabels(rebuildMenu())).toContain('Saved In App');
  });

  it('switching the focused window to another project re-reads that project', () => {
    rebuildMenu();
    const other = path.join(h.root, 'other-project');
    fs.mkdirSync(path.join(other, '.minerva', 'queries'), { recursive: true });
    writeQuery(path.join(other, '.minerva', 'queries'), 'o1', 'Other Project Query');
    h.rootPath.value = other;

    // The cache key is the root path, so this must miss even though nothing
    // invalidated — otherwise a two-window setup would show one window's
    // project queries in the other's menu.
    const labels = allLabels(rebuildMenu());
    expect(labels).toContain('Other Project Query');
    expect(labels).not.toContain('Project 0');
  });
});

describe('recent thoughtbases are read once per focus (#2221)', () => {
  it('a recents file rewritten behind the app is picked up on focus, not before', () => {
    expect(recentPaths(rebuildMenu())).toEqual([h.project]);

    const other = path.join(h.root, 'some-other-thoughtbase');
    fs.writeFileSync(path.join(h.userData, 'recent-projects.json'), JSON.stringify([other]), 'utf-8');

    // Ten selection-driven rebuilds, none of which re-reads the file.
    for (let i = 0; i < 10; i++) flipSelection();
    expect(recentPaths(rebuildMenu())).toEqual([h.project]);

    invalidateMenuInputCaches();
    expect(recentPaths(rebuildMenu())).toEqual([other]);
  });
});

describe('thoughtbase display names are read once per focus (#2221)', () => {
  it('a config.json rewritten behind the app is picked up on focus, not before', () => {
    // Asserted against `resolveDisplayName` rather than the menu template
    // because the Window menu it feeds is macOS-only, and this behaviour is
    // not.
    expect(resolveDisplayName(h.project)).toBe('Original Name');

    fs.writeFileSync(
      path.join(h.project, '.minerva', 'config.json'),
      JSON.stringify({ displayName: 'Renamed Outside' }),
      'utf-8',
    );
    expect(resolveDisplayName(h.project)).toBe('Original Name');

    invalidateMenuInputCaches();
    expect(resolveDisplayName(h.project)).toBe('Renamed Outside');
  });

  it('caches the ABSENCE of a display name too', () => {
    const bare = path.join(h.root, 'bare-project');
    fs.mkdirSync(path.join(bare, '.minerva'), { recursive: true });
    expect(resolveDisplayName(bare)).toBe('bare-project'); // folder basename

    // A project with no `displayName` key is the common case; if the cache
    // stored "no entry" for it, every rebuild would re-read its config.json
    // and the fix would do nothing for the majority of users.
    fs.writeFileSync(
      path.join(bare, '.minerva', 'config.json'),
      JSON.stringify({ displayName: 'Now Named' }),
      'utf-8',
    );
    expect(resolveDisplayName(bare)).toBe('bare-project');

    invalidateMenuInputCaches();
    expect(resolveDisplayName(bare)).toBe('Now Named');
  });

  it('never answers one thoughtbase with another one\'s name', () => {
    // The memo is a single slot (see `project-config.ts` for why it isn't a
    // rootPath-keyed Map). A single slot that forgot to compare its key would
    // label every window in the macOS Window menu with whichever thoughtbase
    // was resolved first — the failure mode this trades against.
    const other = path.join(h.root, 'second-thoughtbase');
    fs.mkdirSync(path.join(other, '.minerva'), { recursive: true });
    fs.writeFileSync(
      path.join(other, '.minerva', 'config.json'),
      JSON.stringify({ displayName: 'Second' }),
      'utf-8',
    );
    for (let i = 0; i < 3; i++) {
      expect(resolveDisplayName(h.project)).toBe('Original Name');
      expect(resolveDisplayName(other)).toBe('Second');
    }
  });
});
