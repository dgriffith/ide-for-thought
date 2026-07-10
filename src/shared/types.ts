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

export interface SearchInNotesOptions {
  pattern: string;
  caseSensitive: boolean;
  regex: boolean;
}

export interface SearchInNotesMatch {
  line: number;
  startCol: number;
  endCol: number;
  lineText: string;
}

export interface SearchInNotesFileResult {
  relativePath: string;
  matches: SearchInNotesMatch[];
}

export interface ReplaceInNotesSelection {
  relativePath: string;
  line: number;
  startCol: number;
  endCol: number;
}

export interface ReplaceInNotesOptions extends SearchInNotesOptions {
  replacement: string;
  selections: ReplaceInNotesSelection[];
}

export interface ReplaceInNotesResult {
  changedPaths: string[];
  replacedCount: number;
}

export interface HeadingRenameCandidate {
  relativePath: string;
  oldSlug: string;
  oldText: string;
  newSlug: string;
  newText: string;
  incomingLinkCount: number;
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

// ── Semantic "Related" panel (#838) ─────────────────────────────────────────

export type RelatedKind = 'note' | 'source' | 'excerpt';

export interface RelatedNote {
  /** Routes the click: open a note / the source viewer / a highlighted excerpt. */
  kind: RelatedKind;
  /** note relativePath, sourceId, or excerptId. */
  ref: string;
  title: string;
  /** Heading breadcrumb of the best-matching section (`Parent > Child`). */
  sectionHeading: string;
  snippet: string;
  /** Cosine similarity in [0, 1]; higher is closer. */
  score: number;
  /** Note hits only: already wiki-linked to the active note (either direction).
   *  Drives the unlinked-but-related "suggest link" affordance (#840). */
  alreadyLinked?: boolean;
}

export interface RelatedNotesResult {
  /** False when the vector store isn't initialized for this project. */
  enabled: boolean;
  notes: RelatedNote[];
}

// ── Link-neighborhood graph (View B, #846) ──────────────────────────────────

export interface NeighborhoodNode {
  /** relativePath for notes; `source:<sourceId>` for sources. */
  id: string;
  /** `term` is a note additionally typed `thought:Term` (a glossary entry,
   *  #1142) — rendered distinctly from a plain note. */
  kind: 'note' | 'source' | 'term';
  label: string;
  /** False for a note-typed wiki-link target with no file on disk. */
  exists: boolean;
}

export interface NeighborhoodEdge {
  /** Link origin id; the arrow points source → target. */
  source: string;
  target: string;
  linkType: string;
  linkLabel: string;
  linkColor: string;
  /** Relative to the node this edge was discovered from. */
  direction: 'out' | 'in';
}

export interface NeighborhoodResult {
  nodes: NeighborhoodNode[];
  edges: NeighborhoodEdge[];
  /** True when the node cap was hit — the UI shows "+N more". */
  truncated: boolean;
}

export interface NeighborhoodOptions {
  depth?: number;
  cap?: number;
}

/** One hop's worth of graph plus the note ids worth expanding next (#846). */
export interface NeighborhoodHop {
  nodes: NeighborhoodNode[];
  edges: NeighborhoodEdge[];
  expandTo: string[];
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

export interface SavedPdfTab {
  type: 'pdf';
  sourceId: string;
  /** Last-viewed page (1-based), restored on tab reload. */
  page?: number;
}

export interface SavedGraphTab {
  type: 'graph';
  /** The note whose link neighborhood the graph shows (#847). */
  relativePath: string;
  /** Traversal depth; restored on reload. */
  depth?: number;
}

export type SavedTab = SavedNoteTab | SavedQueryTab | SavedSourceTab | SavedPdfTab | SavedGraphTab;

/** Legacy flat session: one group's tabs + active index. Superseded by
 *  {@link LayoutSession} (#816); still read on load and migrated to a single
 *  group so no pre-split session is lost. */
export interface TabSession {
  activeIndex: number;
  tabs: SavedTab[];
}

/** One persisted editor group (pane): its tabs, focused tab, and view mode. */
export interface SavedGroup {
  id: string;
  activeIndex: number;
  /** Persisted as a string; the renderer validates it against `ViewMode` on
   *  load (unknown values fall back to 'source'). */
  viewMode: string;
  tabs: SavedTab[];
}

/** Structural mirror of the renderer's `LayoutNode` tree, for the persisted
 *  split layout. Kept here (not imported from the renderer) so the shared/main
 *  boundary stays free of renderer types; the renderer validates the shape on
 *  load before casting back to `LayoutNode`. */
export type SavedLayoutNode =
  | { kind: 'leaf'; groupId: string }
  | {
      kind: 'split';
      direction: 'horizontal' | 'vertical';
      children: SavedLayoutNode[];
      /** Fractional sizes (sum ≈ 1), one per child, in child order. */
      sizes: number[];
    };

/** Full split-pane session (#816): every group, the focused group, and the
 *  layout tree (directions + sizes). `version` gates future migrations. */
export interface LayoutSession {
  version: 2;
  activeGroupId: string;
  groups: SavedGroup[];
  layout: SavedLayoutNode;
}

// ── Source detail ─────────────────────────────────────────────────────────

/** Reading-queue status (#116). `null` = no status set (= effectively
 *  "unread", but distinct from an explicit "unread" the user picked). */
export type ReadStatus = 'unread' | 'reading' | 'read' | 'skipped';

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
  /** Reading-queue status (#116). */
  readStatus: ReadStatus | null;
  /** ISO date by which the user wants to have finished this. */
  readDueBy: string | null;
  /** `thought:stubStatus` literal. `"unresolved"` indicates a source
   *  created by reference-mining (#106) — partial metadata, no body,
   *  resolvable later via #107. `null` for fully-ingested sources. */
  stubStatus: string | null;
  /** Tag names attached to this source — the union of its `minerva:hasTag`
   *  edges (user `minerva:tag`, upstream subject tags, body hashtags),
   *  sorted. Editable via add/remove (#766). */
  tags: string[];
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

/** One outgoing reference edge (`minerva:references`) from this
 *  source to another (typically a stub). (#106) */
export interface SourceReference {
  sourceId: string;
  title: string;
  /** When the target is a stub (`thought:stubStatus "unresolved"`),
   *  the UI styles the row in italic / low-contrast. */
  stubStatus: string | null;
}

export interface SourceDetail {
  metadata: SourceMetadata;
  excerpts: SourceExcerpt[];
  backlinks: SourceBacklink[];
  /** Notes whose frontmatter declares them as *about* this source. */
  aboutNotes: SourceAboutNote[];
  /** Outgoing `minerva:references` edges — typically populated by
   *  reference mining (#106). */
  references: SourceReference[];
}

/** Manually-curated source collection (#470 phase 1). Sources can
 *  live in many collections. Smart (query-driven) collections will
 *  be a separate type in the same file later. */
export interface Collection {
  id: string;
  name: string;
  /** Parent collection id, or null for a top-level collection. */
  parent: string | null;
  /** Source ids the user has put into this collection. */
  members: string[];
}

/** Smart-collection predicate (#470 phase 2).
 *
 * Tagged union so future variants (read-status from #116, faceted
 * filters, raw SPARQL) can join without disturbing the v1 tag
 * predicate's storage shape. The renderer's predicate editor +
 * the main-process member resolver each branch on `kind`. */
export type SmartCollectionPredicate =
  | { kind: 'tags'; allOf: string[] }
  /** Any of the listed statuses. Empty list matches nothing (mirrors
   *  the `tags allOf` empty-set convention — a no-constraint
   *  predicate is almost always a half-edit). (#116) */
  | { kind: 'readStatus'; status: ReadStatus[] };

/** Query-driven collection (#470 phase 2). Membership is computed
 *  live from the graph each time the user opens it — never
 *  persisted, so the result set tracks the underlying data as it
 *  changes. Smart collections cannot be drag-targets; only
 *  manual collections accept addSource. */
export interface SmartCollection {
  id: string;
  name: string;
  predicate: SmartCollectionPredicate;
}

export interface CollectionsFile {
  collections: Collection[];
  /** Query-driven collections. Omitted when none are defined; the
   *  loader normalises a missing field to `[]`. */
  smartCollections?: SmartCollection[];
}

/** Broadcast payload when two CSVs derive the same DuckDB table
 *  name and the second is skipped (#354). The renderer surfaces
 *  this as a suppressible toast pointing at `table_name:` in a
 *  companion .md as the fix. */
export interface CsvTableCollision {
  tableName: string;
  /** Path that was registered first and won. */
  existingPath: string;
  /** Path that was skipped to avoid the clobber. */
  attemptedPath: string;
}

/** One inbound edge from outside the delete set into a note slated
 *  for deletion (#429 Safe Delete). The renderer groups rows by
 *  `target` to render the blocker dialog. */
export interface SafeDeleteBlocker {
  /** Note in the deletion set that has an external inbound edge. */
  target: string;
  /** Note outside the set that links into `target`. */
  source: string;
  /** Title of the linking note, falling back to its path. */
  sourceTitle: string;
  /** Human label for the most-specific link type that linked source →
   *  target. `null` when only an untyped/frontmatter predicate hit. */
  linkLabel: string | null;
  /** Total inbound edges from source → target, across predicates. */
  linkCount: number;
}

// ── Bookmarks ────────────────────────────────────────────────────────────

export interface Bookmark {
  type: 'bookmark';
  id: string;
  name: string;
  relativePath: string;
  cursorOffset?: number | undefined;
  /** Optional sub-file anchor. A heading slug (#755 — e.g. `methods`) or a
   *  `^block-id` (#756). Absent/undefined ⇒ the bookmark targets the whole
   *  file and opens by path, exactly as before. */
  anchor?: string | undefined;
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

/**
 * Token usage for one completed assistant turn. For tool-using turns this is
 * the **sum** across every iteration of the agentic loop — `completeWithTools`
 * runs up to 10 model calls per turn, each with its own `usage`, and reading
 * only the last one badly under-reports tool-heavy turns. Cache reads/writes
 * are kept distinct from plain input tokens because they price differently
 * (cache read ≈ 0.1× input, cache write ≈ 1.25× input — see #821).
 */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  citations?: Citation[];
  /**
   * Accumulated token usage for the turn that produced this (assistant)
   * message. Persisted so a conversation's running cost survives reload
   * (#820). Absent on user/system messages and on turns that predate usage
   * capture.
   */
  usage?: TurnUsage;
  /**
   * The model that produced this turn. Usage is meaningless for cost without
   * it — pricing is per-model. Recorded alongside `usage` (#820); cost math
   * keyed off this lands in #821.
   */
  usageModel?: string;
  /**
   * Derived turn cost in USD, computed from `usage` under `usageModel`'s
   * pricing at append time and persisted so a conversation's running total
   * survives reload (#821). Absent when the producing model is unpriced — the
   * UI then shows tokens only, never a guessed dollar figure.
   */
  costUSD?: number;
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
 * Result of a `/compact` (#824). On success, `conversation` is the fresh
 * conversation (earlier turns replaced by a summary, recent turns kept
 * verbatim); the pre-compaction original is archived and recoverable. When the
 * thread is too short to be worth compacting, `compacted` is false and `reason`
 * explains why — nothing is changed.
 */
export interface CompactResult {
  compacted: boolean;
  conversation?: Conversation;
  reason?: string;
}

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
   * Per-conversation reasoning-effort override (#825). `undefined` means inherit
   * the global default (`LLMSettings.effort`). Clamped to the active model's
   * supported levels at call time. Mirrors the `model` override pattern.
   */
  effort?: import('./tools/effort').Effort;
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
