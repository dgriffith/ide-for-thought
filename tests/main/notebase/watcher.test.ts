/**
 * Integration coverage for the chokidar-based notebase watcher (#345).
 *
 * Wires up real chokidar against a temp dir, plants/edits/deletes files,
 * and asserts the right callbacks fire with the right relative paths.
 * The watcher itself is a thin event-router; downstream indexing lives
 * in `window-manager.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BrowserWindow } from 'electron';
import { startWatching, stopWatching } from '../../../src/main/notebase/watcher';
import { Channels } from '../../../src/main/../shared/channels';

interface StubWin {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
}

function makeWin(): StubWin {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };
}

/**
 * Polls `predicate` every 25ms up to `timeoutMs`, resolving when it
 * returns true (chokidar events are async; callbacks may not fire on
 * the next microtask). Faster than a fixed sleep, less brittle than a
 * one-shot wait.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('startWatching() (#345)', () => {
  let root: string;
  let win: StubWin;
  let winId: number;
  let nextWinId = 9000;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-watcher-test-'));
    win = makeWin();
    winId = nextWinId++;
  });

  afterEach(async () => {
    stopWatching(winId);
    // Give chokidar a beat to release its handles before we yank the dir.
    await new Promise((r) => setTimeout(r, 50));
    await fsp.rm(root, { recursive: true, force: true });
  });

  describe('notes-tree events', () => {
    it('emits onFileCreated for a new .md file (with relative path)', async () => {
      const created: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: (p) => created.push(p),
        onFileChanged: () => undefined,
        onFileDeleted: () => undefined,
      });
      // chokidar's initial scan needs a moment before subsequent writes
      // reliably produce events. Without this, the first write races the
      // watcher's "ready" state and gets dropped on slow CI.
      await new Promise((r) => setTimeout(r, 200));

      await fsp.writeFile(path.join(root, 'hello.md'), '# Hello\n', 'utf-8');
      await waitFor(() => created.includes('hello.md'));
      expect(created).toEqual(['hello.md']);
      expect(win.webContents.send).toHaveBeenCalledWith(Channels.NOTEBASE_FILE_CREATED, 'hello.md');
    });

    it('emits onFileChanged when a watched .md file is rewritten', async () => {
      // Plant the file BEFORE startWatching so the create event doesn't fire
      // (ignoreInitial: true). We need a stable starting state to test change.
      const rel = 'notes/topic.md';
      await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
      await fsp.writeFile(path.join(root, rel), 'v1\n', 'utf-8');

      const changed: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: () => undefined,
        onFileChanged: (p) => changed.push(p),
        onFileDeleted: () => undefined,
      });

      // chokidar's initial scan needs to fully complete and register the
      // file's mtime before the next write looks like a `change`. Under
      // parallel test load on macOS fsevents this can take longer than
      // the 200ms used in other tests.
      await new Promise((r) => setTimeout(r, 500));
      await fsp.writeFile(path.join(root, rel), 'v2\n', 'utf-8');
      await waitFor(() => changed.includes(rel));
      expect(changed).toEqual([rel]);
      expect(win.webContents.send).toHaveBeenCalledWith(Channels.NOTEBASE_FILE_CHANGED, rel);
    });

    it('emits onFileDeleted when a watched .md file is removed', async () => {
      const rel = 'gone.md';
      await fsp.writeFile(path.join(root, rel), 'doomed\n', 'utf-8');

      const deleted: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: () => undefined,
        onFileChanged: () => undefined,
        onFileDeleted: (p) => deleted.push(p),
      });

      await new Promise((r) => setTimeout(r, 200));
      await fsp.rm(path.join(root, rel));
      await waitFor(() => deleted.includes(rel));
      expect(deleted).toEqual([rel]);
      expect(win.webContents.send).toHaveBeenCalledWith(Channels.NOTEBASE_FILE_DELETED, rel);
    });

    it('handles all three indexable extensions (.md, .ttl, .csv)', async () => {
      const created: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: (p) => created.push(p),
        onFileChanged: () => undefined,
        onFileDeleted: () => undefined,
      });
      await new Promise((r) => setTimeout(r, 200));

      await fsp.writeFile(path.join(root, 'a.md'), 'a\n', 'utf-8');
      await fsp.writeFile(path.join(root, 'b.ttl'), '@prefix x: <x> .\n', 'utf-8');
      await fsp.writeFile(path.join(root, 'c.csv'), 'col\n1\n', 'utf-8');

      await waitFor(() => created.length >= 3);
      expect(created.sort()).toEqual(['a.md', 'b.ttl', 'c.csv']);
    });

    it('ignores non-indexable extensions like .png and .json', async () => {
      const created: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: (p) => created.push(p),
        onFileChanged: () => undefined,
        onFileDeleted: () => undefined,
      });
      await new Promise((r) => setTimeout(r, 200));

      await fsp.writeFile(path.join(root, 'image.png'), 'fake', 'utf-8');
      await fsp.writeFile(path.join(root, 'config.json'), '{}', 'utf-8');
      // Plant something we DO care about so we know the watcher is alive.
      await fsp.writeFile(path.join(root, 'real.md'), '# r\n', 'utf-8');

      await waitFor(() => created.includes('real.md'));
      // .png / .json must not have invoked the callback, even though they
      // landed in the watched tree.
      expect(created).toEqual(['real.md']);
    });

    it('files in dot-prefixed dirs are ignored (e.g. .git, .obsidian)', async () => {
      const created: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: (p) => created.push(p),
        onFileChanged: () => undefined,
        onFileDeleted: () => undefined,
      });
      await new Promise((r) => setTimeout(r, 200));

      await fsp.mkdir(path.join(root, '.git'), { recursive: true });
      await fsp.mkdir(path.join(root, '.obsidian'), { recursive: true });
      await fsp.writeFile(path.join(root, '.git', 'HEAD.md'), 'x\n', 'utf-8');
      await fsp.writeFile(path.join(root, '.obsidian', 'config.md'), 'x\n', 'utf-8');
      // sentinel
      await fsp.writeFile(path.join(root, 'sentinel.md'), '# s\n', 'utf-8');

      await waitFor(() => created.includes('sentinel.md'));
      expect(created).toEqual(['sentinel.md']);
    });

    it('does not call back after the window has been destroyed', async () => {
      const created: string[] = [];
      const destroyableWin: StubWin = {
        isDestroyed: () => true,
        webContents: { send: vi.fn() },
      };
      startWatching(root, destroyableWin as unknown as BrowserWindow, winId, {
        onFileCreated: (p) => created.push(p),
        onFileChanged: () => undefined,
        onFileDeleted: () => undefined,
      });
      await new Promise((r) => setTimeout(r, 200));

      await fsp.writeFile(path.join(root, 'x.md'), 'x\n', 'utf-8');
      // Wait long enough that, if the callback were going to fire, it would have.
      await new Promise((r) => setTimeout(r, 400));
      expect(created).toEqual([]);
      expect(destroyableWin.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('.minerva/{sources,excerpts} routing', () => {
    it('routes .minerva/sources/<id>/meta.ttl writes to onSourceMetaChanged', async () => {
      const sourceId = 'sha-abc123';
      const onSourceMetaChanged = vi.fn();
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileChanged: () => undefined,
        onFileCreated: () => undefined,
        onFileDeleted: () => undefined,
        onSourceMetaChanged,
      });
      await new Promise((r) => setTimeout(r, 200));

      const dir = path.join(root, '.minerva', 'sources', sourceId);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'meta.ttl'), '@prefix x: <x> .\n', 'utf-8');

      await waitFor(() => onSourceMetaChanged.mock.calls.length > 0);
      expect(onSourceMetaChanged).toHaveBeenCalledWith(sourceId);
    });

    it('routes .minerva/sources/<id>/body.md writes to onSourceMetaChanged too', async () => {
      // body.md edits also count as source metadata changes — they land in the
      // same `upsert` branch so the indexer can re-read both files.
      const sourceId = 'sha-bodyonly';
      const onSourceMetaChanged = vi.fn();
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileChanged: () => undefined,
        onFileCreated: () => undefined,
        onFileDeleted: () => undefined,
        onSourceMetaChanged,
      });
      await new Promise((r) => setTimeout(r, 200));

      const dir = path.join(root, '.minerva', 'sources', sourceId);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'body.md'), '# body\n', 'utf-8');

      await waitFor(() => onSourceMetaChanged.mock.calls.length > 0);
      expect(onSourceMetaChanged).toHaveBeenCalledWith(sourceId);
    });

    it('routes meta.ttl deletion to onSourceMetaDeleted', async () => {
      const sourceId = 'sha-doomed';
      const dir = path.join(root, '.minerva', 'sources', sourceId);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'meta.ttl'), '@prefix x: <x> .\n', 'utf-8');

      const onSourceMetaDeleted = vi.fn();
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileChanged: () => undefined,
        onFileCreated: () => undefined,
        onFileDeleted: () => undefined,
        onSourceMetaDeleted,
      });
      await new Promise((r) => setTimeout(r, 200));
      await fsp.rm(path.join(dir, 'meta.ttl'));

      await waitFor(() => onSourceMetaDeleted.mock.calls.length > 0);
      expect(onSourceMetaDeleted).toHaveBeenCalledWith(sourceId);
    });

    it('routes .minerva/excerpts/<id>.ttl writes to onExcerptChanged', async () => {
      const excerptId = 'ex-7';
      const onExcerptChanged = vi.fn();
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileChanged: () => undefined,
        onFileCreated: () => undefined,
        onFileDeleted: () => undefined,
        onExcerptChanged,
      });
      await new Promise((r) => setTimeout(r, 200));

      const dir = path.join(root, '.minerva', 'excerpts');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, `${excerptId}.ttl`), '@prefix x: <x> .\n', 'utf-8');

      await waitFor(() => onExcerptChanged.mock.calls.length > 0);
      expect(onExcerptChanged).toHaveBeenCalledWith(excerptId);
    });

    it('routes excerpt deletion to onExcerptDeleted', async () => {
      const excerptId = 'ex-doomed';
      const dir = path.join(root, '.minerva', 'excerpts');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, `${excerptId}.ttl`), '@prefix x: <x> .\n', 'utf-8');

      const onExcerptDeleted = vi.fn();
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileChanged: () => undefined,
        onFileCreated: () => undefined,
        onFileDeleted: () => undefined,
        onExcerptDeleted,
      });
      await new Promise((r) => setTimeout(r, 200));
      await fsp.rm(path.join(dir, `${excerptId}.ttl`));

      await waitFor(() => onExcerptDeleted.mock.calls.length > 0);
      expect(onExcerptDeleted).toHaveBeenCalledWith(excerptId);
    });

    it('does NOT route unrelated .minerva/* files to source/excerpt callbacks', async () => {
      // graph.ttl, bookmarks.json, tabs.json, etc. all live under .minerva but
      // outside sources/excerpts — they must stay invisible to the watcher.
      const onSourceMetaChanged = vi.fn();
      const onExcerptChanged = vi.fn();
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileChanged: () => undefined,
        onFileCreated: () => undefined,
        onFileDeleted: () => undefined,
        onSourceMetaChanged,
        onExcerptChanged,
      });
      await new Promise((r) => setTimeout(r, 200));

      await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
      await fsp.writeFile(path.join(root, '.minerva', 'graph.ttl'), '@prefix x: <x> .\n', 'utf-8');
      await fsp.writeFile(path.join(root, '.minerva', 'bookmarks.json'), '[]', 'utf-8');

      // Plant a sentinel inside sources so we know the watcher is alive.
      const sentinelDir = path.join(root, '.minerva', 'sources', 'sentinel');
      await fsp.mkdir(sentinelDir, { recursive: true });
      await fsp.writeFile(path.join(sentinelDir, 'meta.ttl'), '@prefix x: <x> .\n', 'utf-8');

      await waitFor(() => onSourceMetaChanged.mock.calls.length > 0);
      const calls = onSourceMetaChanged.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(['sentinel']);
      expect(onExcerptChanged).not.toHaveBeenCalled();
    });
  });

  describe('stopWatching()', () => {
    it('detaches every watcher so subsequent file ops produce no callbacks', async () => {
      const created: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: (p) => created.push(p),
        onFileChanged: () => undefined,
        onFileDeleted: () => undefined,
      });
      await new Promise((r) => setTimeout(r, 150));

      stopWatching(winId);
      // Even after a generous wait, no event should land for files added
      // after the watcher closed.
      await fsp.writeFile(path.join(root, 'after-stop.md'), 'x\n', 'utf-8');
      await new Promise((r) => setTimeout(r, 400));
      expect(created).toEqual([]);
    });

    it('stopWatching on an unknown id is a no-op (no throw)', () => {
      expect(() => stopWatching(98765)).not.toThrow();
    });

    it('startWatching twice on the same id replaces the previous watcher', async () => {
      const firstCreated: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: (p) => firstCreated.push(p),
        onFileChanged: () => undefined,
        onFileDeleted: () => undefined,
      });
      await new Promise((r) => setTimeout(r, 150));

      const secondCreated: string[] = [];
      startWatching(root, win as unknown as BrowserWindow, winId, {
        onFileCreated: (p) => secondCreated.push(p),
        onFileChanged: () => undefined,
        onFileDeleted: () => undefined,
      });
      await new Promise((r) => setTimeout(r, 150));

      await fsp.writeFile(path.join(root, 'after.md'), 'x\n', 'utf-8');
      await waitFor(() => secondCreated.includes('after.md'));
      expect(secondCreated).toEqual(['after.md']);
      expect(firstCreated).toEqual([]);
    });
  });
});
