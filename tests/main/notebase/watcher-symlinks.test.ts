/**
 * The notes watcher does not follow symlinks out of the thoughtbase (#2398).
 *
 * With chokidar's default `followSymlinks: true`, a symlinked directory that
 * points outside the root is descended and watched: files outside the root
 * surfaced as `add out/secret.md` / `change …` notebase events (their NAMES
 * reached the renderer, even though the content read was already refused by
 * `assertSafePath`), and a link to `~` would subscribe the home directory.
 *
 * Real chokidar against real temp dirs, like `watcher.test.ts`. Negative
 * assertions ("no event for the outside file") are sequenced behind a
 * positive control event written AFTER the outside change, so the test does
 * not rely on a bare sleep to conclude that nothing happened.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startWatching, stopWatching, type WatcherTarget } from '../../../src/main/notebase/watcher';

function recorder(events: string[]): WatcherTarget {
  return {
    isAlive: () => true,
    fileCreated: (p) => events.push(`created ${p}`),
    fileChanged: (p) => events.push(`changed ${p}`),
    fileDeleted: (p) => events.push(`deleted ${p}`),
    renamed: (pairs) => pairs.forEach((x) => events.push(`renamed ${x.old} ${x.new}`)),
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

const noop = { onFileCreated: () => undefined, onFileChanged: () => undefined, onFileDeleted: () => undefined };

describe('startWatching and symlinks (#2398)', () => {
  let base: string;
  let root: string;
  let outside: string;
  let events: string[];
  let id = 9800;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-watch-symlink-'));
    root = path.join(base, 'tb');
    outside = path.join(base, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.md'), 'v1\n');
    events = [];
    id++;
  });

  afterEach(async () => {
    stopWatching(id);
    await new Promise((r) => setTimeout(r, 50));
    await fsp.rm(base, { recursive: true, force: true });
  });

  it('does not descend into a symlinked directory that points outside the thoughtbase', async () => {
    fs.symlinkSync(outside, path.join(root, 'out'));
    await startWatching(root, recorder(events), id, noop);

    await fsp.writeFile(path.join(outside, 'secret.md'), 'v2\n');
    await fsp.writeFile(path.join(outside, 'new.md'), 'fresh\n');
    await new Promise((r) => setTimeout(r, 300));
    await fsp.writeFile(path.join(root, 'control.md'), '# control\n');
    await waitFor(() => events.includes('created control.md'));
    // One more beat for any straggling fsevents from the outside writes.
    await new Promise((r) => setTimeout(r, 300));

    expect(events.filter((e) => e.includes('out/'))).toEqual([]);
  });

  it('still reports a symlinked note that stays inside the thoughtbase', async () => {
    fs.writeFileSync(path.join(root, 'real.md'), '# real\n');
    await startWatching(root, recorder(events), id, noop);

    fs.symlinkSync('real.md', path.join(root, 'alias.md'));

    await waitFor(() => events.includes('created alias.md'));
  });

  it('watches a thoughtbase opened through a symlinked root directory', async () => {
    // `followSymlinks: false` makes chokidar lstat the watch root; handed the
    // link it would see one symlink and never descend. The watcher watches
    // the canonical root instead, and still reports root-relative paths.
    const linkedRoot = path.join(base, 'linked-tb');
    fs.symlinkSync(root, linkedRoot);
    await startWatching(linkedRoot, recorder(events), id, noop);

    await fsp.mkdir(path.join(root, 'sub'));
    await fsp.writeFile(path.join(linkedRoot, 'sub', 'note.md'), '# note\n');

    await waitFor(() => events.includes(`created ${path.join('sub', 'note.md')}`));
  });
});
