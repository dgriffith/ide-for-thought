import { Menu, shell, app, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { getRecentProjects } from './recent-projects';
import { createWindow, openProjectInWindow, getRootPath } from './window-manager';
import * as graph from './graph/index';
import { STOCK_QUERIES } from '../shared/stock-queries';

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
          label: 'Clear Recent Projects',
          click: () => send('menu:clearRecent'),
        },
      ]
    : [{ label: 'No Recent Projects', enabled: false }];

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: 'Minerva',
            submenu: [
              { role: 'about' as const },
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
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => send(Channels.MENU_NEW_NOTE),
        },
        { type: 'separator' },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow(),
        },
        {
          label: 'New Project',
          click: () => send('menu:newProject'),
        },
        {
          label: 'Open Project',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:openProject'),
        },
        {
          label: 'Recent Projects',
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        {
          label: 'Close Project',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => send('menu:closeProject'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send(Channels.MENU_SAVE),
        },
        { type: 'separator' },
        {
          label: 'Reveal in Finder',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => send(Channels.SHELL_REVEAL_FILE),
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
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => send(Channels.MENU_TOGGLE_SIDEBAR),
        },
        {
          label: 'Cycle Preview Mode',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send(Channels.MENU_TOGGLE_PREVIEW),
        },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
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

    // Git
    {
      label: 'Git',
      submenu: [
        {
          label: 'Commit All...',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => send('git:commitPrompt'),
        },
        { type: 'separator' },
        {
          label: 'Push',
          enabled: false,
          click: () => {},
        },
        {
          label: 'Pull',
          enabled: false,
          click: () => {},
        },
      ],
    },

    // Graph
    {
      label: 'Graph',
      submenu: [
        {
          label: 'New Query',
          accelerator: 'CmdOrCtrl+Shift+Q',
          click: () => send(Channels.MENU_NEW_QUERY),
        },
        { type: 'separator' },
        {
          label: 'Stock Queries',
          submenu: STOCK_QUERIES.map((sq) => ({
            label: sq.name,
            sublabel: sq.description,
            click: () => send(Channels.MENU_OPEN_STOCK_QUERY, sq.query),
          })),
        },
        { type: 'separator' },
        {
          label: 'Rebuild Index',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow();
            if (!win) return;
            const rootPath = getRootPath(win.id);
            if (!rootPath) return;
            await graph.indexAllNotes(rootPath);
          },
        },
        {
          label: 'Export as Turtle',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow();
            if (!win) return;
            const rootPath = getRootPath(win.id);
            if (!rootPath) return;
            const result = await dialog.showSaveDialog(win, {
              title: 'Export Graph',
              defaultPath: `${path.basename(rootPath)}.ttl`,
              filters: [{ name: 'Turtle', extensions: ['ttl'] }],
            });
            if (!result.canceled && result.filePath) {
              await graph.exportGraph(result.filePath);
            }
          },
        },
      ],
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
