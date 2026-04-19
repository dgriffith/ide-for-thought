import { watch, type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';

const INDEXABLE_EXTS = new Set(['.md', '.ttl']);

export interface WatcherCallbacks {
  onFileChanged: (relativePath: string) => void;
  onFileCreated: (relativePath: string) => void;
  onFileDeleted: (relativePath: string) => void;
  onSourceMetaChanged?: (sourceId: string) => void;
  onSourceMetaDeleted?: (sourceId: string) => void;
}

interface WatcherPair {
  notes: FSWatcher;
  sources: FSWatcher;
}

const watchers = new Map<number, WatcherPair>();

const SOURCE_META_RE = /(?:^|[/\\])\.minerva[/\\]sources[/\\]([^/\\]+)[/\\]meta\.ttl$/;

function extractSourceId(absPath: string): string | null {
  const m = absPath.match(SOURCE_META_RE);
  return m ? m[1] : null;
}

export function startWatching(
  rootPath: string,
  win: BrowserWindow,
  id: number,
  callbacks?: WatcherCallbacks,
): void {
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

  // Separate watcher scoped to .minerva/sources so meta.ttl changes reindex
  // without un-ignoring all of .minerva (bookmarks, tabs, graph.ttl, etc.).
  const sourcesRoot = path.join(rootPath, '.minerva', 'sources');
  // chokidar can miss directories that don't exist at startup, so materialize
  // the tree before registering. Safe: recursive mkdir no-ops if present.
  try { fs.mkdirSync(sourcesRoot, { recursive: true }); } catch { /* ignore */ }
  const sources = watch(sourcesRoot, {
    persistent: true,
    ignoreInitial: true,
    depth: 2,
  });

  const handleSourceEvent = (filePath: string, kind: 'upsert' | 'delete') => {
    const sourceId = extractSourceId(filePath);
    if (!sourceId || win.isDestroyed()) return;
    if (kind === 'upsert') callbacks?.onSourceMetaChanged?.(sourceId);
    else callbacks?.onSourceMetaDeleted?.(sourceId);
  };

  sources.on('change', (filePath) => handleSourceEvent(filePath, 'upsert'));
  sources.on('add', (filePath) => handleSourceEvent(filePath, 'upsert'));
  sources.on('unlink', (filePath) => handleSourceEvent(filePath, 'delete'));

  watchers.set(id, { notes, sources });
}

export function stopWatching(id: number): void {
  const pair = watchers.get(id);
  if (pair) {
    pair.notes.close();
    pair.sources.close();
    watchers.delete(id);
  }
}
