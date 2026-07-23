import type { NoteFile, NotebaseMeta, ReplaceInNotesOptions } from '../../../shared/types';
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

  /**
   * Write a note/source file to an arbitrary project-relative path (#1086).
   * The single store-owned path for out-of-editor writes (source body edits,
   * conversation-driven note rewrites) — components must not call
   * `api.notebase.writeFile` directly. The active-editor buffer still saves
   * through the editor store; this is for writes the editor doesn't own.
   */
  async function writeFile(relativePath: string, content: string): Promise<void> {
    await api.notebase.writeFile(relativePath, content);
  }

  /** Project-wide find/replace across notes (#1086). Mutation → store-owned. */
  function replaceInNotes(opts: ReplaceInNotesOptions) {
    return api.notebase.replaceInNotes(opts);
  }

  return {
    get meta() { return meta; },
    get files() { return files; },
    open,
    openPath,
    newProject,
    close,
    refresh,
    writeFile,
    replaceInNotes,
    // ── File-change subscriptions (main → renderer) ───────────────────────
    // The store owns these `api.notebase.on*` subscriptions so components read
    // the effects without touching `api` directly (renderer data-flow rule).
    /** A note's content/frontmatter was rewritten (link rewrites, LLM applies). */
    onRewritten: (cb: (paths: string[]) => void) => api.notebase.onRewritten(cb),
    onFileCreated: (cb: (path: string) => void) => api.notebase.onFileCreated(cb),
    onFileDeleted: (cb: (path: string) => void) => api.notebase.onFileDeleted(cb),
  };
}
