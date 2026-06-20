import { BrowserWindow } from 'electron';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { startWatching, stopWatching } from './notebase/watcher';
import { markPathHandled as markPathHandledImpl, wasHandled } from './notebase/path-dedup';
import * as graph from './graph/index';
import * as search from './search/index';
import * as notebaseFs from './notebase/fs';
import * as templates from './notebase/templates';
import * as tables from './sources/tables';
import { invalidate as invalidatePythonModules } from './compute/python-kernel';
import { addRecentProject } from './recent-projects';
import { rebuildMenu } from './menu';
import { saveSession, type WindowState } from './session';
import { acquireProject, releaseProject } from './project-context';
import { installNavigationGuards } from './security';
import { ensureClipperRunning, stopClipperServer, isClipperEnabled } from './clipper/lifecycle';
import type { ProjectContext } from './project-context-types';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload imports only `electron` + the pure `shared/channels`
      // module (no Node builtins), so the renderer never needs Node — run it
      // sandboxed, matching the privileged-site and PDF-render windows (#684).
      sandbox: true,
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
      win.webContents.send(Channels.PROJECT_OPENED, {
        rootPath: ctx.rootPath,
        name: path.basename(ctx.rootPath),
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
    if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_NAME_COLLISION, collision);
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
  rebuildMenu();

  // Deduplication: IPC handlers mark paths they've already indexed
  // (see `notebase/path-dedup.ts`).
  let indexPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedPersist = () => {
    if (indexPersistTimer) clearTimeout(indexPersistTimer);
    indexPersistTimer = setTimeout(async () => {
      // graph.ttl is a cold snapshot now (#348) — fully reconstructible
      // from notes/sources/excerpts/CSVs/conversations/proposals, so we
      // skip per-write serialization. Search index isn't reconstructed
      // automatically, so it still gets the live persist.
      await search.persist(projectCtx);
    }, 1000);
  };

  // Coalesce `.py` edits into a single kernel-invalidate call (#529).
  // A flurry of editor saves (autosave, formatter pass, find-replace) on
  // the same module shouldn't fan out into a separate invalidate per
  // write — the kernel just needs to know "these modules are stale" once
  // the writes settle. 300ms matches the responsiveness window for
  // re-running an importing cell while still grouping a multi-file
  // formatter pass.
  let pyInvalidatePaths = new Set<string>();
  let pyInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
  const queuePyInvalidate = (relativePath: string) => {
    pyInvalidatePaths.add(relativePath);
    if (pyInvalidateTimer) clearTimeout(pyInvalidateTimer);
    pyInvalidateTimer = setTimeout(() => {
      const paths = [...pyInvalidatePaths];
      pyInvalidatePaths = new Set();
      pyInvalidateTimer = null;
      invalidatePythonModules(rootPath, paths);
    }, 300);
  };

  // startWatching returns a ready-promise (#345); we don't await here
  // because the watcher works fine before its initial scan completes.
  /**
   * Given a watched path that might affect a CSV's registration,
   * return the project-relative path of the CSV to re-register, or
   * null when no sibling table needs updating (#237).
   *
   * Two trigger shapes:
   *   - `<stem>.csv.schema.yaml` → re-register `<stem>.csv`.
   *   - `<stem>.md` (companion note) → re-register `<stem>.csv` if it
   *     exists on disk. The companion may declare `table_name:` or
   *     a `csv:` schema block, either of which changes registration.
   *
   * The .csv itself is handled by the existing branch in the caller —
   * this helper specifically covers the sibling-edit case.
   */
  async function siblingCsvForReregister(relativePath: string): Promise<string | null> {
    if (relativePath.endsWith('.csv.schema.yaml')) {
      return relativePath.slice(0, -'.schema.yaml'.length);
    }
    if (relativePath.toLowerCase().endsWith('.md')) {
      const csvCandidate = relativePath.replace(/\.md$/i, '.csv');
      try {
        await notebaseFs.readFile(rootPath, csvCandidate);
        return csvCandidate;
      } catch { /* no sibling CSV — common case */ }
    }
    return null;
  }

  async function reregisterSibling(relativePath: string): Promise<void> {
    const csvPath = await siblingCsvForReregister(relativePath);
    if (!csvPath) return;
    try {
      await tables.registerCsv(projectCtx, csvPath);
      if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
      // Collisions broadcast via the per-project listener attached
      // before acquireProject — no extra wiring here.
    } catch (err) {
      console.warn(`[tables] sibling re-register failed for ${csvPath} (via ${relativePath}):`, err);
    }
  }

  void startWatching(rootPath, win, win.id, {
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
      } else {
        await reregisterSibling(relativePath);
      }
      // #529 — editing a .py file invalidates its module in the running
      // Python kernel so a re-run of an importing cell picks up the new
      // definition without a manual Restart. Debounced + a no-op when
      // no kernel is running.
      if (relativePath.toLowerCase().endsWith('.py')) {
        queuePyInvalidate(relativePath);
      }
      // Sidecar yaml schemas aren't notes — skip the graph/search pass for
      // them. The watcher fires for them only so the registerCsv branch
      // above can update DuckDB.
      if (relativePath.endsWith('.csv.schema.yaml')) return;
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
      } else {
        await reregisterSibling(relativePath);
      }
      // A newly-added .py file with the same name as a previously-deleted
      // one (e.g. via git checkout / restore) can land while a stale entry
      // is still in sys.modules. Treat add the same as change for safety.
      if (relativePath.toLowerCase().endsWith('.py')) {
        queuePyInvalidate(relativePath);
      }
      if (relativePath.endsWith('.csv.schema.yaml')) return;
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
      } else {
        // Schema sidecar deleted → CSV reverts to read_csv_auto. Same
        // helper because the sibling lookup logic is identical; the CSV
        // re-registers without the schema.
        await reregisterSibling(relativePath);
      }
      if (relativePath.endsWith('.csv.schema.yaml')) return;
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
  rebuildMenu();
  persistSession();
  void syncClipperLifecycle();
}

export function getWindowById(id: number): BrowserWindow | null {
  return BrowserWindow.fromId(id) ?? null;
}

export function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}
