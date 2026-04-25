import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { registerIpcHandlers } from './ipc';
import { buildMenu } from './menu';
import { createWindow, openProjectInWindow } from './window-manager';
import { loadSession } from './session';
import { registerBuiltinExecutors } from './compute/executors';
import { registerBuiltinExporters } from './publish';
import { installCsp } from './security';
import { flushAllProjects } from './project-context';
import { shutdownAllKernels } from './compute/python-kernel';

app.setName('Minerva');

app.whenReady().then(async () => {
  installCsp();
  registerIpcHandlers();
  registerBuiltinExecutors();
  registerBuiltinExporters();

  const session = loadSession().filter((s) => {
    try { return fs.statSync(s.rootPath).isDirectory(); } catch { return false; }
  });

  if (session.length > 0) {
    for (const state of session) {
      const win = createWindow({ x: state.x, y: state.y, width: state.width, height: state.height });
      buildMenu(win);
      win.webContents.once('did-finish-load', async () => {
        await openProjectInWindow(win, state.rootPath);
        win.webContents.send('project:opened', {
          rootPath: state.rootPath,
          name: path.basename(state.rootPath),
        });
      });
    }
  } else {
    const win = createWindow();
    buildMenu(win);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// graph.ttl is a cold snapshot (#348). releaseProject persists per-project
// when a window closes; this catches Cmd+Q where windows close concurrently
// and we want the snapshot on disk before the process exits. Re-emits the
// before-quit event after the flush so Electron's normal teardown still
// runs.
let isFlushingForQuit = false;
app.on('before-quit', (event) => {
  if (isFlushingForQuit) return;
  event.preventDefault();
  isFlushingForQuit = true;
  Promise.allSettled([
    flushAllProjects(),
    shutdownAllKernels(),
  ])
    .catch((err) => console.warn('[quit] shutdown failed:', err))
    .finally(() => app.quit());
});
