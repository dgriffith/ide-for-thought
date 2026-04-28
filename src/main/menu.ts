import { Menu, shell, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { getRecentProjects } from './recent-projects';
import { createWindow, openProjectInWindow, getRootPath } from './window-manager';
import * as graph from './graph/index';
import { projectContext } from './project-context-types';
import * as search from './search/index';
import * as tables from './sources/tables';
import { STOCK_QUERIES } from '../shared/stock-queries';
import { listSavedQueries } from './saved-queries';
import { restartKernel as restartPythonKernel } from './compute/python-kernel';
import * as publish from './publish';
import { getToolsByCategory, CATEGORIES } from '../shared/tools/registry';
import '../shared/tools/definitions/index';

function send(channel: string, ...args: unknown[]) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send(channel, ...args);
}

export function buildMenu(_win?: BrowserWindow): void {
  rebuildMenu();
}

export function rebuildMenu(): Electron.MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  const recentProjects = getRecentProjects();
  // Enablement gate: most editor / ingest / graph operations require an
  // open thoughtbase. Without one, clicking would either silently no-op
  // or error; greying the items out signals intent. We rebuild the menu
  // on every window focus change and on open/close, so `hasProject`
  // tracks the focused window's state.
  const focusedWin = BrowserWindow.getFocusedWindow();
  const hasProject = focusedWin ? getRootPath(focusedWin.id) !== null : false;
  const gate = <T extends Electron.MenuItemConstructorOptions>(item: T): T => (
    { ...item, enabled: hasProject && (item.enabled ?? true) }
  );

  const recentSubmenu: Electron.MenuItemConstructorOptions[] = recentProjects.length > 0
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
                win.webContents.send('project:opened', { rootPath: projectPath, name: path.basename(projectPath) });
              });
            }
          },
        })),
        { type: 'separator' as const },
        {
          label: 'Clear Recent Thoughtbases',
          click: () => send('menu:clearRecent'),
        },
      ]
    : [{ label: 'No Recent Thoughtbases', enabled: false }];

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: 'Minerva',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Preferences\u2026',
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
        ]
      : []),

    // File
    {
      label: 'File',
      submenu: [
        // Thoughtbase lifecycle first — the user's mental model is
        // "open my thoughtbase" before "do anything in it".
        {
          label: 'New Thoughtbase…',
          click: () => send('menu:newProject'),
        },
        {
          label: 'Open Thoughtbase…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:openProject'),
        },
        {
          label: 'Recent Thoughtbases',
          submenu: recentSubmenu,
        },
        gate({
          label: 'Close Thoughtbase',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => send('menu:closeProject'),
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
        }),
        { type: 'separator' },

        // Ingest / Import — bringing external things in.
        gate({
          label: 'Ingest URL…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => send(Channels.MENU_INGEST_URL),
        }),
        gate({
          label: 'Ingest Identifier…',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => send(Channels.MENU_INGEST_IDENTIFIER),
        }),
        gate({
          label: 'Ingest PDF…',
          click: () => send(Channels.MENU_INGEST_PDF),
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

        // Print / export single-note PDF (the Export menu is the canonical
        // path; these remain for "just print what's on screen" flows).
        gate({
          label: 'Print…',
          click: () => send('menu:print'),
        }),
        gate({
          label: 'Export as PDF…',
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
        }),
        { type: 'separator' },
        {
          label: 'Open In',
          submenu: [
            gate({
              label: 'Reveal in Finder',
              accelerator: 'CmdOrCtrl+Shift+R',
              click: () => send(Channels.SHELL_REVEAL_FILE),
            }),
            gate({
              label: 'Open in Default App',
              click: () => send('menu:openInDefault'),
            }),
            gate({
              label: 'Open in Terminal',
              click: () => send('menu:openInTerminal'),
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
            await Promise.all([
              graph.indexAllNotes(ctx),
              search.indexAllNotes(ctx),
              tables.registerAllCsvs(ctx),
            ]);
            if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
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
    },

    // Edit
    {
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
        }),
        gate({
          label: 'Find and Replace',
          accelerator: 'CmdOrCtrl+H',
          click: () => send(Channels.MENU_FIND_REPLACE),
        }),
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
          label: 'Toggle Case',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => send(Channels.MENU_TOGGLE_CASE),
        }),
        { type: 'separator' },
        gate({
          label: 'Extend Selection',
          accelerator: 'Alt+Up',
          click: () => send(Channels.MENU_EXTEND_SELECTION),
        }),
        gate({
          label: 'Shrink Selection',
          accelerator: 'Alt+Down',
          click: () => send(Channels.MENU_SHRINK_SELECTION),
        }),
        { type: 'separator' },
        gate({
          label: 'Join Lines',
          accelerator: 'Ctrl+Shift+J',
          click: () => send(Channels.MENU_JOIN_LINES),
        }),
        gate({
          label: 'Duplicate Line',
          accelerator: 'CmdOrCtrl+D',
          click: () => send(Channels.MENU_DUPLICATE_LINE),
        }),
        gate({
          label: 'Sort Lines',
          click: () => send(Channels.MENU_SORT_LINES),
        }),
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Preferences\u2026',
                accelerator: 'Ctrl+,',
                click: () => send(Channels.MENU_OPEN_SETTINGS),
              },
            ]
          : []),
      ],
    },

    // View
    {
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
          label: 'Cycle Preview Mode',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send(Channels.MENU_TOGGLE_PREVIEW),
        }),
        { type: 'separator' },
        {
          label: 'Cycle Theme (Dark/Light/Contrast/System)',
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
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Developer Tools' },
      ],
    },

    // Navigate
    {
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
        }),
      ],
    },

    // Refactor — single surface for every refactor-style command (issue #172).
    {
      label: 'Refactor',
      submenu: [
        gate({ label: 'Rename\u2026', click: () => send(Channels.MENU_REFACTOR_RENAME) }),
        gate({ label: 'Move\u2026', click: () => send(Channels.MENU_REFACTOR_MOVE) }),
        gate({ label: 'Copy\u2026', click: () => send(Channels.MENU_REFACTOR_COPY) }),
        { type: 'separator' },
        gate({ label: 'Extract Selection to New Note', click: () => send(Channels.MENU_REFACTOR_EXTRACT) }),
        gate({ label: 'Split Note Here', click: () => send(Channels.MENU_REFACTOR_SPLIT_HERE) }),
        gate({ label: 'Split by Heading\u2026', click: () => send(Channels.MENU_REFACTOR_SPLIT_BY_HEADING) }),
        { type: 'separator' },
        gate({ label: 'Auto-tag', click: () => send(Channels.MENU_REFACTOR_AUTOTAG) }),
        gate({ label: 'Auto-link outbound\u2026', click: () => send(Channels.MENU_REFACTOR_AUTOLINK) }),
        gate({ label: 'Auto-link inbound\u2026', click: () => send(Channels.MENU_REFACTOR_AUTOLINK_INBOUND) }),
        gate({ label: 'Decompose Note\u2026', click: () => send(Channels.MENU_REFACTOR_DECOMPOSE) }),
        { type: 'separator' },
        // Deterministic markdown normalisation (issue #152 epic). Nested
        // under Refactor so the title bar stays lean.
        gate({
          label: 'Format',
          toolTip: 'Format the active note, or every note in the left-sidebar selection (use \u2318-click / shift-click to multi-select, \u2318-A to select all).',
          click: () => send(Channels.MENU_FORMAT),
        }),
      ],
    },

    // Tools for Thought — dynamic menus from tool registry. Order picked
    // deliberately so the menu reads top-down as a workflow: Refactor (the
    // structural moves), then Learning (read+understand), then Research
    // (write+propose), then Analysis (cross-cutting).
    ...['learning' as const]
      .filter((id) => getToolsByCategory(id).length > 0)
      .map((id) => ({
        label: CATEGORIES.find((c) => c.id === id)!.label,
        submenu: getToolsByCategory(id).map(tool => gate({
          label: tool.name,
          toolTip: tool.description,
          click: () => send(Channels.TOOL_INVOKE, tool.id),
        })),
      })),

    // Research — LLM-powered tools that produce approval-gated proposals (#408 et al).
    {
      label: 'Research',
      submenu: [
        gate({
          label: 'Decompose into Claims',
          toolTip: 'Pull every distinct assertion in the selection (or the whole note) out as a typed thought:Claim. Files a Proposal.',
          click: () => send(Channels.MENU_RESEARCH_DECOMPOSE_CLAIMS),
        }),
        { type: 'separator' },
        gate({
          label: 'Find Supporting Arguments',
          toolTip: 'For the Claim under the cursor, generate the strongest cases in favour of it (web-grounded). Files a Proposal of Grounds nodes.',
          click: () => send(Channels.MENU_RESEARCH_FIND_SUPPORTING),
        }),
        gate({
          label: 'Find Opposing Arguments',
          toolTip: 'For the Claim under the cursor, generate the strongest cases against it (web-grounded). Files a Proposal of Grounds nodes.',
          click: () => send(Channels.MENU_RESEARCH_FIND_OPPOSING),
        }),
      ],
    },

    // Remaining Tools-for-Thought categories (analysis + any ThinkingTool
    // category that isn't already surfaced above).
    ...CATEGORIES
      .filter(cat => cat.id !== 'learning' && cat.id !== 'research' && getToolsByCategory(cat.id).length > 0)
      .map(cat => ({
        label: cat.label,
        submenu: getToolsByCategory(cat.id).map(tool => gate({
          label: tool.name,
          toolTip: tool.description,
          click: () => send(Channels.TOOL_INVOKE, tool.id),
        })),
      })),

    // Query
    {
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
    },

    // Export (#282) — dynamically populated from the publish registry.
    // Empty submenu is a placeholder that surfaces a disabled item when
    // no exporter is registered; in practice #246's markdown passthrough
    // always registers at app-ready. The knowledge-graph dump is a
    // separate hard-coded entry — the note-export pipeline's ExportPlan
    // shape doesn't fit an RDF dump, so it stays outside the registry.
    {
      label: 'Export',
      submenu: (() => {
        const exporters = publish.listExporters();
        const items: Electron.MenuItemConstructorOptions[] = exporters.length === 0
          ? [{ label: 'No exporters registered', enabled: false }]
          : exporters.map((e) => gate({
              label: `Export as ${e.label}…`,
              click: () => send(Channels.MENU_EXPORT, e.id),
            }));
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
        return items;
      })(),
    },

    // Window (macOS)
    ...(isMac
      ? [
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
        ]
      : []),

    // Help
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          enabled: false,
          click: () => {},
        },
        { type: 'separator' },
        {
          label: 'Report Issue',
          click: () => {
            void shell.openExternal('https://github.com/dgriffith/minerva/issues');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return template;
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
