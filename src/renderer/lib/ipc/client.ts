import type { NoteFile, NotebaseMeta, TagInfo, TaggedNote } from '../../../shared/types';

export interface NotebaseApi {
  open(): Promise<NotebaseMeta | null>;
  openPath(rootPath: string): Promise<NotebaseMeta>;
  newProject(): Promise<NotebaseMeta | null>;
  close(): Promise<null>;
  clearRecent(): Promise<void>;
  listFiles(): Promise<NoteFile[]>;
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  createFile(relativePath: string): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
  onFileChanged(cb: (path: string) => void): void;
  onFileCreated(cb: (path: string) => void): void;
  onFileDeleted(cb: (path: string) => void): void;
}

export interface GitApi {
  status(): Promise<{ files: unknown[] }>;
  commit(message: string): Promise<{ success: boolean; message: string }>;
}

export interface GraphApi {
  query(sparql: string): Promise<{ results: unknown[] }>;
  rebuild(): Promise<{ count: number }>;
  export(): Promise<void>;
}

export interface TagsApi {
  list(): Promise<TagInfo[]>;
  notesByTag(tag: string): Promise<TaggedNote[]>;
  allNames(): Promise<string[]>;
}

export interface ShellApi {
  revealFile(relativePath?: string): Promise<void>;
}

export interface MenuApi {
  onNewNote(cb: () => void): void;
  onSave(cb: () => void): void;
  onToggleSidebar(cb: () => void): void;
  onTogglePreview(cb: () => void): void;
  onQuickOpen(cb: () => void): void;
  onFind(cb: () => void): void;
  onFindReplace(cb: () => void): void;
  onOpenProject(cb: () => void): void;
  onNewProject(cb: () => void): void;
  onOpenRecentProject(cb: (path: string) => void): void;
  onCloseProject(cb: () => void): void;
  onClearRecent(cb: () => void): void;
}

export interface IdeApi {
  notebase: NotebaseApi;
  git: GitApi;
  graph: GraphApi;
  tags: TagsApi;
  shell: ShellApi;
  menu: MenuApi;
}

declare global {
  interface Window {
    api: IdeApi;
  }
}

export const api: IdeApi = window.api;
