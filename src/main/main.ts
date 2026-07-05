import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { registerIpcHandlers } from './ipc';
import { buildMenu, rebuildMenu } from './menu';
import { createWindow, openProjectInWindow, setMenuRebuilder } from './window-manager';
import { appIconPath } from './app-icon';
import { loadSession } from './session';
import { registerBuiltinExecutors } from './compute/executors';
import { registerBuiltinExporters } from './publish';
import { installCsp, installMediaPermissions } from './security';
import { flushAllProjects } from './project-context';
import { shutdownAllKernels } from './compute/python-kernel';
import { stopClipperServer } from './clipper/lifecycle';
import { registerSkillsAtStartup } from './skills/register';
import { initAutoUpdate, setUpdateStateListener } from './auto-update';
import { installE2EHooks } from './e2e-hooks';

app.setName('Minerva');

// e2e test seams (#998) — no-op unless MINERVA_E2E=1 (set by the Playwright job).
installE2EHooks();

// Boot-trace: stderr-tagged so the e2e smoke test (#394) can recover them
// from the captured main-process stream when launch hangs on CI (#518).
// In normal runs these are a few lines and harmless; on a hang they tell
// us which step never returned — and the elapsed-ms makes them a cheap
// startup profile (which phase owns the time).
const BOOT_T0 = Date.now();
function boot(label: string): void {
  console.error(`[boot +${Date.now() - BOOT_T0}ms] ${label}`);
}

boot('main module loaded');

void app.whenReady().then(async () => {
  boot('app ready');
  // Break the menu.ts <-> window-manager.ts import cycle (#986): window-manager
  // triggers menu rebuilds through this injected callback rather than importing
  // `rebuildMenu` directly. Registered before any window is created so the
  // focus/project-change rebuild triggers are wired from the first window.
  setMenuRebuilder(rebuildMenu);
  // macOS dev dock icon (#805). A packaged .app gets its icon from the bundle
  // (packagerConfig.icon); an unpackaged `electron-forge start` shows the stock
  // Electron icon unless we set the dock icon here.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(appIconPath());
  }
  installCsp();
  installMediaPermissions();
  boot('csp installed');
  registerIpcHandlers();
  boot('ipc handlers registered');
  registerBuiltinExecutors();
  boot('executors registered');
  registerBuiltinExporters();
  boot('exporters registered');

  // In-app auto-update via the hosted update.electronjs.org feed (#662).
  // No-ops in dev (unpackaged); only a signed packaged build polls + applies.
  // Rebuild the menu on state changes so the "Restart to Install Update" item
  // appears once a build is staged (#963).
  setUpdateStateListener(() => rebuildMenu());
  initAutoUpdate();
  boot('auto-update initialized');

  // Load + register skill files (#625) before any menu is built, so the
  // dynamic Learning/Analysis menus include them on first paint. Failure to
  // load a skill is isolated per-file inside the loader; a total failure here
  // shouldn't block startup.
  await registerSkillsAtStartup().catch((err) => console.warn('[skills] startup load failed:', err));
  boot('skills registered');

  const session = loadSession().filter((s) => {
    try { return fs.statSync(s.rootPath).isDirectory(); } catch { return false; }
  });
  boot(`session loaded (entries=${session.length})`);

  if (session.length > 0) {
    for (const state of session) {
      const win = createWindow({ x: state.x, y: state.y, width: state.width, height: state.height });
      buildMenu(win);
      win.webContents.once('did-finish-load', async () => {
        boot(`renderer loaded — opening project ${path.basename(state.rootPath)}`);
        await openProjectInWindow(win, state.rootPath);
        boot(`project indexed ${path.basename(state.rootPath)}`);
        win.webContents.send(Channels.PROJECT_OPENED, {
          rootPath: state.rootPath,
          name: path.basename(state.rootPath),
        });
      });
    }
  } else {
    const win = createWindow();
    buildMenu(win);
  }
  boot('window(s) created');

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
    stopClipperServer(),
  ])
    .catch((err) => console.warn('[quit] shutdown failed:', err))
    .finally(() => app.quit());
});
