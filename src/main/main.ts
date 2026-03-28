import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc';
import { buildMenu } from './menu';
import { createWindow } from './window-manager';

app.whenReady().then(() => {
  registerIpcHandlers();
  const win = createWindow();
  buildMenu(win);

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
