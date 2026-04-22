import { Menu, shell, app, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { getRecentProjects } from './recent-projects';
import { createWindow, openProjectInWindow, getRootPath } from './window-manager';
import * as graph from './graph/index';
import * as search from './search/index';
import * as tables from './sources/tables';
import { STOCK_QUERIES } from '../shared/stock-queries';
import { listSavedQueries, deleteQuery } from './saved-queries';
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

export function rebuildMenu(): void {
  const isMac = process.platform === 'darwin';
  const recentProjects = getRecentProjects();

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
        {
          label: 'Close Thoughtbase',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => send('menu:closeProject'),
        },
        { type: 'separator' },

        // Everyday note actions.
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => send(Channels.MENU_NEW_NOTE),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send(Channels.MENU_SAVE),
        },
        { type: 'separator' },

        // Ingest / Import — bringing external things in.
        {
          label: 'Ingest URL…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => send(Channels.MENU_INGEST_URL),
        },
        {
          label: 'Ingest Identifier…',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => send(Channels.MENU_INGEST_IDENTIFIER),
        },
        {
          label: 'Ingest PDF…',
          click: () => send(Channels.MENU_INGEST_PDF),
        },
        {
          label: 'Import BibTeX…',
          click: () => send(Channels.MENU_IMPORT_BIBTEX),
        },
        {
          label: 'Import Zotero RDF…',
          click: () => send(Channels.MENU_IMPORT_ZOTERO_RDF),
        },
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
        {
          label: 'Print…',
          click: () => send('menu:print'),
        },
        {
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
        },
        { type: 'separator' },
        {
          label: 'Open In',
          submenu: [
            {
              label: 'Reveal in Finder',
              accelerator: 'CmdOrCtrl+Shift+R',
              click: () => send(Channels.SHELL_REVEAL_FILE),
            },
            {
              label: 'Open in Default App',
              click: () => send('menu:openInDefault'),
            },
            {
              label: 'Open in Terminal',
              click: () => send('menu:openInTerminal'),
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Rebuild All Indexes',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow();
            if (!win) return;
            const rootPath = getRootPath(win.id);
            if (!rootPath) return;
            await Promise.all([
              graph.indexAllNotes(rootPath),
              search.indexAllNotes(rootPath),
              tables.registerAllCsvs(rootPath),
            ]);
            if (!win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
          },
        },
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
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => send(Channels.MENU_FIND),
        },
        {
          label: 'Find and Replace',
          accelerator: 'CmdOrCtrl+H',
          click: () => send(Channels.MENU_FIND_REPLACE),
        },
        { type: 'separator' },
        {
          label: 'Toggle Case',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => send(Channels.MENU_TOGGLE_CASE),
        },
        { type: 'separator' },
        {
          label: 'Extend Selection',
          accelerator: 'Alt+Up',
          click: () => send(Channels.MENU_EXTEND_SELECTION),
        },
        {
          label: 'Shrink Selection',
          accelerator: 'Alt+Down',
          click: () => send(Channels.MENU_SHRINK_SELECTION),
        },
        { type: 'separator' },
        {
          label: 'Join Lines',
          accelerator: 'Ctrl+Shift+J',
          click: () => send(Channels.MENU_JOIN_LINES),
        },
        {
          label: 'Duplicate Line',
          accelerator: 'CmdOrCtrl+D',
          click: () => send(Channels.MENU_DUPLICATE_LINE),
        },
        {
          label: 'Sort Lines',
          click: () => send(Channels.MENU_SORT_LINES),
        },
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
        {
          label: 'Toggle Left Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => send(Channels.MENU_TOGGLE_SIDEBAR),
        },
        {
          label: 'Toggle Right Sidebar',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => send(Channels.MENU_TOGGLE_RIGHT_SIDEBAR),
        },
        {
          label: 'Cycle Preview Mode',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send(Channels.MENU_TOGGLE_PREVIEW),
        },
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
        {
          label: 'Increase Editor Font Size',
          accelerator: 'CmdOrCtrl+Shift+=',
          click: () => send(Channels.MENU_FONT_INCREASE),
        },
        {
          label: 'Decrease Editor Font Size',
          accelerator: 'CmdOrCtrl+Shift+-',
          click: () => send(Channels.MENU_FONT_DECREASE),
        },
        {
          label: 'Reset Editor Font Size',
          click: () => send(Channels.MENU_FONT_RESET),
        },
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
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => send(Channels.MENU_NAV_BACK),
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => send(Channels.MENU_NAV_FORWARD),
        },
        { type: 'separator' },
        {
          label: 'Quick Open',
          accelerator: 'CmdOrCtrl+P',
          click: () => send(Channels.MENU_QUICK_OPEN),
        },
        {
          label: 'Go to Line',
          accelerator: 'CmdOrCtrl+G',
          click: () => send(Channels.MENU_GOTO_LINE),
        },
      ],
    },

    // Refactor — single surface for every refactor-style command (issue #172).
    {
      label: 'Refactor',
      submenu: [
        { label: 'Rename\u2026', click: () => send(Channels.MENU_REFACTOR_RENAME) },
        { label: 'Move\u2026', click: () => send(Channels.MENU_REFACTOR_MOVE) },
        { label: 'Copy\u2026', click: () => send(Channels.MENU_REFACTOR_COPY) },
        { type: 'separator' },
        { label: 'Extract Selection to New Note', click: () => send(Channels.MENU_REFACTOR_EXTRACT) },
        { label: 'Split Note Here', click: () => send(Channels.MENU_REFACTOR_SPLIT_HERE) },
        { label: 'Split by Heading\u2026', click: () => send(Channels.MENU_REFACTOR_SPLIT_BY_HEADING) },
        { type: 'separator' },
        { label: 'Auto-tag', click: () => send(Channels.MENU_REFACTOR_AUTOTAG) },
        { label: 'Auto-link outbound\u2026', click: () => send(Channels.MENU_REFACTOR_AUTOLINK) },
        { label: 'Auto-link inbound\u2026', click: () => send(Channels.MENU_REFACTOR_AUTOLINK_INBOUND) },
        { label: 'Decompose Note\u2026', click: () => send(Channels.MENU_REFACTOR_DECOMPOSE) },
        { type: 'separator' },
        // Deterministic markdown normalisation (issue #152 epic). Nested
        // under Refactor so the title bar stays lean.
        { label: 'Format Current Note', click: () => send(Channels.MENU_FORMAT_CURRENT_NOTE) },
        { label: 'Format Folder\u2026', click: () => send(Channels.MENU_FORMAT_FOLDER) },
        { label: 'Format All Notes', click: () => send(Channels.MENU_FORMAT_ALL) },
      ],
    },

    // Tools for Thought — dynamic menus from tool registry
    ...CATEGORIES
      .filter(cat => getToolsByCategory(cat.id).length > 0)
      .map(cat => ({
        label: cat.label,
        submenu: getToolsByCategory(cat.id).map(tool => ({
          label: tool.name,
          sublabel: tool.description,
          click: () => send(Channels.TOOL_INVOKE, tool.id),
        })),
      } as Electron.MenuItemConstructorOptions)),

    // Query
    {
      label: 'Query',
      submenu: [
        {
          label: 'New Query',
          accelerator: 'CmdOrCtrl+Shift+Q',
          click: () => send(Channels.MENU_NEW_QUERY),
        },
        { type: 'separator' },
        {
          label: 'Stock Queries',
          submenu: [
            {
              label: 'SPARQL',
              submenu: STOCK_QUERIES.filter((sq) => sq.language === 'sparql').map((sq) => ({
                label: sq.name,
                sublabel: sq.description,
                click: () => send(Channels.MENU_OPEN_STOCK_QUERY, { query: sq.query, language: sq.language }),
              })),
            },
            {
              label: 'SQL',
              submenu: STOCK_QUERIES.filter((sq) => sq.language === 'sql').map((sq) => ({
                label: sq.name,
                sublabel: sq.description,
                click: () => send(Channels.MENU_OPEN_STOCK_QUERY, { query: sq.query, language: sq.language }),
              })),
            },
          ],
        },
        {
          label: 'Saved Queries',
          submenu: (() => {
            const win = BrowserWindow.getFocusedWindow();
            const rootPath = win ? getRootPath(win.id) : null;
            const saved = listSavedQueries(rootPath);
            if (saved.length === 0) {
              return [{ label: 'No Saved Queries', enabled: false }];
            }
            const items: Electron.MenuItemConstructorOptions[] = [];
            const project = saved.filter((q) => q.scope === 'project');
            const global = saved.filter((q) => q.scope === 'global');
            if (project.length > 0) {
              items.push({ label: 'Thoughtbase', enabled: false });
              for (const q of project) {
                items.push({
                  label: q.name,
                  click: () => send(Channels.MENU_OPEN_STOCK_QUERY, { query: q.query, language: 'sparql' }),
                });
              }
            }
            if (global.length > 0) {
              if (items.length > 0) items.push({ type: 'separator' });
              items.push({ label: 'Global', enabled: false });
              for (const q of global) {
                items.push({
                  label: q.name,
                  click: () => send(Channels.MENU_OPEN_STOCK_QUERY, { query: q.query, language: 'sparql' }),
                });
              }
            }
            return items;
          })(),
        },
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
          : exporters.map((e) => ({
              label: `Export as ${e.label}…`,
              click: () => send(Channels.MENU_EXPORT, e.id),
            }));
        items.push({ type: 'separator' });
        items.push({
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
              await graph.exportGraph(result.filePath);
            }
          },
        });
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
            shell.openExternal('https://github.com/dgriffith/minerva/issues');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
