import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';

contextBridge.exposeInMainWorld('api', {
  notebase: {
    open: () => ipcRenderer.invoke(Channels.NOTEBASE_OPEN),
    listFiles: () => ipcRenderer.invoke(Channels.NOTEBASE_LIST_FILES),
    readFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_READ_FILE, relativePath),
    writeFile: (relativePath: string, content: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_WRITE_FILE, relativePath, content),
    createFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_CREATE_FILE, relativePath),
    deleteFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_DELETE_FILE, relativePath),
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
  git: {
    status: () => ipcRenderer.invoke(Channels.GIT_STATUS),
    commit: (message: string) => ipcRenderer.invoke(Channels.GIT_COMMIT, message),
  },
  graph: {
    query: (sparql: string) => ipcRenderer.invoke(Channels.GRAPH_QUERY, sparql),
  },
});
