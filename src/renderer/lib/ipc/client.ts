import type { NoteFile, NotebaseMeta } from '../../../shared/types';

export interface NotebaseApi {
  open(): Promise<NotebaseMeta | null>;
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
}

export interface IdeApi {
  notebase: NotebaseApi;
  git: GitApi;
  graph: GraphApi;
}

declare global {
  interface Window {
    api: IdeApi;
  }
}

export const api: IdeApi = window.api;
