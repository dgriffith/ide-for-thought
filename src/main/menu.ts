import { Menu, shell, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import { formatAccelerator, collectAcceleratorsByMenu } from './menu/accelerators';
import { Channels } from '../shared/channels';
import { broadcast } from './ipc/broadcast';
import type { EventMap } from '../shared/ipc-contract';
import { THEME_MODES, isThemeMode, type ThemeMode } from '../shared/theme';
import { pluginThemes } from './plugins/themes';
import { isCorePluginActive } from './core-plugins-active';
import { getRecentProjects } from './recent-projects';
import { resolveDisplayName } from './project-config';
import { createWindow, openProjectInWindow, getRootPath, broadcastBackfillProgress, broadcastMaintenanceProgress } from './window-manager';
// The long-running project operations (#2233). The menu invokes them; so does
// `ipc/register-maintenance.ts`. Executing them inline here is what made this
// file a second, unreviewed command surface.
import {
  rebuildAllIndexes,
  rebuildSemanticIndex,
  interruptCell,
  restartKernel,
  exportKnowledgeGraph,
} from './maintenance-commands';
import { STOCK_QUERIES } from '../shared/stock-queries';
import { commandDef, type MenuCommandId } from '../shared/commands';
import { installMinervaCommand } from './cli-install';
import { listSavedQueries } from './saved-queries';
import * as publish from './publish';
import { getToolsByCategory, CATEGORIES } from '../shared/tools/registry';
import { groupToolsByGroup, flattenGroupedMenu } from '../shared/tools/grouping';
import { isSourceScoped, toolRequiresNote, toolRequiresSelection } from '../shared/tools/types';
import type { MenuEditorState } from '../shared/types';
import {
  checkForUpdatesNow,
  isUpdateDownloaded,
  quitAndInstallUpdate,
  getUpdateState,
} from './auto-update';

function send<K extends keyof EventMap>(channel: K, ...args: Parameters<EventMap[K]>) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) broadcast(win, channel, ...args);
}

// Current theme, mirrored from the renderer (which owns it in localStorage) so
// the View → Theme submenu can show the active radio (#1139). Defaults to the
// renderer's own default; corrected the moment the renderer reports on mount.
let currentThemeMode: ThemeMode = 'dark';

/** Renderer → main: record the active theme and refresh the menu's radio. */
export function setMenuThemeMode(mode: ThemeMode): void {
  if (!isThemeMode(mode) || mode === currentThemeMode) return;
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

/**
 * A command from the registry (`shared/commands.ts`, #2625), as a menu item:
 * its label, accelerator, tooltip and gate come from the declaration, and a
 * click sends `menu:command` with its id for the renderer to run. `over`
 * adjusts the item for one placement (Preferences' platform accelerator).
 * A command gated on a thoughtbase needs the `gate` of the menu it's in.
 */
function command(
  id: MenuCommandId,
  gate?: Gate,
  over: Partial<Electron.MenuItemConstructorOptions> = {},
): Electron.MenuItemConstructorOptions {
  const def = commandDef(id);
  const menu = def.menu ?? {};
  const item: Electron.MenuItemConstructorOptions = {
    label: menu.label ?? def.title,
    ...(def.key ? { accelerator: def.key } : {}),
    ...(menu.toolTip ? { toolTip: menu.toolTip } : {}),
    click: () => send(Channels.MENU_COMMAND, id),
    ...over,
  };
  if (menu.gate === false) return item;
  if (!gate) throw new Error(`menu command ${id} needs a thoughtbase gate`);
  return gate(item, menu.gate);
}

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
        command('app.about'),
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
        command('app.settings', undefined, { accelerator: 'Cmd+,' }),
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
              send(Channels.MENU_OPEN_RECENT_PROJECT, projectPath);
            } else {
              const win = createWindow();
              win.webContents.once('did-finish-load', async () => {
                await openProjectInWindow(win, projectPath);
                broadcast(win, Channels.PROJECT_OPENED, { rootPath: projectPath, name: resolveDisplayName(projectPath) });
              });
            }
          },
        })),
        { type: 'separator' as const },
        command('file.clearRecent'),
      ]
    : [{ label: 'No Recent Thoughtbases', enabled: false }];
}

/**
 * Print the focused window's rendered view to a user-chosen PDF (the File →
 * Print to PDF… action). No-op if no window is focused or the save dialog is
 * cancelled. Extracted from the menu entry's inline click for readability (#1627).
 */
async function printFocusedWindowToPdf(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  const result = await dialog.showSaveDialog(win, {
    title: 'Export as PDF',
    defaultPath: 'note.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return;
  const data = await win.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
  });
  const fs = await import('node:fs/promises');
  await fs.writeFile(result.filePath, data);
}

/** File menu — thoughtbase lifecycle, note actions, ingest/import, print, indexes. */
function buildFileMenu(gate: Gate, isMac: boolean): Electron.MenuItemConstructorOptions {
  return {
    label: 'File',
    submenu: [
      // Thoughtbase lifecycle first — the user's mental model is
      // "open my thoughtbase" before "do anything in it".
      command('file.newProject', gate),
      command('file.openProject', gate),
      {
        label: 'Recent Thoughtbases',
        submenu: buildRecentSubmenu(),
      },
      command('file.closeProject', gate),
      command('file.editThoughtbaseGuide', gate),
      command('file.thoughtbaseProperties', gate),
      { type: 'separator' },

      // Everyday note actions.
      command('file.newNote', gate),
      command('file.newAudioRecording', gate),
      command('file.save', gate),
      command('file.saveAsTemplate', gate),
      command('objects.saveAsObjectType', gate),
      { type: 'separator' },

      // Ingest / Import — bringing external things in.
      command('research.ingestUrl', gate),
      command('research.ingestIdentifier', gate),
      command('research.ingestFile', gate),
      command('research.ingestBulk', gate),
      command('research.importBibtex', gate),
      command('research.importZoteroRdf', gate),
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
      command('file.print', gate),
      gate({
        label: 'Print to PDF…',
        click: printFocusedWindowToPdf,
      }, { note: true }),
      { type: 'separator' },
      {
        label: 'Open In',
        submenu: [
          command('file.revealFile', gate),
          command('file.openInDefault', gate),
          command('file.openInTerminal', gate),
        ],
      },
      { type: 'separator' },
      gate({
        label: 'Rebuild All Indexes',
        click: () => withFocusedProject(async (win, rootPath) => {
          const rebuilt = await rebuildAllIndexes(
            rootPath,
            (p) => broadcastMaintenanceProgress(rootPath, p),
          );
          // Only tell the panels to re-read when the rebuild actually finished;
          // refreshing off a failed run would show a half-built table list.
          if (rebuilt && !win.isDestroyed()) broadcast(win, Channels.TABLES_CHANGED);
        }),
      }),
      gate({
        label: 'Rebuild Semantic Index',
        click: () => withFocusedProject(async (_win, rootPath) => {
          await rebuildSemanticIndex(
            rootPath,
            (p) => broadcastMaintenanceProgress(rootPath, p),
            (p) => broadcastBackfillProgress(rootPath, p),
          );
        }),
      }),
      // Python's two items exist only while the built-in Python plugin is on
      // (#2822); a toggle rebuilds the menu (`plugins-apply.ts`).
      ...(isCorePluginActive('python') ? [gate({
        label: 'Interrupt Cell',
        // No default accelerator (#372). Cmd+. (the Jupyter
        // standard) collides with macOS Zoom In on this app's View
        // menu; the safest defaults for "Interrupt" are taken
        // elsewhere too. Users can wire their own via the
        // keybindings settings.
        click: () => withFocusedProject(async (_win, rootPath) => {
          await interruptCell(rootPath, (p) => broadcastMaintenanceProgress(rootPath, p));
        }),
      }),
      gate({
        label: 'Restart Python Kernel',
        click: () => withFocusedProject(async (_win, rootPath) => {
          await restartKernel(rootPath, (p) => broadcastMaintenanceProgress(rootPath, p));
        }),
      })] : []),
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };
}

/**
 * Run `fn` against the focused window's project, or do nothing when there is no
 * focused window / no project open. Every maintenance item repeated this
 * four-line preamble; hoisting it keeps the handlers about the operation.
 */
async function withFocusedProject(
  fn: (win: BrowserWindow, rootPath: string) => Promise<void>,
): Promise<void> {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  const rootPath = getRootPath(win.id);
  if (!rootPath) return;
  await fn(win, rootPath);
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
      command('edit.find', gate),
      command('edit.findReplace', gate),
      command('edit.findInNotes', gate),
      command('edit.replaceInNotes', gate),
      { type: 'separator' },
      command('edit.insertTemplate', gate),
      { type: 'separator' },
      command('edit.sortLines', gate),
      ...(!isMac
        ? [
            { type: 'separator' as const },
            command('app.settings', gate, { accelerator: 'Ctrl+,' }),
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
      // First in View because it is the app's launcher, and because until
      // #2256 it had no menu item at all — which made it invisible to Help ->
      // Keyboard Shortcuts, since that dialog DERIVES its contents from this
      // template (`collectAcceleratorsByMenu`) rather than restating them.
      // A binding with no menu item is a binding the shortcuts help cannot
      // know about, so the palette was discoverable only from the docs site —
      // which the Help menu itself could not correctly reach either (#2254).
      // Adding the item is the whole fix: the dialog picks it up for free.
      command('view.commandPalette', gate),
      { type: 'separator' as const },
      command('view.toggleSidebar', gate),
      command('view.toggleRightSidebar', gate),
      command('view.toggleConversations', gate),
      // "New Conversation" moved to Learning ▸ "Ask a Question" (buildToolMenus).
      command('view.togglePreview', gate),
      { type: 'separator' },
      // Editor split — pane focus & layout commands (#814).
      command('view.splitRight', gate),
      command('view.splitDown', gate),
      command('view.focusNextGroup', gate),
      command('view.focusPrevGroup', gate),
      command('view.closeGroup', gate),
      { type: 'separator' },
      {
        label: 'Theme',
        // The built-ins, then each enabled plugin's themes (#2787), which
        // come and go with the plugin: changePlugins rebuilds the menu.
        submenu: [
          ...THEME_MODES.map(({ value, label }) => ({ value: value, label })),
          ...pluginThemes().themes.map((t) => ({ value: t.mode, label: `${t.label} (${t.plugin.name})` })),
        ].map((m) => ({
          label: m.label,
          type: 'radio' as const,
          checked: currentThemeMode === m.value,
          click: () => send(Channels.MENU_SET_THEME, m.value),
        })),
      },
      command('view.cycleTheme', gate),
      { type: 'separator' },
      { role: 'resetZoom', label: 'Actual Size' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      command('view.fontIncrease', gate),
      command('view.fontDecrease', gate),
      command('view.fontReset', gate),
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
      command('nav.back', gate),
      command('nav.forward', gate),
      { type: 'separator' },
      command('nav.quickOpen', gate),
      command('edit.gotoLine', gate),
    ],
  };
}

/** Refactor menu — single surface for every refactor-style command (issue #172). */
function buildRefactorMenu(gate: Gate): Electron.MenuItemConstructorOptions {
  return {
    label: 'Refactor',
    submenu: [
      command('refactor.rename', gate),
      command('refactor.move', gate),
      command('refactor.copy', gate),
      { type: 'separator' },
      command('refactor.extract', gate),
      command('refactor.splitHere', gate),
      command('refactor.splitByHeading', gate),
      { type: 'separator' },
      command('refactor.autoTag', gate),
      command('refactor.autoLink', gate),
      command('refactor.autoLinkInbound', gate),
      command('refactor.decompose', gate),
      { type: 'separator' },
      // Deterministic markdown normalisation (issue #152 epic). Nested
      // under Refactor so the title bar stays lean.
      command('refactor.format', gate),
      { type: 'separator' },
      command('research.bibliography', gate),
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
      // Thematic sub-grouping (#525): a tool's optional `group` renders as a
      // nested submenu. Ungrouped tools stay inline (like the Source tools
      // menu) instead of being collected into a "General" submenu — so adding
      // a group to one skill nests just that skill rather than restructuring
      // the whole category. With no named groups, `groupToolsByGroup` returns a
      // single ungrouped bucket, so the menu renders flat exactly as before.
      const groups = groupToolsByGroup(tools);
      const toolItems: Electron.MenuItemConstructorOptions[] = flattenGroupedMenu<
        typeof tools[number],
        Electron.MenuItemConstructorOptions
      >(
        groups,
        mkItem,
        (label, ts) => ({ label, submenu: ts.map(mkItem) }),
      );
      // "Ask a Question" opens a plain conversation — the same action the View
      // menu used to call "New Conversation". It lives atop Learning as the
      // simplest thinking tool. Needs no note (just a thoughtbase), so it gates
      // like the rest of the project-only items.
      const submenu = id === 'learning'
        ? [
            command('learning.askQuestion', gate),
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
      command('query.new', gate),
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
          // Thoughtbase, Global, then one section per plugin (#2633), by name.
          const sections: Array<{ label: string; queries: typeof saved }> = [
            { label: 'Thoughtbase', queries: saved.filter((q) => q.scope === 'project') },
            { label: 'Global', queries: saved.filter((q) => q.scope === 'global') },
          ];
          const byPlugin = new Map<string, typeof saved>();
          for (const q of saved) {
            if (q.scope !== 'plugin' || !q.plugin) continue;
            byPlugin.set(q.plugin.name, [...(byPlugin.get(q.plugin.name) ?? []), q]);
          }
          for (const [label, queries] of [...byPlugin].sort(([a], [b]) => a.localeCompare(b))) sections.push({ label, queries });
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
          // When more than one section is populated, nest each under its own
          // submenu (mirrors the Stock Queries pattern). When only one has
          // entries, list flat — a one-branch tree is noise.
          const populated = sections.filter((s) => s.queries.length > 0);
          if (populated.length > 1) {
            for (const s of populated) items.push({ label: s.label, submenu: renderScope(s.queries) });
          } else {
            items.push(...renderScope(populated[0]?.queries ?? []));
          }
          items.push({ type: 'separator' });
          items.push(command('query.editSaved', gate));
          return items;
        })(),
      }),
      { type: 'separator' },
      // Knowledge-graph RDF dump lives with Query, not Export: it's the
      // whole graph you query, serialized — not a note-export ExportPlan.
      gate({
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
            await exportKnowledgeGraph(rootPath, result.filePath);
          }
        },
      }),
    ],
  };
}

/**
 * Export (#282, format-first redesign) — one item per *format family*
 * (Markdown / HTML / PDF / Static Site / …), grouped into sections by
 * category. The dialog picks scope (note/folder/tree/project/source) and,
 * where a family has more than one exporter at a scope, the variant.
 * (The knowledge-graph RDF dump lives in the Query menu, not here — its
 * shape doesn't fit the note-export ExportPlan pipeline.)
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
      // Publish → git remote (#254): Export writes to a folder; Publish
      // pushes an exporter's output to a configured remote (GitHub Pages, …).
      items.push({ type: 'separator' });
      items.push(command('export.publish', gate));
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
            const label = rootPath ? resolveDisplayName(rootPath) : 'Untitled';
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
      // A guided, hands-on thoughtbase that teaches Minerva by being Minerva
      // (#1544, epic #1518). Reachable any time, not just at first run.
      command('app.installTutorial'),
      { type: 'separator' },
      command('app.shortcuts'),
      { type: 'separator' },
      {
        label: 'Documentation',
        click: () => { void shell.openExternal(DOCS_URL); },
      },
      {
        label: 'Report an Issue…',
        click: () => { void shell.openExternal(ISSUES_URL); },
      },
      // Expose the headless `minerva` CLI on PATH (#1437). macOS/Linux only —
      // the launcher is an sh shim; Windows is a follow-up.
      ...(isMac
        ? [
            { type: 'separator' as const },
            {
              label: 'Install ‘minerva’ Command in PATH…',
              click: () => { void installMinervaCommand(); },
            },
          ]
        : []),
      // macOS keeps About in the app menu; Windows/Linux have no app menu,
      // so About lives at the foot of Help (the platform convention).
      ...(isMac
        ? []
        : [
            { type: 'separator' as const },
            command('app.about'),
          ]),
    ],
  };
}

/**
 * Help -> Documentation. The USER MANUAL, not the repo's developer-docs folder
 * (#2254).
 *
 * This pointed at `github.com/dgriffith/ide-for-thought/tree/main/docs` — a raw
 * file listing of `releasing.md`, `packaging.md`, `config-roots.md` and friends.
 * The actual manual is 118 pages and 61,245 words, built from `website/docs/`,
 * CI-gated with zero orphans, and the app could not reach it. Coverage without
 * a path to it is zero.
 *
 * The URL is also recorded in `docs/releasing.md`, and
 * `tests/architecture/docs-url.test.ts` asserts the two agree — because the
 * reason this was wrong in the first place is that the site's canonical URL was
 * written down nowhere, so there was nothing for anyone to keep it in step with.
 */
const DOCS_URL = 'https://dgriffith.github.io/minerva/docs/';
// The template chooser, not the issue list: Help → Report an Issue is someone
// wanting to report, and the chooser is where the bug / feature forms live
// (.github/ISSUE_TEMPLATE). A blank issue is still one click from there.
const ISSUES_URL = 'https://github.com/dgriffith/ide-for-thought/issues/new/choose';

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
