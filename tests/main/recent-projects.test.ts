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
