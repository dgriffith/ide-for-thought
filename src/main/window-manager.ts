import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { startWatching, stopWatching } from './notebase/watcher';
import * as graph from './graph/index';
import * as search from './search/index';
import * as notebaseFs from './notebase/fs';
import * as tables from './sources/tables';
import { addRecentProject } from './recent-projects';
import { rebuildMenu } from './menu';
import { saveSession, type WindowState } from './session';
import { acquireProject, releaseProject } from './project-context';
import { installNavigationGuards } from './security';
import type { ProjectContext } from './project-context-types';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

interface WindowContext {
  rootPath: string | null;
  graphStore: typeof graph | null;
}

const contexts = new Map<number, WindowContext>();
const watchers = new Map<number, string>();
const recentlyHandledPaths = new Map<string, number>();

/** Mark a path as recently handled by IPC to avoid duplicate watcher re-indexing */
export function markPathHandled(relativePath: string): void {
  recentlyHandledPaths.set(relativePath, Date.now());
}

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
  installNavigationGuards(win.webContents);

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
    const heldRoot = contexts.get(win.id)?.rootPath ?? null;
    contexts.delete(win.id);
    if (heldRoot) {
      // Fire-and-forget: window's already gone; the release just disposes
      // shared state if this was the last acquirer.
      void releaseProject(heldRoot, win.id);
    }
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

/** Every live BrowserWindow whose context has the given rootPath open. */
export function windowsForProject(rootPath: string): BrowserWindow[] {
  const hits: BrowserWindow[] = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (contexts.get(win.id)?.rootPath === rootPath) hits.push(win);
  }
  return hits;
}

export async function openProjectInWindow(win: BrowserWindow, rootPath: string): Promise<void> {
  const ctx = getContext(win.id);

  // Tear down previous: stop the watcher, and if the window already held a
  // (different) project, release that project's reference. If the window
  // was on the same project, no-op — we're effectively reloading.
  if (watchers.has(win.id)) {
    stopWatching(win.id);
    watchers.delete(win.id);
  }
  const previousRoot = ctx.rootPath;
  if (previousRoot && previousRoot !== rootPath) {
    await releaseProject(previousRoot, win.id);
  }

  ctx.rootPath = rootPath;
  const projectCtx: ProjectContext = await acquireProject(rootPath, win.id);
  addRecentProject(rootPath);
  rebuildMenu();

  // Deduplication: IPC handlers mark paths they've already indexed
  const wasHandled = (p: string) => {
    const ts = recentlyHandledPaths.get(p);
    if (!ts || Date.now() - ts > 2000) { recentlyHandledPaths.delete(p); return false; }
    return true;
  };

  let indexPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedPersist = () => {
    if (indexPersistTimer) clearTimeout(indexPersistTimer);
    indexPersistTimer = setTimeout(async () => {
      await Promise.all([search.persist(projectCtx), graph.persistGraph(projectCtx)]);
    }, 1000);
  };

  startWatching(rootPath, win, win.id, {
    onFileChanged: async (relativePath) => {
      if (wasHandled(relativePath)) return;
      // CSVs route to DuckDB first in an independent try. registerCsv doesn't
      // read the file content into memory (DuckDB reads lazily on query), so
      // it's cheap and hard to fail — keeping it outside the graph+search
      // pipeline means a graph indexing hiccup can't skip table registration.
      if (relativePath.toLowerCase().endsWith('.csv')) {
        try {
          await tables.registerCsv(projectCtx, relativePath);
          if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
        } catch (err) { console.warn(`[tables] registerCsv failed for ${relativePath}:`, err); }
      }
      try {
        const content = await notebaseFs.readFile(rootPath, relativePath);
        await graph.indexNote(projectCtx, relativePath, content);
        search.indexNote(projectCtx, relativePath, content);
        debouncedPersist();
      } catch (err) {
        // Usually a race (file deleted between events), but log so real bugs
        // don't hide in silence.
        console.warn(`[watcher] indexing failed for ${relativePath}:`, err);
      }
    },
    onFileCreated: async (relativePath) => {
      if (wasHandled(relativePath)) return;
      if (relativePath.toLowerCase().endsWith('.csv')) {
        try {
          await tables.registerCsv(projectCtx, relativePath);
          if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
        } catch (err) { console.warn(`[tables] registerCsv failed for ${relativePath}:`, err); }
      }
      try {
        const content = await notebaseFs.readFile(rootPath, relativePath);
        await graph.indexNote(projectCtx, relativePath, content);
        search.indexNote(projectCtx, relativePath, content);
        debouncedPersist();
      } catch (err) {
        console.warn(`[watcher] indexing failed for ${relativePath}:`, err);
      }
    },
    onFileDeleted: async (relativePath) => {
      if (wasHandled(relativePath)) return;
      if (relativePath.toLowerCase().endsWith('.csv')) {
        try {
          await tables.unregisterCsv(projectCtx, relativePath);
          if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
        } catch (err) { console.warn(`[tables] unregisterCsv failed for ${relativePath}:`, err); }
      }
      try {
        search.removeNote(projectCtx, relativePath);
        graph.removeNote(projectCtx, relativePath);
      } catch (err) {
        console.warn(`[watcher] removeNote failed for ${relativePath}:`, err);
      }
      debouncedPersist();
    },
    onSourceMetaChanged: async (sourceId) => {
      try {
        const metaContent = await notebaseFs.readFile(rootPath, `.minerva/sources/${sourceId}/meta.ttl`);
        let bodyContent: string | undefined;
        try {
          bodyContent = await notebaseFs.readFile(rootPath, `.minerva/sources/${sourceId}/body.md`);
        } catch { /* body optional */ }
        graph.indexSource(projectCtx, sourceId, metaContent, bodyContent);
        debouncedPersist();
        if (!win.isDestroyed()) win.webContents.send(Channels.SOURCES_CHANGED);
      } catch { /* meta.ttl may have been deleted between events */ }
    },
    onSourceMetaDeleted: (sourceId) => {
      graph.removeSource(projectCtx, sourceId);
      debouncedPersist();
      if (!win.isDestroyed()) win.webContents.send(Channels.SOURCES_CHANGED);
    },
    onExcerptChanged: async (excerptId) => {
      try {
        const relPath = `.minerva/excerpts/${excerptId}.ttl`;
        const content = await notebaseFs.readFile(rootPath, relPath);
        graph.indexExcerpt(projectCtx, excerptId, content);
        debouncedPersist();
        if (!win.isDestroyed()) win.webContents.send(Channels.EXCERPTS_CHANGED);
      } catch { /* file may have been deleted between events */ }
    },
    onExcerptDeleted: (excerptId) => {
      graph.removeExcerpt(projectCtx, excerptId);
      debouncedPersist();
      if (!win.isDestroyed()) win.webContents.send(Channels.EXCERPTS_CHANGED);
    },
  });
  watchers.set(win.id, rootPath);

  // Tables panel subscribes to this; fires once after the project's initial
  // scan so this window's sidebar populates without the renderer having to
  // poll. (For the second+ window on a project, the data is already
  // registered, but the renderer still needs a kick to load it.)
  if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
  persistSession();
}

export function closeProjectInWindow(winId: number): void {
  const ctx = contexts.get(winId);
  if (ctx) {
    if (watchers.has(winId)) {
      stopWatching(winId);
      watchers.delete(winId);
    }
    const previousRoot = ctx.rootPath;
    ctx.rootPath = null;
    if (previousRoot) {
      void releaseProject(previousRoot, winId);
    }
  }
  rebuildMenu();
  persistSession();
}

export function getWindowById(id: number): BrowserWindow | null {
  return BrowserWindow.fromId(id) ?? null;
}

export function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}
