import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';

const INDEXABLE_EXTS = new Set(['.md', '.ttl']);

export interface WatcherCallbacks {
  onFileChanged: (relativePath: string) => void;
  onFileCreated: (relativePath: string) => void;
  onFileDeleted: (relativePath: string) => void;
}

const watchers = new Map<number, FSWatcher>();

export function startWatching(
  rootPath: string,
  win: BrowserWindow,
  id: number,
  callbacks?: WatcherCallbacks,
): void {
  stopWatching(id);

  const watcher = watch(rootPath, {
    ignored: [
      /(^|[/\\])\./,
      '**/node_modules/**',
      '**/.minerva/**',
    ],
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', (filePath) => {
    if (INDEXABLE_EXTS.has(path.extname(filePath)) && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_CHANGED, relative);
      callbacks?.onFileChanged(relative);
    }
  });

  watcher.on('add', (filePath) => {
    if (INDEXABLE_EXTS.has(path.extname(filePath)) && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_CREATED, relative);
      callbacks?.onFileCreated(relative);
    }
  });

  watcher.on('unlink', (filePath) => {
    if (INDEXABLE_EXTS.has(path.extname(filePath)) && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_DELETED, relative);
      callbacks?.onFileDeleted(relative);
    }
  });

  watchers.set(id, watcher);
}

export function stopWatching(id: number): void {
  const watcher = watchers.get(id);
  if (watcher) {
    watcher.close();
    watchers.delete(id);
  }
}
