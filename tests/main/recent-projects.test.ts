/**
 * @vitest-environment node
 *
 * `defaultThoughtbaseDir` (#1560) — where the thoughtbase folder pickers start.
 *
 * The rule is "the parent of the last thoughtbase you opened", derived from the
 * recents list rather than a new setting. What's worth pinning is the behaviour
 * around the edges: a deleted project must not cost the hint, and the fallback
 * must not be Downloads (the whole complaint in the issue).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// `recent-projects.ts` resolves its JSON path at MODULE load, so the mocked
// `getPath` has to answer before the import below — hence a fixed root rather
// than a per-test mkdtemp. Each test rebuilds it from scratch.
const h = vi.hoisted(() => {
  const root = `${process.env.TMPDIR ?? '/tmp'}/minerva-recent-projects-test`;
  const paths: Record<string, string> = {
    userData: `${root}/userData`,
    documents: `${root}/Documents`,
    home: `${root}/home`,
  };
  return { root, paths, getPath: vi.fn((name: string) => paths[name] ?? paths.userData!) };
});

vi.mock('electron', () => ({
  app: { getPath: (name: string) => h.getPath(name) },
}));

import {
  addRecentProject,
  clearRecentProjects,
  defaultThoughtbaseDir,
  getRecentProjects,
  invalidateRecentProjectsCache,
} from '../../src/main/recent-projects';

const tmp = h.root;

beforeEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const d of Object.values(h.paths)) fs.mkdirSync(d, { recursive: true });
  h.getPath.mockImplementation((name: string) => h.paths[name] ?? h.paths.userData!);
  clearRecentProjects();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.clearAllMocks();
});

/** Create a thoughtbase directory and record it as recently opened. */
function opened(relative: string): string {
  const abs = path.join(tmp, relative);
  fs.mkdirSync(abs, { recursive: true });
  addRecentProject(abs);
  return abs;
}

describe('getRecentProjects config-loader migration (#1913)', () => {
  it('reports and returns [] for a corrupt file, instead of silently defaulting', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(path.join(h.paths.userData!, 'recent-projects.json'), '{ not valid json', 'utf-8');
    // `getRecentProjects` memoizes (#2221) and `beforeEach`'s
    // `clearRecentProjects()` leaves `[]` in that memo, so the corrupt file
    // written behind the module's back has to be announced the same way a
    // real external edit is: by invalidating. In the app that happens on
    // window focus — see `menu-input-caches.ts`.
    invalidateRecentProjectsCache();

    expect(getRecentProjects()).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('[config] failed to');
    consoleErrorSpy.mockRestore();
  });
});

describe('defaultThoughtbaseDir', () => {
  it('offers the folder the last thoughtbase was opened from', () => {
    opened('Minerva/Research');
    expect(defaultThoughtbaseDir()).toBe(path.join(tmp, 'Minerva'));
  });

  it('follows the user when they start keeping thoughtbases somewhere else', () => {
    opened('Minerva/Research');
    opened('work/notes/Client');
    expect(defaultThoughtbaseDir()).toBe(path.join(tmp, 'work/notes'));
  });

  it('falls through to an older project when the newest one is gone', () => {
    opened('Minerva/Research');
    const moved = opened('Downloads/demo-thoughtbase');
    fs.rmSync(moved, { recursive: true, force: true });
    fs.rmSync(path.join(tmp, 'Downloads'), { recursive: true, force: true });
    // Not Downloads (which no longer exists), and not the Documents fallback —
    // the still-present Minerva folder is the right answer.
    expect(defaultThoughtbaseDir()).toBe(path.join(tmp, 'Minerva'));
  });

  it('falls back to Documents — never Downloads — with no usable history', () => {
    expect(defaultThoughtbaseDir()).toBe(h.paths.documents);
  });

  it('falls back to home when the platform has no Documents folder', () => {
    h.getPath.mockImplementation((name: string) => {
      if (name === 'documents') throw new Error('no XDG documents dir');
      return h.paths[name] ?? h.paths.userData!;
    });
    expect(defaultThoughtbaseDir()).toBe(h.paths.home);
  });

  it('ignores a recorded path with no parent to speak of', () => {
    addRecentProject(path.parse(tmp).root);
    expect(defaultThoughtbaseDir()).toBe(h.paths.documents);
  });

  it('ignores a recorded path whose parent is a file, not a folder', () => {
    const file = path.join(tmp, 'not-a-folder');
    fs.writeFileSync(file, 'x');
    addRecentProject(path.join(file, 'Thoughtbase'));
    expect(defaultThoughtbaseDir()).toBe(h.paths.documents);
  });
});

// #2416: `addRecentProject` reads STRICTLY and from disk. A corrupt file used to
// read as `[]`, and the write replaced it with one entry. It cannot refuse (it
// runs inside opening a thoughtbase), so it sets the bytes aside instead.
describe('addRecentProject with an unreadable file (#2416)', () => {
  const file = () => path.join(h.paths.userData!, 'recent-projects.json');

  it('sets the unreadable file aside byte-identical, then starts a new list', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const CORRUPT = '["/Users/me/Research", "/Users/me/Work" TRUNCATED';
    fs.writeFileSync(file(), CORRUPT, 'utf-8');

    addRecentProject('/Users/me/New');

    expect(fs.readFileSync(`${file()}.unreadable`, 'utf-8')).toBe(CORRUPT);
    expect(JSON.parse(fs.readFileSync(file(), 'utf-8'))).toEqual(['/Users/me/New']);
    expect(getRecentProjects()).toEqual(['/Users/me/New']);
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('a top-level object is unreadable too, not an empty list', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(file(), '{"a": 1}', 'utf-8');
    addRecentProject('/Users/me/New');
    expect(fs.readFileSync(`${file()}.unreadable`, 'utf-8')).toBe('{"a": 1}');
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('builds on the file on disk, not a stale memo, so an external edit survives', () => {
    addRecentProject('/Users/me/A');
    expect(getRecentProjects()).toEqual(['/Users/me/A']); // memo now holds [A]
    fs.writeFileSync(file(), JSON.stringify(['/Users/me/Edited', '/Users/me/A']), 'utf-8');
    addRecentProject('/Users/me/B');
    expect(getRecentProjects()).toEqual(['/Users/me/B', '/Users/me/Edited', '/Users/me/A']);
  });

  it('overlapping adds all land (synchronous read-to-write, nothing interleaves)', async () => {
    await Promise.all(['/p/1', '/p/2', '/p/3'].map((p) => Promise.resolve().then(() => addRecentProject(p))));
    expect(JSON.parse(fs.readFileSync(file(), 'utf-8'))).toEqual(['/p/3', '/p/2', '/p/1']);
  });
});
