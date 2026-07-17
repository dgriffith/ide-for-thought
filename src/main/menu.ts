import { Menu, shell, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { THEME_MODES, type ThemeMode } from '../shared/theme';
import { getRecentProjects } from './recent-projects';
import { createWindow, openProjectInWindow, getRootPath, broadcastBackfillProgress } from './window-manager';
import { runBackfill } from './embeddings/backfill';
import * as graph from './graph/index';
import { projectContext } from './project-context-types';
import * as search from './search/index';
import * as tables from './sources/tables';
import { STOCK_QUERIES } from '../shared/stock-queries';
import { listSavedQueries } from './saved-queries';
import { restartKernel as restartPythonKernel, interruptKernel as interruptPythonKernel } from './compute/python-kernel';
import * as publish from './publish';
import { getToolsByCategory, CATEGORIES } from '../shared/tools/registry';
import { groupToolsByGroup, hasNamedGroups } from '../shared/tools/grouping';
import { isSourceScoped, toolRequiresNote, toolRequiresSelection } from '../shared/tools/types';
import type { MenuEditorState } from '../shared/types';
import {
  checkForUpdatesNow,
  isUpdateDownloaded,
  quitAndInstallUpdate,
  getUpdateState,
} from './auto-update';

function send(channel: string, ...args: unknown[]) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send(channel, ...args);
}

// Current theme, mirrored from the renderer (which owns it in localStorage) so
// the View → Theme submenu can show the active radio (#1139). Defaults to the
// renderer's own default; corrected the moment the renderer reports on mount.
let currentThemeMode: ThemeMode = 'dark';

/** Renderer → main: record the active theme and refresh the menu's radio. */
export function setMenuThemeMode(mode: ThemeMode): void {
  if (mode === currentThemeMode) return;
  currentThemeMode = mode;
  rebuildMenu();
}

// Per-window editor gating state, mirrored from each renderer. Keyed by
// window id like `getRootPath(winId)` so a focus switch shows the right window's
// enablement; `rebuildMenu` reads the focused window's entry.
const editorStateByWin = new Map<number, MenuEditorState>();

/** Renderer → main: record a window's note/selection state and refresh the menu
 *  if that window is focused (its state is what's on screen). Deduped so a
 *  no-op report costs no rebuild. */
export function setMenuEditorState(winId: number, state: MenuEditorState): void {
  const prev = editorStateByWin.get(winId);
  if (prev && prev.hasEditor === state.hasEditor && prev.hasNote === state.hasNote && prev.hasSelection === state.hasSelection) return;
  editorStateByWin.set(winId, state);
  if (BrowserWindow.getFocusedWindow()?.id === winId) rebuildMenu();
}

/** Drop a window's editor state when it closes (called from window-manager). */
export function clearMenuEditorState(winId: number): void {
  editorStateByWin.delete(winId);
}

export function buildMenu(_win?: BrowserWindow): void {
  rebuildMenu();
}

/** Per-item preconditions beyond "a thoughtbase is open". */
interface GateReq {
  /** Needs any editor tab open (note/query/source) — e.g. pane commands. */
  editor?: boolean;
  /** Needs a note tab active. */
  note?: boolean;
  /** Needs a non-empty text selection (implies `note`). */
  selection?: boolean;
}
/** Enablement gate. `gate(item)` requires only an open thoughtbase (the common
 *  case); pass a `GateReq` to also require a note and/or selection. */
type Gate = <T extends Electron.MenuItemConstructorOptions>(item: T, req?: GateReq) => T;

export function rebuildMenu(): Electron.MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  // Enablement gate: most editor / ingest / graph operations require an
  // open thoughtbase. Without one, clicking would either silently no-op
  // or error; greying the items out signals intent. We rebuild the menu
  // on every window focus change and on open/close, so `hasProject`
  // tracks the focused window's state.
  const focusedWin = BrowserWindow.getFocusedWindow();
  const hasProject = focusedWin ? getRootPath(focusedWin.id) !== null : false;
  // Note/selection state is renderer-owned; the focused window reports it via
  // MENU_REPORT_EDITOR_STATE. Absent (window never reported) ⇒ treat as none.
  const editorState = focusedWin ? editorStateByWin.get(focusedWin.id) : undefined;
  const hasEditor = editorState?.hasEditor ?? false;
  const hasNote = editorState?.hasNote ?? false;
  const hasSelection = editorState?.hasSelection ?? false;
  const gate: Gate = (item, req) => {
    const ok =
      hasProject &&
      (!req?.editor || hasEditor) &&
      (!req?.note || hasNote) &&
      (!req?.selection || hasSelection);
    return { ...item, enabled: ok && (item.enabled ?? true) };
  };

  // rebuildMenu is the assembly line: each top-level menu is produced by its
  // own builder (below), sharing `gate` (project-enablement) and the
  // module-level `send`. The `...` spreads flatten the platform-conditional
  // menus (App / Window) and the dynamic Tools-for-Thought group, each of
  // which contributes zero-or-more top-level entries.
  const template: Electron.MenuItemConstructorOptions[] = [
    ...buildAppMenu(isMac),
    buildFileMenu(gate, isMac),
    buildEditMenu(gate, isMac),
    buildViewMenu(gate, isMac),
    buildNavigateMenu(gate),
    buildRefactorMenu(gate),
    ...buildToolMenus(gate),
    buildQueryMenu(gate),
    buildExportMenu(gate),
    ...buildWindowMenu(isMac),
    buildHelpMenu(isMac),
  ];

  lastTemplate = template;
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return template;
}

/** App menu (macOS only) — About, updates, Preferences, standard app roles. */
function buildAppMenu(isMac: boolean): Electron.MenuItemConstructorOptions[] {
  if (!isMac) return [];
  return [
    {
      label: 'Minerva',
      submenu: [
        { label: 'About Minerva', click: () => send(Channels.MENU_ABOUT) },
        { type: 'separator' as const },
        {
          // "Checking…" (disabled) while a check is in flight (#963).
          label: getUpdateState() === 'checking' ? 'Checking for Updates…' : 'Check for Updates…',
          enabled: getUpdateState() !== 'checking',
          click: () => checkForUpdatesNow(),
        },
        // Only present once a build is staged; installs on confirm+restart.
        ...(isUpdateDownloaded()
          ? [{ label: 'Restart to Install Update', click: () => quitAndInstallUpdate() }]
          : []),
        { type: 'separator' as const },
        {
          label: 'Preferences…',
          accelerator: 'Cmd+,',
          click: () => send(Channels.MENU_OPEN_SETTINGS),
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    },
  ];
}

/** Recent Thoughtbases submenu — the open-recent list plus a clear action. */
function buildRecentSubmenu(): Electron.MenuItemConstructorOptions[] {
  const recentProjects = getRecentProjects();
  return recentProjects.length > 0
    ? [
        ...recentProjects.map((projectPath) => ({
          label: path.basename(projectPath),
          sublabel: projectPath,
          click: () => {
            // Open in focused window if it has no project, otherwise new window
            const focused = BrowserWindow.getFocusedWindow();
            if (focused) {
              send('menu:openRecentProject', projectPath);
            } else {
              const win = createWindow();
              win.webContents.once('did-finish-load', async () => {
                await openProjectInWindow(win, projectPath);
                win.webContents.send(Channels.PROJECT_OPENED, { rootPath: projectPath, name: path.basename(projectPath) });
              });
            }
          },
        })),
        { type: 'separator' as const },
        {
          label: 'Clear Recent Thoughtbases',
          click: () => send(Channels.MENU_CLEAR_RECENT),
        },
      ]
    : [{ label: 'No Recent Thoughtbases', enabled: false }];
}

/** File menu — thoughtbase lifecycle, note actions, ingest/import, print, indexes. */
function buildFileMenu(gate: Gate, isMac: boolean): Electron.MenuItemConstructorOptions {
  return {
    label: 'File',
    submenu: [
      // Thoughtbase lifecycle first — the user's mental model is
      // "open my thoughtbase" before "do anything in it".
      {
        label: 'New Thoughtbase…',
        click: () => send(Channels.MENU_NEW_PROJECT),
      },
      {
        label: 'Open Thoughtbase…',
        accelerator: 'CmdOrCtrl+O',
        click: () => send(Channels.MENU_OPEN_PROJECT),
      },
      {
        label: 'Recent Thoughtbases',
        submenu: buildRecentSubmenu(),
      },
      gate({
        label: 'Close Thoughtbase',
        accelerator: 'CmdOrCtrl+Shift+W',
        click: () => send(Channels.MENU_CLOSE_PROJECT),
      }),
      { type: 'separator' },

      // Everyday note actions.
      gate({
        label: 'New Note',
        accelerator: 'CmdOrCtrl+N',
        click: () => send(Channels.MENU_NEW_NOTE),
      }),
      gate({
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => send(Channels.MENU_SAVE),
      }, { note: true }),
      gate({
        label: 'Save as Template…',
        click: () => send(Channels.MENU_SAVE_AS_TEMPLATE),
      }, { note: true }),
      { type: 'separator' },

      // Ingest / Import — bringing external things in.
      gate({
        label: 'Ingest URL as Source…',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => send(Channels.MENU_INGEST_URL),
      }),
      gate({
        label: 'Ingest Identifier…',
        accelerator: 'CmdOrCtrl+Shift+D',
        click: () => send(Channels.MENU_INGEST_IDENTIFIER),
      }),
      gate({
        label: 'Ingest File as Source…',
        click: () => send(Channels.MENU_INGEST_FILE),
      }),
      gate({
        label: 'Import BibTeX…',
        click: () => send(Channels.MENU_IMPORT_BIBTEX),
      }),
      gate({
        label: 'Import Zotero RDF…',
        click: () => send(Channels.MENU_IMPORT_ZOTERO_RDF),
      }),
      { type: 'separator' },

      // Windowing primitive — explicit blank new window, less common.
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => createWindow(),
      },
      { type: 'separator' },

      // Print / quick-PDF of the current view. Distinct from Export ▸ PDF,
      // which runs the note through the real publish pipeline; these two are
      // the "just capture what's on screen" escape hatches (named to say so).
      gate({
        label: 'Print…',
        click: () => send(Channels.MENU_PRINT),
      }, { note: true }),
      gate({
        label: 'Print to PDF…',
        click: async () => {
          const win = BrowserWindow.getFocusedWindow();
          if (!win) return;
          const result = await dialog.showSaveDialog(win, {
            title: 'Export as PDF',
            defaultPath: 'note.pdf',
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          });
          if (!result.canceled && result.filePath) {
            const data = await win.webContents.printToPDF({
              pageSize: 'Letter',
              printBackground: true,
            });
            const fs = await import('node:fs/promises');
            await fs.writeFile(result.filePath, data);
          }
        },
      }, { note: true }),
      { type: 'separator' },
      {
        label: 'Open In',
        submenu: [
          gate({
            label: 'Reveal in Finder',
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => send(Channels.SHELL_REVEAL_FILE),
          }, { note: true }),
          gate({
            label: 'Open in Default App',
            click: () => send(Channels.MENU_OPEN_IN_DEFAULT),
          }, { note: true }),
          gate({
            label: 'Open in Terminal',
            click: () => send(Channels.MENU_OPEN_IN_TERMINAL),
          }),
        ],
      },
      { type: 'separator' },
      gate({
        label: 'Rebuild All Indexes',
        click: async () => {
          const win = BrowserWindow.getFocusedWindow();
          if (!win) return;
          const rootPath = getRootPath(win.id);
          if (!rootPath) return;
          const ctx = projectContext(rootPath);
          // registerAllCsvs writes to the rdflib store that indexAllNotes
          // resets+rebuilds; sequence it after so its CSV-schema triples can't
          // land in the discarded store. search is independent (MiniSearch).
          // Mirrors acquireProject (see project-context.ts).
          await Promise.all([
            graph.indexAllNotes(ctx),
            search.indexAllNotes(ctx),
          ]);
          await tables.registerAllCsvs(ctx);
          if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
        },
      }),
      gate({
        label: 'Rebuild Semantic Index',
        // Force a full re-embed of the corpus (#836) — useful after suspected
        // corruption or to repopulate from scratch. Non-blocking; progress
        // shows in the status bar. Normal model-change / new-note backfill is
        // automatic on project open, so this is the explicit escape hatch.
        click: async () => {
          const win = BrowserWindow.getFocusedWindow();
          if (!win) return;
          const rootPath = getRootPath(win.id);
          if (!rootPath) return;
          await runBackfill(projectContext(rootPath), {
            force: true,
            onProgress: (p) => broadcastBackfillProgress(rootPath, p),
          });
        },
      }),
      gate({
        label: 'Interrupt Cell',
        // No default accelerator (#372). Cmd+. (the Jupyter
        // standard) collides with macOS Zoom In on this app's View
        // menu; the safest defaults for "Interrupt" are taken
        // elsewhere too. Users can wire their own via the
        // keybindings settings.
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (!win) return;
          const rootPath = getRootPath(win.id);
          if (!rootPath) return;
          interruptPythonKernel(rootPath);
        },
      }),
      gate({
        label: 'Restart Python Kernel',
        click: async () => {
          const win = BrowserWindow.getFocusedWindow();
          if (!win) return;
          const rootPath = getRootPath(win.id);
          if (!rootPath) return;
          await restartPythonKernel(rootPath);
        },
      }),
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };
}

/** Edit menu — standard edit roles plus find/replace, templates, sort. */
function buildEditMenu(gate: Gate, isMac: boolean): Electron.MenuItemConstructorOptions {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      gate({
        label: 'Find',
        accelerator: 'CmdOrCtrl+F',
        click: () => send(Channels.MENU_FIND),
      }, { note: true }),
      gate({
        label: 'Find and Replace',
        accelerator: 'CmdOrCtrl+H',
        click: () => send(Channels.MENU_FIND_REPLACE),
      }, { note: true }),
      gate({
        label: 'Find in Notes…',
        accelerator: 'CmdOrCtrl+Shift+F',
        click: () => send(Channels.MENU_FIND_IN_NOTES),
      }),
      gate({
        label: 'Replace in Notes…',
        accelerator: 'CmdOrCtrl+Shift+H',
        click: () => send(Channels.MENU_REPLACE_IN_NOTES),
      }),
      { type: 'separator' },
      gate({
        label: 'Insert Template…',
        click: () => send(Channels.MENU_INSERT_TEMPLATE),
      }, { note: true }),
      { type: 'separator' },
      gate({
        label: 'Sort Lines',
        click: () => send(Channels.MENU_SORT_LINES),
      }, { note: true }),
      ...(!isMac
        ? [
            { type: 'separator' as const },
            {
              label: 'Preferences…',
              accelerator: 'Ctrl+,',
              click: () => send(Channels.MENU_OPEN_SETTINGS),
            },
          ]
        : []),
    ],
  };
}

/** View menu — sidebars, conversations, editor splits, theme, zoom, fonts. */
function buildViewMenu(gate: Gate, isMac: boolean): Electron.MenuItemConstructorOptions {
  return {
    label: 'View',
    submenu: [
      gate({
        label: 'Toggle Left Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => send(Channels.MENU_TOGGLE_SIDEBAR),
      }),
      gate({
        label: 'Toggle Right Sidebar',
        accelerator: 'CmdOrCtrl+Shift+B',
        click: () => send(Channels.MENU_TOGGLE_RIGHT_SIDEBAR),
      }),
      gate({
        label: 'Toggle Conversations',
        accelerator: 'CmdOrCtrl+Shift+K',
        click: () => send(Channels.MENU_TOGGLE_CONVERSATIONS),
      }),
      // "New Conversation" moved to Learning ▸ "Ask a Question" (buildToolMenus).
      gate({
        label: 'Cycle Preview Mode',
        accelerator: 'CmdOrCtrl+Shift+P',
        click: () => send(Channels.MENU_TOGGLE_PREVIEW),
      }, { note: true }),
      { type: 'separator' },
      // Editor split — pane focus & layout commands (#814).
      gate({
        label: 'Split Editor Right',
        accelerator: 'CmdOrCtrl+\\',
        click: () => send(Channels.MENU_SPLIT_RIGHT),
      }),
      gate({
        label: 'Split Editor Down',
        accelerator: 'CmdOrCtrl+Shift+\\',
        click: () => send(Channels.MENU_SPLIT_DOWN),
      }),
      gate({
        label: 'Focus Next Group',
        accelerator: 'CmdOrCtrl+Alt+Right',
        click: () => send(Channels.MENU_FOCUS_NEXT_GROUP),
      }, { editor: true }),
      gate({
        label: 'Focus Previous Group',
        accelerator: 'CmdOrCtrl+Alt+Left',
        click: () => send(Channels.MENU_FOCUS_PREV_GROUP),
      }, { editor: true }),
      gate({
        label: 'Close Group',
        accelerator: 'CmdOrCtrl+Shift+W',
        click: () => send(Channels.MENU_CLOSE_GROUP),
      }, { editor: true }),
      { type: 'separator' },
      {
        label: 'Theme',
        submenu: THEME_MODES.map((m) => ({
          label: m.label,
          type: 'radio' as const,
          checked: currentThemeMode === m.value,
          click: () => send(Channels.MENU_SET_THEME, m.value),
        })),
      },
      {
        // ⌘⇧T keeps cycling for power users; the submenu above is for
        // direct selection (#1139).
        label: 'Cycle Theme',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => send(Channels.MENU_CYCLE_THEME),
      },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Actual Size' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      gate({
        label: 'Increase Editor Font Size',
        accelerator: 'CmdOrCtrl+Shift+=',
        click: () => send(Channels.MENU_FONT_INCREASE),
      }),
      gate({
        label: 'Decrease Editor Font Size',
        accelerator: 'CmdOrCtrl+Shift+-',
        click: () => send(Channels.MENU_FONT_DECREASE),
      }),
      gate({
        label: 'Reset Editor Font Size',
        click: () => send(Channels.MENU_FONT_RESET),
      }),
      { type: 'separator' },
      // macOS auto-injects its own "Enter/Exit Full Screen" item into the
      // View menu, so adding `togglefullscreen` here produced a duplicate.
      // Keep the explicit item only where the OS doesn't provide one.
      ...(isMac
        ? []
        : [{ role: 'togglefullscreen' as const }, { type: 'separator' as const }]),
      { role: 'toggleDevTools', label: 'Developer Tools' },
    ],
  };
}

/** Navigate menu — history back/forward, quick open, go to line. */
function buildNavigateMenu(gate: Gate): Electron.MenuItemConstructorOptions {
  return {
    label: 'Navigate',
    submenu: [
      gate({
        label: 'Back',
        accelerator: 'CmdOrCtrl+[',
        click: () => send(Channels.MENU_NAV_BACK),
      }),
      gate({
        label: 'Forward',
        accelerator: 'CmdOrCtrl+]',
        click: () => send(Channels.MENU_NAV_FORWARD),
      }),
      { type: 'separator' },
      gate({
        label: 'Quick Open',
        accelerator: 'CmdOrCtrl+P',
        click: () => send(Channels.MENU_QUICK_OPEN),
      }),
      gate({
        label: 'Go to Line',
        accelerator: 'CmdOrCtrl+G',
        click: () => send(Channels.MENU_GOTO_LINE),
      }, { note: true }),
    ],
  };
}

/** Refactor menu — single surface for every refactor-style command (issue #172). */
function buildRefactorMenu(gate: Gate): Electron.MenuItemConstructorOptions {
  return {
    label: 'Refactor',
    submenu: [
      gate({ label: 'Rename…', click: () => send(Channels.MENU_REFACTOR_RENAME) }, { note: true }),
      gate({ label: 'Move…', click: () => send(Channels.MENU_REFACTOR_MOVE) }, { note: true }),
      gate({ label: 'Copy…', click: () => send(Channels.MENU_REFACTOR_COPY) }, { note: true }),
      { type: 'separator' },
      gate({ label: 'Extract Selection to New Note', click: () => send(Channels.MENU_REFACTOR_EXTRACT) }, { note: true, selection: true }),
      gate({ label: 'Split Note Here', click: () => send(Channels.MENU_REFACTOR_SPLIT_HERE) }, { note: true }),
      gate({ label: 'Split by Heading…', click: () => send(Channels.MENU_REFACTOR_SPLIT_BY_HEADING) }, { note: true }),
      { type: 'separator' },
      gate({ label: 'Auto-tag', click: () => send(Channels.MENU_REFACTOR_AUTOTAG) }, { note: true }),
      gate({ label: 'Auto-link outbound…', click: () => send(Channels.MENU_REFACTOR_AUTOLINK) }, { note: true }),
      gate({ label: 'Auto-link inbound…', click: () => send(Channels.MENU_REFACTOR_AUTOLINK_INBOUND) }, { note: true }),
      gate({ label: 'Decompose Note…', click: () => send(Channels.MENU_REFACTOR_DECOMPOSE) }, { note: true }),
      { type: 'separator' },
      // Deterministic markdown normalisation (issue #152 epic). Nested
      // under Refactor so the title bar stays lean.
      gate({
        label: 'Format',
        toolTip: 'Format the active note, or every note in the left-sidebar selection (use ⌘-click / shift-click to multi-select, ⌘-A to select all).',
        click: () => send(Channels.MENU_FORMAT),
      }),
      { type: 'separator' },
      gate({
        label: 'Insert/Update Bibliography',
        toolTip: 'Render a References section listing every source the active note cites, in the project’s configured CSL style.',
        click: () => send(Channels.MENU_BIBLIOGRAPHY),
      }, { note: true }),
    ],
  };
}

/**
 * Tools for Thought — dynamic menus from the tool registry (skills are
 * compiled into it at startup). Order picked deliberately so the menu
 * reads top-down as a workflow: Refactor (the structural moves, above),
 * then Learning (read+understand), Research (write+propose), Analysis
 * (cross-cutting). Each category's items come straight from the registry —
 * since #627, Research is data-driven like the others (it used to be a
 * hardcoded block that listed only 4 of the 6 research tools).
 */
function buildToolMenus(gate: Gate): Electron.MenuItemConstructorOptions[] {
  return (['learning', 'research', 'analysis'] as const)
    // Source-scoped tools (#103) live in the Source viewer, not these menus.
    .filter((id) => getToolsByCategory(id).some((t) => !isSourceScoped(t)))
    .map((id) => {
      const tools = getToolsByCategory(id).filter((t) => !isSourceScoped(t));
      const mkItem = (tool: typeof tools[number]) => gate(
        {
          label: tool.name,
          toolTip: tool.description,
          click: () => send(Channels.TOOL_INVOKE, tool.id),
        },
        { note: toolRequiresNote(tool), selection: toolRequiresSelection(tool) },
      );
      // Thematic sub-grouping (#525): when any tool in the category declares
      // a `group`, render one nested submenu per group (ungrouped → General,
      // last). Otherwise stay flat — current behavior for ungrouped
      // categories (Learning, Research).
      const groups = groupToolsByGroup(tools);
      const toolItems: Electron.MenuItemConstructorOptions[] = hasNamedGroups(groups)
        ? groups.map((g) => ({
            label: g.label ?? 'General',
            submenu: g.tools.map(mkItem),
          }))
        : tools.map(mkItem);
      // "Ask a Question" opens a plain conversation — the same action the View
      // menu used to call "New Conversation". It lives atop Learning as the
      // simplest thinking tool. Needs no note (just a thoughtbase), so it gates
      // like the rest of the project-only items.
      const submenu = id === 'learning'
        ? [
            gate({ label: 'Ask a Question', click: () => send(Channels.MENU_NEW_CONVERSATION) }),
            { type: 'separator' as const },
            ...toolItems,
          ]
        : toolItems;
      return {
        label: CATEGORIES.find((c) => c.id === id)!.label,
        submenu,
      };
    });
}

/** Query menu — new query, stock queries (SPARQL/SQL), saved queries. */
function buildQueryMenu(gate: Gate): Electron.MenuItemConstructorOptions {
  return {
    label: 'Query',
    submenu: [
      gate({
        label: 'New Query',
        accelerator: 'CmdOrCtrl+Shift+Q',
        click: () => send(Channels.MENU_NEW_QUERY),
      }),
      { type: 'separator' },
      gate({
        label: 'Stock Queries',
        submenu: [
          {
            label: 'SPARQL',
            submenu: STOCK_QUERIES.filter((sq) => sq.language === 'sparql').map((sq) => ({
              label: sq.name,
              toolTip: sq.description,
              click: () => send(Channels.MENU_OPEN_STOCK_QUERY, { query: sq.query, language: sq.language }),
            })),
          },
          {
            label: 'SQL',
            submenu: STOCK_QUERIES.filter((sq) => sq.language === 'sql').map((sq) => ({
              label: sq.name,
              toolTip: sq.description,
              click: () => send(Channels.MENU_OPEN_STOCK_QUERY, { query: sq.query, language: sq.language }),
            })),
          },
        ],
      }),
      gate({
        label: 'Saved Queries',
        submenu: (() => {
          const win = BrowserWindow.getFocusedWindow();
          const rootPath = win ? getRootPath(win.id) : null;
          const saved = listSavedQueries(rootPath);
          if (saved.length === 0) {
            return [{ label: 'No Saved Queries', enabled: false }];
          }
          const project = saved.filter((q) => q.scope === 'project');
          const global = saved.filter((q) => q.scope === 'global');
          const mkEntry = (q: typeof saved[number]) => ({
            label: q.name,
            click: () => send(Channels.MENU_OPEN_STOCK_QUERY, { query: q.query, language: q.language }),
          });
          // #315 — render ungrouped queries first (in saved-queries.ts
          // sort order), then one nested submenu per named group.
          function renderScope(qs: typeof saved): Electron.MenuItemConstructorOptions[] {
            const ungrouped = qs.filter((q) => q.group === null);
            const groupNames = [...new Set(qs.filter((q) => q.group !== null).map((q) => q.group as string))]
              .sort((a, b) => a.localeCompare(b));
            const out: Electron.MenuItemConstructorOptions[] = ungrouped.map(mkEntry);
            for (const g of groupNames) {
              out.push({
                label: g,
                submenu: qs.filter((q) => q.group === g).map(mkEntry),
              });
            }
            return out;
          }
          const items: Electron.MenuItemConstructorOptions[] = [];
          // When both scopes are populated, nest under Thoughtbase ▸ /
          // Global ▸ submenus (mirrors the Stock Queries pattern).
          // When only one scope has entries, list flat — a one-branch
          // tree is noise.
          if (project.length > 0 && global.length > 0) {
            items.push({ label: 'Thoughtbase', submenu: renderScope(project) });
            items.push({ label: 'Global', submenu: renderScope(global) });
          } else {
            items.push(...renderScope(project.length > 0 ? project : global));
          }
          items.push({ type: 'separator' });
          items.push({
            label: 'Edit Saved Queries…',
            click: () => send(Channels.MENU_EDIT_SAVED_QUERIES),
          });
          return items;
        })(),
      }),
    ],
  };
}

/**
 * Export (#282, format-first redesign) — one item per *format family*
 * (Markdown / HTML / PDF / Static Site / …), grouped into sections by
 * category. The dialog picks scope (note/folder/tree/project/source) and,
 * where a family has more than one exporter at a scope, the variant. The
 * knowledge-graph dump is a separate hard-coded entry — the note-export
 * pipeline's ExportPlan shape doesn't fit an RDF dump.
 */
function buildExportMenu(gate: Gate): Electron.MenuItemConstructorOptions {
  return {
    label: 'Export',
    submenu: (() => {
      const groups = publish.listExportGroups();
      const items: Electron.MenuItemConstructorOptions[] = [];
      if (groups.length === 0) {
        items.push({ label: 'No exporters registered', enabled: false });
      } else {
        let prevCategory: string | null = null;
        for (const { group } of groups) {
          // Separator between format categories (document / publication /
          // citation) so the families read as comprehensible chunks.
          if (prevCategory !== null && group.category !== prevCategory) {
            items.push({ type: 'separator' });
          }
          prevCategory = group.category;
          items.push(gate({
            label: `${group.label}…`,
            click: () => send(Channels.MENU_EXPORT, group.id),
          }));
        }
      }
      items.push({ type: 'separator' });
      items.push(gate({
        label: 'Export Knowledge Graph…',
        click: async () => {
          const win = BrowserWindow.getFocusedWindow();
          if (!win) return;
          const rootPath = getRootPath(win.id);
          if (!rootPath) return;
          const result = await dialog.showSaveDialog(win, {
            title: 'Export Knowledge Graph',
            defaultPath: `${path.basename(rootPath)}.ttl`,
            filters: [{ name: 'Turtle', extensions: ['ttl'] }],
          });
          if (!result.canceled && result.filePath) {
            await graph.exportGraph(projectContext(rootPath), result.filePath);
          }
        },
      }));
      // Publish → git remote (#254): Export writes to a folder; Publish
      // pushes an exporter's output to a configured remote (GitHub Pages, …).
      items.push({ type: 'separator' });
      items.push(gate({
        label: 'Publish to Web…',
        click: () => send(Channels.MENU_PUBLISH),
      }));
      return items;
    })(),
  };
}

/** Window menu (macOS only) — standard window roles plus per-window switchers. */
function buildWindowMenu(isMac: boolean): Electron.MenuItemConstructorOptions[] {
  if (!isMac) return [];
  return [
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        { type: 'separator' as const },
        { role: 'front' as const },
        { type: 'separator' as const },
        ...BrowserWindow.getAllWindows()
          .filter(w => !w.isDestroyed())
          .map(w => {
            const rootPath = getRootPath(w.id);
            const label = rootPath ? path.basename(rootPath) : 'Untitled';
            const focused = w === BrowserWindow.getFocusedWindow();
            return {
              label,
              type: 'checkbox' as const,
              checked: focused,
              click: () => {
                if (w.isMinimized()) w.restore();
                w.focus();
              },
            };
          }),
      ],
    },
  ];
}

/** Help menu — shortcuts, documentation, issue reporting, About (non-mac). */
function buildHelpMenu(isMac: boolean): Electron.MenuItemConstructorOptions {
  return {
    role: 'help',
    label: 'Help',
    submenu: [
      {
        label: 'Keyboard Shortcuts…',
        accelerator: 'CmdOrCtrl+/',
        click: () => send(Channels.MENU_SHORTCUTS),
      },
      { type: 'separator' },
      {
        label: 'Documentation',
        click: () => { void shell.openExternal(DOCS_URL); },
      },
      {
        label: 'Report an Issue…',
        click: () => { void shell.openExternal(ISSUES_URL); },
      },
      // macOS keeps About in the app menu; Windows/Linux have no app menu,
      // so About lives at the foot of Help (the platform convention).
      ...(isMac
        ? []
        : [
            { type: 'separator' as const },
            { label: 'About Minerva', click: () => send(Channels.MENU_ABOUT) },
          ]),
    ],
  };
}

const DOCS_URL = 'https://github.com/dgriffith/ide-for-thought/tree/main/docs';
const ISSUES_URL = 'https://github.com/dgriffith/ide-for-thought/issues';

/** The most recently built menu template — the source for the shortcuts
 *  reference, so it reflects whatever menu state the user is actually in. */
let lastTemplate: Electron.MenuItemConstructorOptions[] | null = null;

export interface ShortcutItem { label: string; keys: string }
export interface ShortcutGroup { menu: string; items: ShortcutItem[] }

/**
 * The keyboard-shortcut reference for the Help menu (#804) — every accelerator
 * in the live menu, grouped by top-level menu, with keys formatted for the
 * current platform. Built from the last menu template so it tracks real state.
 */
export function getMenuShortcuts(): ShortcutGroup[] {
  const template = lastTemplate ?? rebuildMenu();
  const groups: ShortcutGroup[] = [];
  for (const [menu, entries] of collectAcceleratorsByMenu(template)) {
    const items = entries.map((e) => ({
      // Drop the top-level menu label; keep any submenu nesting.
      label: e.path.slice(1).join(' › ') || menu,
      keys: formatAccelerator(e.accelerator),
    }));
    groups.push({ menu, items });
  }
  return groups;
}

/** Render an Electron accelerator string for display on the current platform
 *  (⌘⇧S on macOS, Ctrl+Shift+S elsewhere). */
export function formatAccelerator(accelerator: string, platform: NodeJS.Platform = process.platform): string {
  const isMac = platform === 'darwin';
  const mac: Record<string, string> = {
    CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃',
    Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘', Plus: '+', Minus: '−',
  };
  const other: Record<string, string> = {
    CmdOrCtrl: 'Ctrl', Cmd: 'Ctrl', Command: 'Ctrl', Ctrl: 'Ctrl', Control: 'Ctrl',
    Alt: 'Alt', Option: 'Alt', Shift: 'Shift', Super: 'Win', Plus: '+', Minus: '−',
  };
  const map = isMac ? mac : other;
  const tokens = accelerator.split('+').map((t) => map[t] ?? t);
  return isMac ? tokens.join('') : tokens.join('+');
}

/**
 * Walk a menu template tree and collect every accelerator under each
 * top-level menu. Returns a Map keyed by top-level menu label. Pure;
 * no Electron runtime dependency. Used by the accelerator-collision
 * test (#398).
 */
export function collectAcceleratorsByMenu(
  template: Electron.MenuItemConstructorOptions[],
): Map<string, Array<{ accelerator: string; path: string[] }>> {
  const out = new Map<string, Array<{ accelerator: string; path: string[] }>>();
  for (const top of template) {
    const topLabel = String(top.label ?? top.role ?? '(unnamed)');
    const found: Array<{ accelerator: string; path: string[] }> = [];
    walkInto(top, [topLabel], found);
    if (found.length > 0) out.set(topLabel, found);
  }
  return out;
}

function walkInto(
  item: Electron.MenuItemConstructorOptions,
  path: string[],
  out: Array<{ accelerator: string; path: string[] }>,
): void {
  if (typeof item.accelerator === 'string') {
    out.push({ accelerator: item.accelerator, path });
  }
  const sub = item.submenu;
  if (Array.isArray(sub)) {
    for (const child of sub) {
      const childLabel = String(child.label ?? child.role ?? '(unnamed)');
      walkInto(child, [...path, childLabel], out);
    }
  }
}
