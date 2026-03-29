export interface NoteFile {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  children?: NoteFile[];
}

export interface NotebaseMeta {
  rootPath: string;
  name: string;
}

export interface TagInfo {
  tag: string;
  count: number;
}

export interface TaggedNote {
  title: string;
  relativePath: string;
}

export interface SearchResult {
  relativePath: string;
  title: string;
  snippet: string;
  score: number;
}
