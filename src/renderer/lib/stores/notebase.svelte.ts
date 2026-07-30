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

  /** Set the thoughtbase display name (#1443). Mutation → store-owned; updates
   *  `meta` so the label refreshes everywhere the store is read. '' clears the
   *  override (falls back to the folder basename). */
  async function setDisplayName(name: string): Promise<void> {
    meta = await api.notebase.setDisplayName(name);
  }

  /** Rebase the knowledge graph to a new base IRI (#1443 Part B). Mutation →
   *  store-owned; persists + rebuilds all indexes main-side (refuses while the
   *  review queue is non-empty). Returns the outcome so the dialog can surface
   *  a refusal/validation error inline. */
  function setBaseUri(uri: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return api.graph.setBaseUri(uri);
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
    setDisplayName,
    setBaseUri,
    // ── File-change subscriptions (main → renderer) ───────────────────────
    // The store owns these `api.notebase.on*` subscriptions so components read
    // the effects without touching `api` directly (renderer data-flow rule).
    /** A note's content/frontmatter was rewritten (link rewrites, LLM applies). */
    onRewritten: (cb: (paths: string[]) => void) => api.notebase.onRewritten(cb),
    onFileCreated: (cb: (path: string) => void) => api.notebase.onFileCreated(cb),
    onFileDeleted: (cb: (path: string) => void) => api.notebase.onFileDeleted(cb),
  };
}
