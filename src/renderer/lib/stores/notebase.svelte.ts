import type { NoteFile, NotebaseMeta } from '../../../shared/types';
import { api } from '../ipc/client';

let meta = $state<NotebaseMeta | null>(null);
let files = $state<NoteFile[]>([]);

export function getNotebaseStore() {
  async function open(): Promise<NotebaseMeta | null> {
    const result = await api.notebase.open();
    if (result) {
      meta = result;
      files = await api.notebase.listFiles();
    }
    return result;
  }

  async function openPath(rootPath: string): Promise<NotebaseMeta | null> {
    const result = await api.notebase.openPath(rootPath);
    meta = result;
    files = await api.notebase.listFiles();
    return result;
  }

  async function newProject(): Promise<NotebaseMeta | null> {
    const result = await api.notebase.newProject();
    if (result) {
      meta = result;
      files = await api.notebase.listFiles();
    }
    return result;
  }

  function close() {
    void api.notebase.close();
    meta = null;
    files = [];
  }

  async function refresh() {
    if (meta) {
      files = await api.notebase.listFiles();
    }
  }

  return {
    get meta() { return meta; },
    get files() { return files; },
    open,
    openPath,
    newProject,
    close,
    refresh,
  };
}
