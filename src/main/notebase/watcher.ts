import { watch, type FSWatcher } from 'chokidar';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';

const watchers = new Map<number, FSWatcher>();

export function startWatching(rootPath: string, win: BrowserWindow, id: number): void {
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
    if (filePath.endsWith('.md') && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_CHANGED, relative);
    }
  });

  watcher.on('add', (filePath) => {
    if (filePath.endsWith('.md') && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_CREATED, relative);
    }
  });

  watcher.on('unlink', (filePath) => {
    if (filePath.endsWith('.md') && !win.isDestroyed()) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_DELETED, relative);
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
