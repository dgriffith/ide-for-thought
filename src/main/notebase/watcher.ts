import { watch, type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';

import { INDEXABLE_EXTS } from './indexable-files';

export interface WatcherCallbacks {
  onFileChanged: (relativePath: string) => void;
  onFileCreated: (relativePath: string) => void;
  onFileDeleted: (relativePath: string) => void;
  onSourceMetaChanged?: (sourceId: string) => void;
  onSourceMetaDeleted?: (sourceId: string) => void;
  onExcerptChanged?: (excerptId: string) => void;
  onExcerptDeleted?: (excerptId: string) => void;
}

interface WatcherPair {
  notes: FSWatcher;
  minervaData: FSWatcher;
}

const watchers = new Map<number, WatcherPair>();

const SOURCE_DIR_RE = /(?:^|[/\\])\.minerva[/\\]sources[/\\]([^/\\]+)[/\\](meta\.ttl|body\.md)$/;
const EXCERPT_RE = /(?:^|[/\\])\.minerva[/\\]excerpts[/\\]([^/\\]+)\.ttl$/;

/** Returns the source id if the path is .minerva/sources/<id>/{meta.ttl,body.md}. */
function extractSourceId(absPath: string): string | null {
  const m = absPath.match(SOURCE_DIR_RE);
  return m ? m[1] : null;
}

function extractExcerptId(absPath: string): string | null {
  const m = absPath.match(EXCERPT_RE);
  return m ? m[1] : null;
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
  });

  notes.on('change', (filePath) => {
    if (INDEXABLE_EXTS.has(path.extname(filePath)) && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_CHANGED, relative);
      callbacks?.onFileChanged(relative);
    }
  });

  notes.on('add', (filePath) => {
    if (INDEXABLE_EXTS.has(path.extname(filePath)) && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_CREATED, relative);
      callbacks?.onFileCreated(relative);
    }
  });

  notes.on('unlink', (filePath) => {
    if (INDEXABLE_EXTS.has(path.extname(filePath)) && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_DELETED, relative);
      callbacks?.onFileDeleted(relative);
    }
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
      if (kind === 'upsert') callbacks?.onSourceMetaChanged?.(sourceId);
      else callbacks?.onSourceMetaDeleted?.(sourceId);
      return;
    }
    const excerptId = extractExcerptId(filePath);
    if (excerptId) {
      if (kind === 'upsert') callbacks?.onExcerptChanged?.(excerptId);
      else callbacks?.onExcerptDeleted?.(excerptId);
    }
  };

  minervaData.on('change', (filePath) => handleMinervaEvent(filePath, 'upsert'));
  minervaData.on('add', (filePath) => handleMinervaEvent(filePath, 'upsert'));
  minervaData.on('unlink', (filePath) => handleMinervaEvent(filePath, 'delete'));

  watchers.set(id, { notes, minervaData });

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
    void pair.notes.close();
    void pair.minervaData.close();
    watchers.delete(id);
  }
}
