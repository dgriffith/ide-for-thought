import { watch, type FSWatcher } from 'chokidar';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';

let watcher: FSWatcher | null = null;

export function startWatching(rootPath: string, win: BrowserWindow): void {
  stopWatching();

  watcher = watch(rootPath, {
    ignored: [
      /(^|[/\\])\./,          // dotfiles
      '**/node_modules/**',
      '**/.ide_for_thought/**',
    ],
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', (filePath) => {
    if (filePath.endsWith('.md')) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_CHANGED, relative);
    }
  });

  watcher.on('add', (filePath) => {
    if (filePath.endsWith('.md')) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_CREATED, relative);
    }
  });

  watcher.on('unlink', (filePath) => {
    if (filePath.endsWith('.md')) {
      const relative = filePath.slice(rootPath.length + 1);
      win.webContents.send(Channels.NOTEBASE_FILE_DELETED, relative);
    }
  });
}

export function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
