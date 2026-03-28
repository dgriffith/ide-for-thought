import { Menu, shell, app, dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { getRecentProjects } from './recent-projects';

let currentWin: BrowserWindow;

function send(channel: string, ...args: unknown[]) {
  currentWin.webContents.send(channel, ...args);
}

export function buildMenu(win: BrowserWindow): void {
  currentWin = win;
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
          click: () => send('menu:openRecentProject', projectPath),
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
            label: app.name,
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
          label: 'New Project',
          accelerator: 'CmdOrCtrl+Shift+N',
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

    // Go
    {
      label: 'Go',
      submenu: [
        {
          label: 'Quick Open',
          accelerator: 'CmdOrCtrl+P',
          click: () => send(Channels.MENU_QUICK_OPEN),
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
          label: 'SPARQL Console',
          accelerator: 'CmdOrCtrl+Shift+Q',
          enabled: false,
          click: () => {},
        },
        { type: 'separator' },
        {
          label: 'Rebuild Index',
          click: () => send(Channels.GRAPH_REBUILD),
        },
        {
          label: 'Export Graph (Turtle)',
          click: () => send(Channels.GRAPH_EXPORT),
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
            shell.openExternal('https://github.com/dgriffith/ide-for-thought/issues');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
