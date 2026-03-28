import type { NoteFile, NotebaseMeta } from '../../../shared/types';
import { api } from '../ipc/client';

let meta = $state<NotebaseMeta | null>(null);
let files = $state<NoteFile[]>([]);

export function getNotebaseStore() {
  async function open() {
    const result = await api.notebase.open();
    if (result) {
      meta = result;
      files = await api.notebase.listFiles();
    }
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
    refresh,
  };
}
