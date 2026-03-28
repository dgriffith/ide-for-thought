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
