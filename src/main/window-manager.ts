import { BrowserWindow } from 'electron';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { broadcast } from './ipc/broadcast';
import { appIconPath } from './app-icon';
import { resolveDisplayName } from './project-config';
import { startWatching, stopWatching } from './notebase/watcher';
import { createWatchHandlers } from './notebase/watch-handlers';
import { markPathHandled as markPathHandledImpl } from './notebase/path-dedup';
import type * as graph from './graph/index';
import * as templates from './notebase/templates';
import * as tables from './sources/tables';
import { addRecentProject } from './recent-projects';
import { saveSession, type WindowState } from './session';
import { acquireProject, releaseProject } from './project-context';
import { runBackfill } from './embeddings/backfill';
import { installNavigationGuards, HARDENED_WEB_PREFERENCES } from './security';
import { ensureClipperRunning, stopClipperServer, isClipperEnabled } from './clipper/lifecycle';
import type { ProjectContext } from './project-context-types';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Menu-rebuild trigger, injected rather than imported (#986). window-manager
// needs to rebuild the native menu when window/project state changes (focus,
// project open/close), but importing `rebuildMenu` from `./menu` created a
// runtime import cycle — `menu.ts` already imports window helpers from here.
// main.ts (the composition root) registers `rebuildMenu` via
// `setMenuRebuilder` at startup, so the edge points one way now: menu → window.
let menuRebuilder: (() => void) | null = null;
export function setMenuRebuilder(fn: () => void): void {
  menuRebuilder = fn;
}

// Same one-way-edge rationale as `menuRebuilder`: drop a closed window's
// reported note/selection state from the menu module's per-window map.
let menuStateCleaner: ((winId: number) => void) | null = null;
export function setMenuStateCleaner(fn: (winId: number) => void): void {
  menuStateCleaner = fn;
}

interface WindowContext {
  rootPath: string | null;
  graphStore: typeof graph | null;
}

const contexts = new Map<number, WindowContext>();
const watchers = new Map<number, string>();

/** Mark a path as recently handled by IPC to avoid duplicate watcher re-indexing */
export function markPathHandled(relativePath: string): void {
  markPathHandledImpl(relativePath);
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
    // Window + taskbar icon on Linux/Windows (macOS uses the app bundle's
    // embedded icon and ignores this) (#805).
    icon: appIconPath(),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // contextIsolation on / nodeIntegration off / sandbox on. The preload
      // imports only `electron` + the pure `shared/channels` module (no Node
      // builtins), so the renderer never needs Node — run it sandboxed,
      // matching the privileged-site and PDF-render windows (#339, #684).
      ...HARDENED_WEB_PREFERENCES,
    },
  });

  contexts.set(win.id, { rootPath: null, graphStore: null });
  installNavigationGuards(win.webContents);

  // Re-announce the open project to the renderer on every page load. The
  // initial open is driven elsewhere (session restore in main.ts, or the
  // open/new IPC handlers), but a renderer reload — e.g. the Vite HMR client
  // forcing a full reload when its websocket reconnects after the laptop wakes
  // from sleep — resets the renderer's in-memory notebase store to the empty
  // "Open Thoughtbase" view. The project the window still holds in `contexts`
  // would otherwise be stranded in main with no way back into the UI short of
  // reopening by hand. Registered before any did-finish-load handler in
  // main.ts, so on the very first load this no-ops (rootPath still null) and
  // the session-restore handler does the real open; on later reloads it
  // rehydrates. Idempotent — no-op until a project is open.
  win.webContents.on('did-finish-load', () => {
    const ctx = contexts.get(win.id);
    if (ctx?.rootPath && !win.isDestroyed()) {
      broadcast(win, Channels.PROJECT_OPENED, {
        rootPath: ctx.rootPath,
        name: resolveDisplayName(ctx.rootPath),
      });
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(
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
    menuStateCleaner?.(win.id);
    if (heldRoot) {
      // Fire-and-forget: window's already gone; the release just disposes
      // shared state if this was the last acquirer.
      void releaseProject(heldRoot, win.id);
    }
    persistSession();
    void syncClipperLifecycle();
  });

  win.on('move', persistSession);
  win.on('resize', persistSession);

  win.on('focus', () => {
    menuRebuilder?.();
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

/** Stream embedding-backfill progress to every window on a project (#836). */
/** Progress + completion for a File ▸ maintenance operation (#1814). Goes to
 *  every window holding the project, since a rebuild affects all of them. */
export function broadcastMaintenanceProgress(
  rootPath: string,
  progress: import('../shared/maintenance').MaintenanceProgress,
): void {
  for (const win of windowsForProject(rootPath)) {
    if (!win.isDestroyed()) broadcast(win, Channels.MAINTENANCE_PROGRESS, progress);
  }
}

export function broadcastBackfillProgress(
  rootPath: string,
  progress: { done: number; total: number; running: boolean },
): void {
  for (const win of windowsForProject(rootPath)) {
    if (!win.isDestroyed()) broadcast(win, Channels.EMBEDDINGS_BACKFILL_PROGRESS, progress);
  }
}

/**
 * Which thoughtbase a clipped page lands in: the focused window's project if
 * it has one, else the first open project. When the clip arrives Minerva isn't
 * focused (the browser is), so the fallback is the common path — fine for the
 * single-project norm; a multi-project picker is a later refinement.
 */
function resolveActiveRootPath(): string | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    const r = contexts.get(focused.id)?.rootPath;
    if (r) return r;
  }
  for (const ctx of contexts.values()) {
    if (ctx.rootPath) return ctx.rootPath;
  }
  return null;
}

/**
 * Reconcile the clipper server with desired state: running iff the feature is
 * enabled AND a thoughtbase is open. Called after any project open/close and
 * after the Settings toggle changes.
 */
async function syncClipperLifecycle(): Promise<void> {
  const enabled = await isClipperEnabled();
  const anyOpen = [...contexts.values()].some((c) => c.rootPath);
  if (enabled && anyOpen) await ensureClipperRunning(resolveActiveRootPath);
  else await stopClipperServer();
}

/**
 * Apply a clipper config change from Settings (#791): enable toggled, or the
 * secret rotated. Stop first so a fresh start picks up the new secret / state,
 * then reconcile. Exposed for the IPC layer.
 */
export async function applyClipperConfigChange(): Promise<void> {
  await stopClipperServer();
  await syncClipperLifecycle();
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
  // Subscribe to CSV table-name collisions BEFORE project init so
  // the init-time `registerAllCsvs` sweep is also covered (#354).
  // The console.warn alone wasn't visible to users; this surfaces a
  // toast pointing at `table_name:` as the fix. Unsub on window
  // close to avoid leaking listeners across project reopens.
  const unsubCollision = tables.onCsvTableCollision(rootPath, (collision) => {
    if (!win.isDestroyed()) broadcast(win, Channels.TABLES_NAME_COLLISION, collision);
  });
  win.once('closed', () => { unsubCollision(); });

  const projectCtx: ProjectContext = await acquireProject(rootPath, win.id);
  // Seed `.minerva/templates/` if absent (#475). Idempotent — existing
  // projects pick up the stock set the first time they're opened
  // after this lands; user-curated folders are left untouched.
  try {
    await templates.ensureSeeded(rootPath);
  } catch (err) {
    console.warn('[window-manager] template seed failed', err);
  }
  addRecentProject(rootPath);
  menuRebuilder?.();

  // Background embedding backfill (#836): embed any not-yet-embedded notes so
  // semantic search works on an existing thoughtbase, not just on edited notes.
  // Resumable + deduped (one run per project), and non-blocking — embedding is
  // off-thread. Progress streams to every window on this project; a final
  // running:false tick clears the indicator. project-close aborts it.
  void runBackfill(projectCtx, { onProgress: (p) => broadcastBackfillProgress(rootPath, p) });

  // startWatching returns a ready-promise (#345); we don't await here
  // because the watcher works fine before its initial scan completes.
  void startWatching(rootPath, win, win.id, createWatchHandlers({
    rootPath,
    projectCtx,
    broadcastIfAlive: (channel) => { if (!win.isDestroyed()) broadcast(win, channel); },
  }));
  watchers.set(win.id, rootPath);

  // Tables panel subscribes to this; fires once after the project's initial
  // scan so this window's sidebar populates without the renderer having to
  // poll. (For the second+ window on a project, the data is already
  // registered, but the renderer still needs a kick to load it.)
  if (!win.isDestroyed()) broadcast(win, Channels.TABLES_CHANGED);
  persistSession();
  void syncClipperLifecycle();
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
  menuRebuilder?.();
  persistSession();
  void syncClipperLifecycle();
}

export function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}
