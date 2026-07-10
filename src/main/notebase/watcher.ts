import { watch, type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';

import { INDEXABLE_EXTS } from './indexable-files';
import { wasHandled } from './path-dedup';

/**
 * How long an `unlink` is held before it's surfaced as a deletion, giving a
 * paired `add` (the other half of an external move) time to arrive so the two
 * can be correlated into a rename. Finder/CLI moves emit the two events within
 * a few milliseconds; 150ms is a comfortable margin without making genuine
 * deletes feel laggy (the tree refresh is debounced separately anyway).
 */
const MOVE_PAIR_WINDOW_MS = 150;

/**
 * Paths we want to surface as watcher events even though they aren't
 * indexable in the usual sense. Today this is just the CSV schema
 * sidecar (#237): `<stem>.csv.schema.yaml` next to a `.csv` doesn't
 * land in the graph, but editing it must re-register the sibling CSV
 * so DuckDB picks up the new column types. The downstream callback
 * in window-manager.ts handles the actual re-registration; the
 * watcher's job is just to surface the event.
 */
function isWatchable(filePath: string): boolean {
  if (INDEXABLE_EXTS.has(path.extname(filePath))) return true;
  if (filePath.endsWith('.csv.schema.yaml')) return true;
  return false;
}

// Callbacks may return a Promise; the watcher invokes them as
// fire-and-forget. Typing the return as `void | Promise<void>` lets
// callers be explicitly async without tripping no-misused-promises.
export interface WatcherCallbacks {
  onFileChanged: (relativePath: string) => void | Promise<void>;
  onFileCreated: (relativePath: string) => void | Promise<void>;
  onFileDeleted: (relativePath: string) => void | Promise<void>;
  onSourceMetaChanged?: (sourceId: string) => void | Promise<void>;
  onSourceMetaDeleted?: (sourceId: string) => void | Promise<void>;
  onExcerptChanged?: (excerptId: string) => void | Promise<void>;
  onExcerptDeleted?: (excerptId: string) => void | Promise<void>;
}

interface WatcherPair {
  notes: FSWatcher;
  minervaData: FSWatcher;
  /** Clears any pending move-detection timers so teardown leaves nothing armed. */
  disposeMoveDetection: () => void;
}

const watchers = new Map<number, WatcherPair>();

const SOURCE_DIR_RE = /(?:^|[/\\])\.minerva[/\\]sources[/\\]([^/\\]+)[/\\](meta\.ttl|body\.md)$/;
const EXCERPT_RE = /(?:^|[/\\])\.minerva[/\\]excerpts[/\\]([^/\\]+)\.ttl$/;

/** Returns the source id if the path is .minerva/sources/<id>/{meta.ttl,body.md}. */
function extractSourceId(absPath: string): string | null {
  const m = absPath.match(SOURCE_DIR_RE);
  return m ? m[1]! : null;
}

function extractExcerptId(absPath: string): string | null {
  const m = absPath.match(EXCERPT_RE);
  return m ? m[1]! : null;
}

export function startWatching(
  rootPath: string,
  win: BrowserWindow,
  id: number,
  callbacks?: WatcherCallbacks,
): Promise<void> {
  stopWatching(id);

  const notes = watch(rootPath, {
    ignored: [
      /(^|[/\\])\./,
      '**/node_modules/**',
      '**/.minerva/**',
    ],
    persistent: true,
    ignoreInitial: true,
    // Guarantee fs.Stats on add/change so we can read inodes for robust
    // move correlation (see the move-detection block below).
    alwaysStat: true,
  });

  // --- External move (rename) detection -------------------------------
  // chokidar reports a Finder/CLI move as two *uncorrelated* events: an
  // `add` on the new path and an `unlink` on the old one. Emitting the
  // `unlink` as NOTEBASE_FILE_DELETED closes the open tab (and drops any
  // unsaved edits in it) — issue #1144. To make an external move behave
  // like an in-app one, we correlate the pair and surface it as a rename via
  // NOTEBASE_RENAMED, so the open tab *follows* the file exactly as
  // `api.notebase.rename` already does.
  //
  // The two events can arrive in either order (macOS fsevents fires `add`
  // first; other backends may differ), so we bridge both directions: each
  // `add` is remembered briefly so a following `unlink` can claim it, and
  // each unclaimed `unlink` is held briefly so a following `add` can claim
  // it. Whichever half arrives second detects the pair.
  //
  // Matching signal: the inode is authoritative — a move preserves it — and
  // is used whenever it's known on both sides (we cache inodes seen on
  // add/change). A file that existed at startup was never `add`ed this
  // session, so its inode is uncached; there we fall back to a basename
  // match, which the reported case (same file, new directory) satisfies. A
  // known-but-different inode vetoes a basename match, so a genuine
  // delete-then-recreate of a same-named file isn't mistaken for a move.
  // In-app ops are skipped via `wasHandled` — they already drive the tab
  // through the rename path themselves.
  interface FileEvent {
    relative: string;
    basename: string;
    inode: number | undefined;
    timer: ReturnType<typeof setTimeout>;
  }
  const pendingUnlinks = new Map<string, FileEvent>(); // abs old path, delete held
  const recentAdds = new Map<string, FileEvent>();      // abs new path, create emitted
  const inodeByPath = new Map<string, number>();        // abs path -> last-seen inode

  const inodeOf = (stats?: fs.Stats): number | undefined =>
    stats && typeof stats.ino === 'number' && stats.ino !== 0 ? stats.ino : undefined;

  // Best pairing for a (basename, inode) among buffered counterpart events.
  const findMatch = (
    pool: Map<string, FileEvent>,
    basename: string,
    inode: number | undefined,
  ): string | undefined => {
    if (inode !== undefined) {
      for (const [abs, e] of pool) if (e.inode === inode) return abs;
    }
    for (const [abs, e] of pool) {
      if (e.basename !== basename) continue;
      // Both inodes known but different → a distinct file sharing a name.
      if (inode !== undefined && e.inode !== undefined && e.inode !== inode) continue;
      return abs;
    }
    return undefined;
  };

  const armTimer = (fn: () => void): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(fn, MOVE_PAIR_WINDOW_MS);
    // Don't let a pending timer keep the process alive during teardown.
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  };

  // The tree now lists every file (#1130), so the watcher surfaces IPC (tree
  // refresh) and runs move-detection (open tabs following external moves) for
  // ALL files. Graph/search indexing stays gated on `isWatchable` — listing a
  // `.txt` must not drag it into the knowledge graph. These helpers apply that
  // gate to just the index callbacks; the IPC sends around them are unconditional.
  const indexChanged = (relative: string) => { if (isWatchable(relative)) void callbacks?.onFileChanged(relative); };
  const indexCreated = (relative: string) => { if (isWatchable(relative)) void callbacks?.onFileCreated(relative); };
  const indexDeleted = (relative: string) => { if (isWatchable(relative)) void callbacks?.onFileDeleted(relative); };

  const flushDelete = (absPath: string) => {
    const pending = pendingUnlinks.get(absPath);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingUnlinks.delete(absPath);
    if (win.isDestroyed()) return;
    win.webContents.send(Channels.NOTEBASE_FILE_DELETED, pending.relative);
    indexDeleted(pending.relative);
  };

  const emitCreate = (relative: string) => {
    win.webContents.send(Channels.NOTEBASE_FILE_CREATED, relative);
    indexCreated(relative);
  };

  notes.on('change', (filePath, stats) => {
    if (win.isDestroyed()) return;
    const ino = inodeOf(stats);
    if (ino !== undefined) inodeByPath.set(filePath, ino);
    const relative = filePath.slice(rootPath.length + 1);
    win.webContents.send(Channels.NOTEBASE_FILE_CHANGED, relative);
    indexChanged(relative);
  });

  notes.on('add', (filePath, stats) => {
    if (win.isDestroyed()) return;
    const ino = inodeOf(stats);
    if (ino !== undefined) inodeByPath.set(filePath, ino);
    const relative = filePath.slice(rootPath.length + 1);
    const basename = path.basename(filePath);

    // Unlink-first ordering: a held delete this add pairs with → rename.
    // In-app creates (wasHandled) never pair — they route their own tab
    // updates through NOTEBASE_RENAMED already.
    const movedFrom = wasHandled(relative) ? undefined : findMatch(pendingUnlinks, basename, ino);
    if (movedFrom) {
      const pending = pendingUnlinks.get(movedFrom)!;
      clearTimeout(pending.timer);
      pendingUnlinks.delete(movedFrom);
      // Tab follows the file (renderer); the index drops the old path and
      // picks up the new one. Crucially we do NOT emit FILE_DELETED for the
      // old path — that broadcast is what would close the tab.
      win.webContents.send(Channels.NOTEBASE_RENAMED, [{ old: pending.relative, new: relative }]);
      indexDeleted(pending.relative);
      emitCreate(relative);
      return;
    }

    // Normal create — emit now, but remember it briefly so an add-first move
    // (macOS: `add` precedes `unlink`) is recognized when its `unlink` lands.
    emitCreate(relative);
    if (!wasHandled(relative)) {
      recentAdds.set(filePath, {
        relative,
        basename,
        inode: ino,
        timer: armTimer(() => recentAdds.delete(filePath)),
      });
    }
  });

  notes.on('unlink', (filePath) => {
    if (win.isDestroyed()) return;
    const relative = filePath.slice(rootPath.length + 1);
    const basename = path.basename(filePath);
    const inode = inodeByPath.get(filePath);
    inodeByPath.delete(filePath);

    // In-app renames already moved the tab via NOTEBASE_RENAMED; emit the
    // delete immediately (unchanged behavior) rather than debouncing it.
    if (wasHandled(relative)) {
      win.webContents.send(Channels.NOTEBASE_FILE_DELETED, relative);
      indexDeleted(relative);
      return;
    }

    // Add-first ordering (macOS): the new path already arrived and is
    // buffered → surface the pair as a rename. The new path already emitted
    // its create + indexed on `add`; here we just reconnect the tab and drop
    // the old path from the index. No FILE_DELETED — that would close the tab.
    const movedTo = findMatch(recentAdds, basename, inode);
    if (movedTo) {
      const added = recentAdds.get(movedTo)!;
      clearTimeout(added.timer);
      recentAdds.delete(movedTo);
      win.webContents.send(Channels.NOTEBASE_RENAMED, [{ old: relative, new: added.relative }]);
      indexDeleted(relative);
      return;
    }

    // Nothing to pair yet: hold the delete so a slightly-late add (unlink-first
    // platforms) can still claim it; otherwise flushDelete surfaces a genuine
    // deletion once the window elapses.
    pendingUnlinks.set(filePath, {
      relative,
      basename,
      inode,
      timer: armTimer(() => flushDelete(filePath)),
    });
  });

  // Separate watcher scoped to .minerva/{sources,excerpts} so graph-backing
  // .ttl changes reindex without un-ignoring all of .minerva (bookmarks,
  // tabs, graph.ttl, etc.).
  const sourcesRoot = path.join(rootPath, '.minerva', 'sources');
  const excerptsRoot = path.join(rootPath, '.minerva', 'excerpts');
  // chokidar can miss directories that don't exist at startup, so materialize
  // the tree before registering. Safe: recursive mkdir no-ops if present.
  try { fs.mkdirSync(sourcesRoot, { recursive: true }); } catch { /* ignore */ }
  try { fs.mkdirSync(excerptsRoot, { recursive: true }); } catch { /* ignore */ }
  const minervaData = watch([sourcesRoot, excerptsRoot], {
    persistent: true,
    ignoreInitial: true,
    depth: 2,
  });

  const handleMinervaEvent = (filePath: string, kind: 'upsert' | 'delete') => {
    if (win.isDestroyed()) return;
    const sourceId = extractSourceId(filePath);
    if (sourceId) {
      if (kind === 'upsert') void callbacks?.onSourceMetaChanged?.(sourceId);
      else void callbacks?.onSourceMetaDeleted?.(sourceId);
      return;
    }
    const excerptId = extractExcerptId(filePath);
    if (excerptId) {
      if (kind === 'upsert') void callbacks?.onExcerptChanged?.(excerptId);
      else void callbacks?.onExcerptDeleted?.(excerptId);
    }
  };

  minervaData.on('change', (filePath) => handleMinervaEvent(filePath, 'upsert'));
  minervaData.on('add', (filePath) => handleMinervaEvent(filePath, 'upsert'));
  minervaData.on('unlink', (filePath) => handleMinervaEvent(filePath, 'delete'));

  const disposeMoveDetection = () => {
    for (const p of pendingUnlinks.values()) clearTimeout(p.timer);
    for (const a of recentAdds.values()) clearTimeout(a.timer);
    pendingUnlinks.clear();
    recentAdds.clear();
    inodeByPath.clear();
  };

  watchers.set(id, { notes, minervaData, disposeMoveDetection });

  // Resolve once both chokidar watchers have completed their initial scan
  // and a brief settle window has elapsed. Production callers ignore this
  // promise (the watcher works fine before ready — just no events for
  // files added during the scan window). Tests await it so they don't
  // have to race timing.
  //
  // The post-ready settle delay is real: on macOS fsevents the watcher
  // can fire `ready` before the kernel-level event subscription is fully
  // armed for new sub-directories, leading to dropped events on small
  // file ops that follow immediately. 100ms is empirically enough to
  // close the gap without making real teardown sluggish.
  return Promise.all([
    new Promise<void>((r) => notes.once('ready', () => r())),
    new Promise<void>((r) => minervaData.once('ready', () => r())),
  ]).then(() => new Promise<void>((r) => setTimeout(r, 100)));
}

export function stopWatching(id: number): void {
  const pair = watchers.get(id);
  if (pair) {
    // chokidar's close() returns a Promise that resolves when handles
    // are released. We don't block on it: callers (window-manager
    // teardown, test cleanup) just want the watcher detached now.
    pair.disposeMoveDetection();
    void pair.notes.close();
    void pair.minervaData.close();
    watchers.delete(id);
  }
}
