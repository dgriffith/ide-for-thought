import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';

contextBridge.exposeInMainWorld('api', {
  notebase: {
    open: () => ipcRenderer.invoke(Channels.NOTEBASE_OPEN),
    openPath: (rootPath: string) => ipcRenderer.invoke('notebase:openPath', rootPath),
    newProject: () => ipcRenderer.invoke('notebase:newProject'),
    close: () => ipcRenderer.invoke('notebase:close'),
    clearRecent: () => ipcRenderer.invoke('recent:clear'),
    listFiles: () => ipcRenderer.invoke(Channels.NOTEBASE_LIST_FILES),
    readFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_READ_FILE, relativePath),
    writeFile: (relativePath: string, content: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_WRITE_FILE, relativePath, content),
    createFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_CREATE_FILE, relativePath),
    deleteFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_DELETE_FILE, relativePath),
    createFolder: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_CREATE_FOLDER, relativePath),
    deleteFolder: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_DELETE_FOLDER, relativePath),
    onFileChanged: (cb: (path: string) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_FILE_CHANGED, (_e, p) => cb(p));
    },
    onFileCreated: (cb: (path: string) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_FILE_CREATED, (_e, p) => cb(p));
    },
    onFileDeleted: (cb: (path: string) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_FILE_DELETED, (_e, p) => cb(p));
    },
  },
  search: {
    query: (query: string) => ipcRenderer.invoke(Channels.SEARCH_QUERY, query),
  },
  git: {
    status: () => ipcRenderer.invoke(Channels.GIT_STATUS),
    commit: (message: string) => ipcRenderer.invoke(Channels.GIT_COMMIT, message),
  },
  graph: {
    query: (sparql: string) => ipcRenderer.invoke(Channels.GRAPH_QUERY, sparql),
    rebuild: () => ipcRenderer.invoke(Channels.GRAPH_REBUILD),
    export: () => ipcRenderer.invoke(Channels.GRAPH_EXPORT),
  },
  tags: {
    list: () => ipcRenderer.invoke(Channels.TAGS_LIST),
    notesByTag: (tag: string) => ipcRenderer.invoke(Channels.TAGS_NOTES_BY_TAG, tag),
    allNames: () => ipcRenderer.invoke(Channels.TAGS_ALL_NAMES),
  },
  shell: {
    revealFile: (relativePath?: string) =>
      ipcRenderer.invoke(Channels.SHELL_REVEAL_FILE, relativePath),
  },
  menu: {
    onNewNote: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NEW_NOTE, () => cb());
    },
    onSave: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SAVE, () => cb());
    },
    onToggleSidebar: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_TOGGLE_SIDEBAR, () => cb());
    },
    onTogglePreview: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_TOGGLE_PREVIEW, () => cb());
    },
    onQuickOpen: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_QUICK_OPEN, () => cb());
    },
    onNavBack: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NAV_BACK, () => cb());
    },
    onNavForward: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NAV_FORWARD, () => cb());
    },
    onGotoLine: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_GOTO_LINE, () => cb());
    },
    onFind: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FIND, () => cb());
    },
    onFindReplace: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FIND_REPLACE, () => cb());
    },
    onNewQuery: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NEW_QUERY, () => cb());
    },
    onSortLines: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SORT_LINES, () => cb());
    },
    onOpenProject: (cb: () => void) => {
      ipcRenderer.on('menu:openProject', () => cb());
    },
    onNewProject: (cb: () => void) => {
      ipcRenderer.on('menu:newProject', () => cb());
    },
    onOpenRecentProject: (cb: (path: string) => void) => {
      ipcRenderer.on('menu:openRecentProject', (_e, p) => cb(p));
    },
    onCloseProject: (cb: () => void) => {
      ipcRenderer.on('menu:closeProject', () => cb());
    },
    onClearRecent: (cb: () => void) => {
      ipcRenderer.on('menu:clearRecent', () => cb());
    },
    onProjectOpened: (cb: (meta: { rootPath: string; name: string }) => void) => {
      ipcRenderer.on('project:opened', (_e, meta) => cb(meta));
    },
  },
});

