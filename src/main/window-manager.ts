import { BrowserWindow } from 'electron';
import path from 'node:path';
import { startWatching, stopWatching } from './notebase/watcher';
import * as graph from './graph/index';
import * as search from './search/index';
import { addRecentProject } from './recent-projects';
import { rebuildMenu } from './menu';
import { saveSession, type WindowState } from './session';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

interface WindowContext {
  rootPath: string | null;
  graphStore: typeof graph | null;
}

const contexts = new Map<number, WindowContext>();
const watchers = new Map<number, string>();

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistSession(): void {
  // Debounce to avoid writing on every pixel of a resize/move
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const windows: WindowState[] = [];
    for (const win of BrowserWindow.getAllWindows()) {
      const ctx = contexts.get(win.id);
      if (ctx?.rootPath && !win.isDestroyed()) {
        const bounds = win.getBounds();
        windows.push({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          rootPath: ctx.rootPath,
        });
      }
    }
    saveSession(windows);
  }, 500);
}

export function createWindow(opts?: { x?: number; y?: number; width?: number; height?: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: opts?.width ?? 1200,
    height: opts?.height ?? 800,
    ...(opts?.x != null && opts?.y != null ? { x: opts.x, y: opts.y } : {}),
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
    persistSession();
  });

  win.on('move', persistSession);
  win.on('resize', persistSession);

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
  await Promise.all([
    graph.indexAllNotes(rootPath),
    search.indexAllNotes(rootPath),
  ]);
  persistSession();
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
  persistSession();
}

export function getWindowById(id: number): BrowserWindow | null {
  return BrowserWindow.fromId(id) ?? null;
}

export function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}
