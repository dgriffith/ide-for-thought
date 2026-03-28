import { BrowserWindow } from 'electron';
import path from 'node:path';
import { startWatching, stopWatching } from './notebase/watcher';
import * as graph from './graph/index';
import { addRecentProject } from './recent-projects';
import { rebuildMenu } from './menu';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

interface WindowContext {
  rootPath: string | null;
  graphStore: typeof graph | null;
}

const contexts = new Map<number, WindowContext>();
const watchers = new Map<number, string>();

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  contexts.set(win.id, { rootPath: null, graphStore: null });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  win.on('closed', () => {
    const watchPath = watchers.get(win.id);
    if (watchPath) {
      stopWatching(win.id);
      watchers.delete(win.id);
    }
    contexts.delete(win.id);
  });

  win.on('focus', () => {
    rebuildMenu();
  });

  return win;
}

export function getContext(winId: number): WindowContext {
  let ctx = contexts.get(winId);
  if (!ctx) {
    ctx = { rootPath: null, graphStore: null };
    contexts.set(winId, ctx);
  }
  return ctx;
}

export function getRootPath(winId: number): string | null {
  return contexts.get(winId)?.rootPath ?? null;
}

export async function openProjectInWindow(win: BrowserWindow, rootPath: string): Promise<void> {
  const ctx = getContext(win.id);

  // Tear down previous
  if (watchers.has(win.id)) {
    stopWatching(win.id);
    watchers.delete(win.id);
  }

  ctx.rootPath = rootPath;
  addRecentProject(rootPath);
  rebuildMenu();

  startWatching(rootPath, win, win.id);
  watchers.set(win.id, rootPath);

  await graph.initGraph(rootPath);
  await graph.indexAllNotes(rootPath);
}

export function closeProjectInWindow(winId: number): void {
  const ctx = contexts.get(winId);
  if (ctx) {
    if (watchers.has(winId)) {
      stopWatching(winId);
      watchers.delete(winId);
    }
    ctx.rootPath = null;
  }
}

export function getWindowById(id: number): BrowserWindow | null {
  return BrowserWindow.fromId(id) ?? null;
}

export function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}
