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

export interface SavedQuery {
  id: string;
  name: string;
  description: string;
  query: string;
  scope: 'project' | 'global';
  filePath: string;
}

export interface OutgoingLink {
  target: string;
  targetTitle: string;
  linkType: string;
  linkLabel: string;
  linkColor: string;
  exists: boolean;
}

export interface Backlink {
  source: string;
  sourceTitle: string;
  linkType: string;
  linkLabel: string;
  linkColor: string;
}

export interface SearchResult {
  relativePath: string;
  title: string;
  snippet: string;
  score: number;
}
