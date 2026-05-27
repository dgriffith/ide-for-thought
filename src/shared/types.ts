export interface NoteFile {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  children?: NoteFile[];
  /** mtime in ms since epoch. Populated for files only; the renderer
   *  formats this into the relative-time stamp shown on each file row
   *  ("2h", "5d", "1mo"). Optional so callers/fixtures that don't have
   *  an mtime can omit it. */
  mtimeMs?: number;
}

export interface NotebaseMeta {
  rootPath: string;
  name: string;
}

export interface TagInfo {
  tag: string;
  /** Notes carrying this tag (deduped by note). */
  noteCount: number;
  /** Sources carrying this tag (deduped by source). */
  sourceCount: number;
}

export interface TaggedNote {
  title: string;
  relativePath: string;
}

export interface TaggedSource {
  title: string;
  sourceId: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  description: string;
  query: string;
  language: 'sparql' | 'sql';
  scope: 'project' | 'global';
  filePath: string;
  /** Optional grouping label inside a scope (#315). Null = ungrouped. */
  group: string | null;
  /** User-supplied ordering hint inside its (scope, group) bucket (#315).
   *  Null = no explicit position; falls back to alphabetical by name. */
  order: number | null;
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
  /** Omitted for tabs persisted before the SQL toggle landed — load path defaults to 'sparql'. */
  language?: 'sparql' | 'sql';
}

export interface SavedSourceTab {
  type: 'source';
  sourceId: string;
  highlightExcerptId?: string;
}

export type SavedTab = SavedNoteTab | SavedQueryTab | SavedSourceTab;

export interface TabSession {
  activeIndex: number;
  tabs: SavedTab[];
}

// ── Source detail ─────────────────────────────────────────────────────────

export interface SourceMetadata {
  sourceId: string;
  subtype: string | null;
  title: string | null;
  creators: string[];
  year: string | null;
  publisher: string | null;
  doi: string | null;
  uri: string | null;
  abstract: string | null;
}

export interface SourceExcerpt {
  excerptId: string;
  citedText: string | null;
  page: string | null;
  pageRange: string | null;
  locationText: string | null;
}

/**
 * One source cited by a note (#111). Aggregates inline `[[cite::id]]`
 * occurrences with `[[quote::ex]]` occurrences whose excerpts resolve
 * to the same source, so the panel can show "Smith 2020 — 4 cites,
 * 2 quotes" with the relevant excerpts nested underneath.
 */
export interface CitationGroup {
  sourceId: string;
  title: string | null;
  year: string | null;
  creators: string[];
  /** Number of inline `[[cite::sourceId]]` occurrences in the note. */
  citeCount: number;
  /** Total inline `[[quote::ex]]` occurrences whose excerpt belongs to this source. */
  quoteCount: number;
  /** Excerpts of this source that the note actually quotes, with per-excerpt count. */
  excerpts: (SourceExcerpt & { quoteCount: number })[];
}

export interface SourceBacklink {
  relativePath: string;
  title: string;
  kind: 'cite' | 'quote';
  viaExcerptId?: string;
}

/** A note declared to be *about* this source via frontmatter
 *  (`about: [[sources/<id>]]` → dc:subject). Distinct from a backlink:
 *  the user is asserting subject-of, not just referencing. (#474) */
export interface SourceAboutNote {
  relativePath: string;
  title: string;
}

export interface SourceDetail {
  metadata: SourceMetadata;
  excerpts: SourceExcerpt[];
  backlinks: SourceBacklink[];
  /** Notes whose frontmatter declares them as *about* this source. */
  aboutNotes: SourceAboutNote[];
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

export interface Citation {
  url: string;
  title?: string;
  citedText: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  citations?: Citation[];
}

/**
 * A site the user has authenticated to in an Electron persistent partition,
 * so Minerva-initiated fetches to that domain can carry their session.
 * Per-machine state — cookies live in userData under the partition.
 */
export interface PrivilegedSite {
  id: string;
  /** Bare hostname suffix to match against, e.g. `arxiv.org`. */
  domain: string;
  /** Optional human label; falls back to `domain`. */
  label: string;
  addedAt: string;
  /** ISO timestamp of the most recent in-app login window close. */
  lastLoginAt: string | null;
}

export type ConversationStatus = 'active' | 'archived';

/**
 * Tool-window UI state for the conversations panel. Persisted in
 * `.minerva/conversations/_ui.json` so it survives relaunch but stays
 * project-scoped (different projects can have different layouts).
 */
export interface ConversationsUIState {
  visible: boolean;
  /** Pixel height of the panel when visible. Clamped on render. */
  height: number;
  /** Last-active tab id; null when no tabs are open. */
  activeTabId: string | null;
}

export interface Conversation {
  id: string;
  triggerNodeUri?: string;
  contextBundle: ContextBundle;
  messages: ConversationMessage[];
  status: ConversationStatus;
  startedAt: string;
  /** Set when status flips to 'archived'. */
  archivedAt?: string;
  /**
   * Model used for LLM calls in this conversation. `undefined` means the
   * global default from LLMSettings — the conversation then tracks the
   * default if the user changes it later. Once set explicitly, it sticks.
   */
  model?: string;
  /**
   * Tool-specific system prompt pinned on the conversation. When set, every
   * `send` uses this as the tool/user-supplied system (on top of the
   * default tool-using system prompt built on the main side). Set when the
   * conversation was launched from a `outputMode: 'openConversation'` tool.
   */
  systemPrompt?: string;
  /**
   * Code-execution sandbox id returned by Anthropic when the model used a
   * `code_execution` server-side tool (which is how `web_search_20260209`
   * and `web_fetch_20260209` are wrapped). Every subsequent request whose
   * message history still contains those `server_tool_use` blocks must
   * echo this id back as `container`, or the API responds:
   *   "container_id is required when there are pending tool uses
   *    generated by code execution with tools."
   * Threaded through `completeWithTools` and persisted here so the
   * requirement survives across turns (not just within one agentic loop).
   */
  containerId?: string;
  /** ISO timestamp when the sandbox container expires server-side. */
  containerExpiresAt?: string;
}
