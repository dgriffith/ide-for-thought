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

export interface SavedNoteTab {
  type: 'note';
  relativePath: string;
  cursorOffset?: number;
  scrollTop?: number;
}

export interface SavedQueryTab {
  type: 'query';
  title: string;
  query: string;
}

export type SavedTab = SavedNoteTab | SavedQueryTab;

export interface TabSession {
  activeIndex: number;
  tabs: SavedTab[];
}

// ── Bookmarks ────────────────────────────────────────────────────────────

export interface Bookmark {
  type: 'bookmark';
  id: string;
  name: string;
  relativePath: string;
  cursorOffset?: number;
}

export interface BookmarkFolder {
  type: 'folder';
  id: string;
  name: string;
  children: BookmarkNode[];
}

export type BookmarkNode = Bookmark | BookmarkFolder;

// ── Conversations ────────────────────────────────────────────────────────

export interface ContextBundleNode {
  uri: string;
  type: string;
  label: string;
}

export interface ContextBundle {
  triggerNode?: ContextBundleNode;
  evidenceSet?: ContextBundleNode[];
  neighborhood?: (ContextBundleNode & { relation: string })[];
  pendingFlags?: string[];
  noteContent?: string;
  notePath?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export type ConversationStatus = 'active' | 'resolved' | 'abandoned';

export interface Conversation {
  id: string;
  triggerNodeUri?: string;
  contextBundle: ContextBundle;
  messages: ConversationMessage[];
  status: ConversationStatus;
  startedAt: string;
  resolvedAt?: string;
}
