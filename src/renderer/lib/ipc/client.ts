import type { NoteFile, NotebaseMeta, TagInfo, TaggedNote, TaggedSource, SavedQuery, SavedView, SavedViewInput, SearchResult, OutgoingLink, Backlink, TabSession, LayoutSession, Conversation, ContextBundle, ConversationMessage, BookmarkNode, SourceDetail, SearchInNotesOptions, SearchInNotesFileResult, ReplaceInNotesOptions, ReplaceInNotesResult, HeadingRenameCandidate, MenuEditorState } from '../../../shared/types';
import type { ToolExecutionRequest, ToolExecutionResult, ConversationToolPayload } from '../../../shared/tools/types';
import type { ClipperState } from '../../../shared/clipper-pairing';
import type { ThemeMode } from '../../../shared/theme';

export interface NotebaseApi {
  open(): Promise<NotebaseMeta | null>;
  openPath(rootPath: string): Promise<NotebaseMeta>;
  newProject(): Promise<NotebaseMeta | null>;
  /** Pick a dir, create a fresh window, open the project there. Returns the picked meta or null. */
  openInNewWindow(): Promise<NotebaseMeta | null>;
  /** Pick a dir for a new project, create a fresh window, initialise there. */
  newProjectInNewWindow(): Promise<NotebaseMeta | null>;
  /** Open a known path in a fresh window (used by Recent Thoughtbases → new window). */
  openPathInNewWindow(rootPath: string): Promise<NotebaseMeta>;
  /** Copy the bundled tutorial thoughtbase to a picked dir and open it (#1542).
   *  Returns the installed meta, or null if the user cancelled the picker. */
  installTutorial(): Promise<NotebaseMeta | null>;
  /** Install the tutorial into a fresh window (#1544) — used when another
   *  thoughtbase is already open so the current one stays put. */
  installTutorialInNewWindow(): Promise<NotebaseMeta | null>;
  close(): Promise<null>;
  clearRecent(): Promise<void>;
  listFiles(): Promise<NoteFile[]>;
  readFile(relativePath: string): Promise<string>;
  /** Binary-safe read for images / pdfs / other non-text assets (#244). */
  readBinary(relativePath: string): Promise<Uint8Array>;
  /** Binary-safe write — used by the editor's image-upload path (#455). */
  writeBinary(relativePath: string, bytes: Uint8Array): Promise<void>;
  /** Cheap existence check — used to dedupe content-hashed assets (#455). */
  fileExists(relativePath: string): Promise<boolean>;
  writeFile(relativePath: string, content: string): Promise<void>;
  createFile(relativePath: string): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
  createFolder(relativePath: string): Promise<void>;
  deleteFolder(relativePath: string): Promise<void>;
  rename(oldRelPath: string, newRelPath: string): Promise<void>;
  mergePreview(sourceRelPath: string, targetRelPath: string): Promise<{
    linkOccurrences: number;
    affectedFiles: number;
  }>;
  merge(sourceRelPath: string, targetRelPath: string, separator?: string): Promise<{
    targetPath: string;
    mergeOffset: number;
    mergeLine: number;
    rewrittenLinks: number;
    rewrittenPaths: string[];
    deletedSource: string;
  }>;
  copy(srcRelPath: string, destRelPath: string): Promise<void>;
  searchInNotes(opts: SearchInNotesOptions): Promise<SearchInNotesFileResult[]>;
  replaceInNotes(opts: ReplaceInNotesOptions): Promise<ReplaceInNotesResult>;
  onFileChanged(cb: (path: string) => void): () => void;
  onFileCreated(cb: (path: string) => void): () => void;
  onFileDeleted(cb: (path: string) => void): () => void;
  onRenamed(cb: (transitions: Array<{ old: string; new: string }>) => void): void;
  onRewritten(cb: (paths: string[]) => void): () => void;
  onHeadingRenameSuggested(cb: (candidate: HeadingRenameCandidate) => void): void;
  renameAnchor(targetRelativePath: string, oldSlug: string, newSlug: string): Promise<{ rewrittenPaths: string[] }>;
  renameSource(oldId: string, newId: string): Promise<{ rewrittenPaths: string[] }>;
  renameExcerpt(oldId: string, newId: string): Promise<{ rewrittenPaths: string[] }>;
  /** Per-project flag toggled by the "Don't show again" control on the
   *  new-thoughtbase onboarding modal. Default false; set on user opt-out. */
  getOnboardingDismissed(): Promise<boolean>;
  setOnboardingDismissed(dismissed: boolean): Promise<void>;
  /** Thoughtbase Properties (#1443): display name, folder basename, base IRI. */
  getProperties(): Promise<{ displayName: string; folderName: string; baseUri: string }>;
  /** Set the display name ('' clears → folder basename); resolves to fresh meta. */
  setDisplayName(name: string): Promise<import('../../../shared/types').NotebaseMeta>;
}

export type {
  SearchInNotesOptions,
  SearchInNotesMatch,
  SearchInNotesFileResult,
  ReplaceInNotesSelection,
  ReplaceInNotesOptions,
  ReplaceInNotesResult,
  HeadingRenameCandidate,
} from '../../../shared/types';

export interface LinksApi {
  outgoing(relativePath: string): Promise<OutgoingLink[]>;
  backlinks(relativePath: string): Promise<Backlink[]>;
  /** Coalesced fetch (#351) — both directions in one IPC. */
  bundle(relativePath: string): Promise<{ outgoing: OutgoingLink[]; backlinks: Backlink[] }>;
  /** Per-source citation aggregation for the active note (#111). */
  citationsForNote(
    relativePath: string,
    content?: string,
  ): Promise<import('../../../shared/types').CitationGroup[]>;
  /** Safe-delete pre-flight (#429): inbound edges from outside `paths`. */
  externalInbound(
    paths: string[],
  ): Promise<import('../../../shared/types').SafeDeleteBlocker[]>;
  /** Depth-N link neighborhood for the graph view (#846). */
  neighborhood(
    relativePath: string,
    opts?: import('../../../shared/types').NeighborhoodOptions,
  ): Promise<import('../../../shared/types').NeighborhoodResult>;
  /** A single hop out of a node — expand-on-demand (#846). */
  expandNode(relativePath: string): Promise<import('../../../shared/types').NeighborhoodHop>;
}

export interface QueriesApi {
  list(): Promise<SavedQuery[]>;
  save(scope: string, name: string, description: string, query: string, language: 'sparql' | 'sql', group?: string | null): Promise<SavedQuery>;
  delete(filePath: string): Promise<void>;
  rename(filePath: string, newName: string): Promise<string>;
  /** Move a query between scopes (#314). */
  move(filePath: string, newScope: 'project' | 'global'): Promise<string>;
  /** Re-tag a query's @group (#315). */
  setGroup(filePath: string, group: string | null): Promise<void>;
  /** Apply a new @order across many queries at once (#315 — drag-reorder). */
  setOrder(entries: Array<{ filePath: string; order: number | null }>): Promise<void>;
}

/** Saved views (#1072) — named presets over a type's multi-view. */
export interface ViewsApi {
  list(): Promise<SavedView[]>;
  save(scope: 'project' | 'global', input: SavedViewInput): Promise<SavedView>;
  delete(filePath: string): Promise<void>;
  rename(filePath: string, newName: string): Promise<string>;
  setOrder(entries: Array<{ filePath: string; order: number | null }>): Promise<void>;
}

export interface SearchApi {
  query(query: string): Promise<SearchResult[]>;
}

export interface GitApi {
  status(): Promise<{ isRepo: boolean; branch: string | null; files: unknown[] }>;
  commit(message: string): Promise<{ success: boolean; sha: string }>;
}

export interface GraphApi {
  query(sparql: string): Promise<{ results: unknown[]; columns: string[]; error?: string }>;
  /** Rebase to a new base IRI + rebuild indexes (#1443 Part B). */
  setBaseUri(uri: string): Promise<{ ok: true } | { ok: false; error: string }>;
  groundCheck(claimText: string): Promise<{ node: string; label: string; type: string }[]>;
  inspections(): Promise<{ id: string; type: string; severity: string; nodeUri: string; nodeLabel: string; message: string; suggestedAction?: string }[]>;
  runInspections(): Promise<{ id: string; type: string; severity: string; nodeUri: string; nodeLabel: string; message: string; suggestedAction?: string }[]>;
  export(): Promise<void>;
  sourceDetail(sourceId: string): Promise<SourceDetail | null>;
  excerptSource(excerptId: string): Promise<{ sourceId: string } | null>;
  /** Attach an excerpt as grounds/supports/rebuts evidence for a claim (#1073) —
   *  files a pending proposal reviewed in the Proposals panel. */
  attachExcerptEvidence(excerptId: string, claimPath: string, role: 'grounds' | 'supports' | 'rebuts'): Promise<{ ok: boolean; error?: string; proposalUri?: string }>;
  schemaForCompletion(): Promise<{
    prefixes: Array<{ prefix: string; iri: string }>;
    predicates: Array<{ iri: string; prefixed?: string }>;
    classes: Array<{ iri: string; prefixed?: string }>;
  }>;
  /** Frontmatter alias → relativePath snapshot (#469). Lower-cased keys. */
  aliasMap(): Promise<Record<string, string>>;
  /** Entries form of the alias map preserving original casing — used
   *  by the wiki-link autocomplete to suggest aliases (#492). */
  aliasEntries(): Promise<Array<{ alias: string; relativePath: string }>>;
  /** Deduped, sorted list of every frontmatter key in use across the
   *  project. Powers the Properties panel's Add-Property autocomplete (#488). */
  frontmatterKeys(): Promise<string[]>;
}

export type TablesQueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

export interface TableInfo {
  name: string;
  /** CSV file path for `source: 'csv'`; the source note's path for `'note'`. */
  relativePath: string;
  columns: string[];
  rowCount: number;
  /** Where the table came from — a standalone `.csv` file or a note's `Table:` caption (#1359). */
  source: 'csv' | 'note';
  /** Note tables only: the raw human caption. */
  caption?: string;
  /** Note tables only: position in the note's table list. */
  tableIndex?: number;
}

export interface TablesApi {
  query(sql: string): Promise<TablesQueryResult>;
  list(): Promise<TableInfo[]>;
  /** Fires when a CSV is registered/unregistered or the initial scan completes. */
  onChanged(cb: () => void): void;
  /** Fires when two CSVs derive the same DuckDB table name and the
   *  second was skipped (#354). Renderer surfaces a suppressible
   *  toast pointing at `table_name:` as the fix. */
  onNameCollision(cb: (collision: import('../../../shared/types').CsvTableCollision) => void): void;
}

export interface EmbeddingsApi {
  /** Fires as the semantic-index backfill progresses; `running: false` on completion (#836). */
  onBackfillProgress(cb: (p: { done: number; total: number; running: boolean }) => void): void;
  /** Notes semantically related to `relativePath`, for the Related panel (#838). */
  related(relativePath: string, limit?: number): Promise<import('../../../shared/types').RelatedNotesResult>;
  /** Notes that semantically mention an object (by title/aliases) but don't link
   *  it — unlinked mentions for the typed-object surface (#1074). */
  unlinkedMentions(relativePath: string, limit?: number): Promise<import('../../../shared/types').RelatedNotesResult>;
  /** Free-text semantic search for the live `:::query-semantic` block (#1128). */
  searchText(
    query: string,
    opts?: { limit?: number; kinds?: readonly ('note' | 'source' | 'excerpt')[]; excludePath?: string },
  ): Promise<import('../../../shared/types').RelatedNotesResult>;
}

export interface TagsApi {
  list(): Promise<TagInfo[]>;
  notesByTag(tag: string): Promise<TaggedNote[]>;
  /** Notes with any tag at-or-under `prefix` (#466). */
  notesByTagPrefix(prefix: string): Promise<TaggedNote[]>;
  sourcesByTag(tag: string): Promise<TaggedSource[]>;
  allNames(): Promise<string[]>;
}

export interface TemplateInfo {
  /** Template name without the `.md` extension — what the user sees. */
  name: string;
  /** Filename on disk (`<name>.md`). */
  filename: string;
}

export interface TemplatesApi {
  list(): Promise<TemplateInfo[]>;
  /** Returns the template body, or `null` if not found. */
  get(filename: string): Promise<string | null>;
  saveAs(name: string, content: string): Promise<TemplateInfo>;
}

export interface ExportApi {
  csv(csv: string): Promise<void>;
}

export interface DropImportResult {
  copied: Array<{ localPath: string; relativePath: string }>;
  ingestedPdfs: Array<{ localPath: string; sourceId: string; duplicate: boolean; title: string }>;
  rejected: Array<{ localPath: string; reason: string }>;
}

export interface FilesApi {
  /** Get the absolute OS path for a `File` object from a drag-drop `DataTransfer`. */
  getPathForFile(file: File): string;
  /** Import a batch of external files into the thoughtbase (#259). */
  dropImport(targetFolder: string, localPaths: string[]): Promise<DropImportResult>;
}

export type { CellOutput, CellResult } from '../../../shared/compute/types';
import type { CellResult, ComputeConsentSummary } from '../../../shared/compute/types';

export interface CitationAuditPayload {
  /** Resolved style id after fallback (e.g. 'apa'). */
  styleId: string;
  /** Resolved locale id after fallback (e.g. 'en-US'). */
  localeId: string;
  availableStyles: Array<{ id: string; label: string }>;
  availableLocales: Array<{ id: string; label: string }>;
  /** Sources that'll appear in the rendered bibliography, ordered by ref count desc. */
  bySource: Array<{ sourceId: string; title: string; refCount: number }>;
  /** Cite/quote ids that couldn't be resolved against the project's sources/excerpts. */
  missing: Array<{ id: string; kind: 'cite' | 'quote'; refCount: number }>;
}

export interface ExportPreviewPlan {
  exporterId: string;
  exporterLabel: string;
  inputs: Array<{ relativePath: string; kind: 'note' | 'source' | 'excerpt'; title: string; overridden: boolean }>;
  excluded: Array<{ relativePath: string; reason: string }>;
  citations: CitationAuditPayload;
}

export type ExportInputKind = 'single-note' | 'folder' | 'project' | 'tree' | 'source';

/** Format family metadata for the format-first export menu (#: export-menu-redesign). */
export type ExportGroupId =
  | 'markdown' | 'html' | 'pdf' | 'site' | 'annotated' | 'anki' | 'bibtex' | 'pandoc';
export interface ExportGroupMeta {
  id: ExportGroupId;
  label: string;
  category: 'document' | 'publication' | 'citation';
  order: number;
}

/** One registered exporter, as surfaced to the menu + export dialog. */
export interface ExporterInfo {
  id: string;
  label: string;
  acceptedKinds: ExportInputKind[];
  group: ExportGroupMeta;
  /** Set when the exporter shares a group + scope with another (Markdown). */
  variantLabel?: string;
  variantOrder: number;
}

export interface RunExportInput {
  exporterId: string;
  input: {
    kind: ExportInputKind;
    relativePath?: string;
    maxDepth?: number;
  };
  outputDir: string;
  linkPolicy?: 'drop' | 'inline-title' | 'follow-to-file';
  citationStyle?: string;
  citationLocale?: string;
  /** Manual per-export exclusion overrides — relative paths to force-include (#283). */
  forceInclude?: string[];
  /** Manual per-export deselection — relative paths to force-exclude (#293). */
  forceExclude?: string[];
}

export interface RunExportResult {
  filesWritten: number;
  summary: string;
  outputDir: string;
  writtenPaths: string[];
}

export interface PublishApi {
  /** Every registered exporter, for menu + dialog population. */
  listExporters(): Promise<ExporterInfo[]>;
  /** Resolve an ExportPlan without running it — for the preview dialog. */
  resolvePlan(
    input: RunExportInput['input'],
    opts?: {
      exporterId?: string;
      linkPolicy?: RunExportInput['linkPolicy'];
      citationStyle?: string;
      citationLocale?: string;
      forceInclude?: string[];
      forceExclude?: string[];
    },
  ): Promise<ExportPreviewPlan>;
  /**
   * Run the exporter. When `outputDir` is omitted, main opens a directory
   * picker modally and the call resolves to `null` if the user cancels.
   */
  runExport(args: Omit<RunExportInput, 'outputDir'> & { outputDir?: string }): Promise<RunExportResult | null>;

  // ── Publish → git remote (#254) ───────────────────────────────────────────
  /** Configured git-push targets for the open thoughtbase. */
  listTargets(): Promise<PublishTarget[]>;
  /** Add or replace a target by id; resolves to the updated list. */
  upsertTarget(target: PublishTarget): Promise<PublishTarget[]>;
  /** Remove a target by id; resolves to the updated list. */
  removeTarget(id: string): Promise<PublishTarget[]>;
  /** Export + commit + push (or, with `dryRun`, preview the diff only). */
  toGit(targetId: string, opts?: { dryRun?: boolean }): Promise<PublishGitResponse>;
  /** Validate S3 credentials + endpoint against the bucket, before saving (#1444). */
  checkS3(config: {
    bucket: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }): Promise<import('../../../shared/tools/types').ConnectionCheckResult>;
  /** Validate a GitHub token; blank tests the gh CLI / env fallback (#1508). */
  checkGitHub(config: { token?: string }): Promise<import('../../../shared/tools/types').ConnectionCheckResult>;
}

/** A configured publish destination (#254; multi-transport #1444). */
interface PublishTargetBase {
  id: string;
  label: string;
  exporter: string;
  subdir?: string;
}
export interface GitPublishTarget extends PublishTargetBase {
  kind?: 'git';
  gitRemote: string;
  gitBranch: string;
  commitMessageTemplate?: string;
}
export interface S3PublishTarget extends PublishTargetBase {
  kind: 's3';
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  /** Write-only on upsert (tri-state); never returned by the read path. */
  secretAccessKey?: string;
  /** Read-only: a secret is stored. */
  hasSecret?: boolean;
}
export type PublishTarget = GitPublishTarget | S3PublishTarget;

export interface PublishChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface PublishGitResult {
  targetId: string;
  dryRun: boolean;
  branch: string;
  branchCreated: boolean;
  changes: PublishChange[];
  committed: boolean;
  pushed: boolean;
  sha?: string;
  commitMessage?: string;
}

/** Publish returns a result-or-error union so the dialog can show the raw
 *  git message (auth / non-fast-forward / network) verbatim. */
export type PublishGitResponse =
  | { ok: true; result: PublishGitResult }
  | { ok: false; error: string };

export interface ComputeApi {
  /** Dispatch a cell to its language's executor (#238). */
  runCell(language: string, code: string, notePath?: string): Promise<CellResult>;
  /** Every fence language that currently has a registered executor. */
  languages(): Promise<string[]>;
  /**
   * Save a cell's output as a first-class note with provenance frontmatter.
   * Injects a stable `{id=…}` into the source fence when the cell doesn't
   * already have one, so re-saves land on the same backlink anchor.
   *
   * Result discriminator:
   *  - `status: 'written'` — file was written; result includes the
   *    final path, cell id, whether an id was minted, and the current
   *    pin state.
   *  - `status: 'needs-confirm'` — destination exists with different
   *    content; the renderer should prompt the user and re-invoke
   *    with `forceOverwrite: true` to proceed.
   */
  saveCellOutput(input: {
    sourcePath: string;
    cellLanguage: string;
    cellCode: string;
    output: import('../../../shared/compute/types').CellOutput;
    destPath?: string;
    title?: string;
    /** Set when "Pin to notebook" was clicked (or to re-pin). */
    pin?: boolean;
    /** Set to true after the user confirmed the overwrite-on-diff prompt. */
    forceOverwrite?: boolean;
  }): Promise<
    | { status: 'written'; derivedPath: string; cellId: string; injectedId: boolean; pinned: boolean }
    | { status: 'needs-confirm'; derivedPath: string; cellId: string; existingContent: string; pendingContent: string }
  >;
  /** Wipe and respawn the project's Python kernel — palette command
   *  "Compute: Restart Python Kernel". Loses every notebook's namespace. */
  restartPythonKernel(): Promise<void>;
  /** Send SIGINT to the active Python kernel so a runaway cell aborts
   *  without losing namespace state — palette command "Compute:
   *  Interrupt Cell" (#372). POSIX-only for v1. */
  interruptPythonKernel(): Promise<
    | { ok: true }
    | { ok: false; reason: 'no-kernel' | 'unsupported-platform' | 'signal-failed' }
  >;
  /**
   * Per-machine Python interpreter override (#374). Empty `pythonPath`
   * means "no override; use $MINERVA_PYTHON or python3". Stored under
   * Electron's userData dir, NOT in the project — the override is
   * machine-scoped (different projects on the same machine share it).
   */
  getPythonSettings(): Promise<{ pythonPath: string; allowNetwork: boolean }>;
  setPythonSettings(settings: { pythonPath: string; allowNetwork: boolean }): Promise<void>;
  /**
   * Probe a candidate interpreter — verify it runs + capture the
   * version string. Empty / omitted `candidate` probes the active
   * resolver pick (the Settings UI's "what's running" display). */
  probePython(candidate?: string): Promise<{
    ok: boolean;
    path: string;
    version?: string;
    error?: string;
  }>;
  /** Native file picker for selecting a Python interpreter; null on cancel. */
  browsePython(): Promise<string | null>;
  /**
   * Content-addressed compute consent (#1412). `consentStatus` reports whether
   * this exact cell is already consented (`cell`), the whole project is blanket-
   * trusted (`blanket`), or neither (`none`); the run gate prompts (showing the
   * code) when needed and records the choice via `grantConsent`. Stored
   * per-machine, so consent never travels with a shared thoughtbase. */
  consentStatus(language: string, code: string): Promise<'cell' | 'blanket' | 'none'>;
  grantConsent(language: string, code: string, scope: 'cell' | 'project'): Promise<void>;
  /**
   * Trust management (#1413). `listConsent` returns every thoughtbase this
   * machine has trusted for compute (blanket + per-cell counts) for the
   * Settings → Compute list; `revokeConsent` clears a thoughtbase's grants so
   * its cells prompt eyes-on-code again. */
  listConsent(): Promise<ComputeConsentSummary[]>;
  revokeConsent(rootPath: string): Promise<void>;
  /** Reveal the per-machine compute execution audit log (#1413) in the OS file
   *  manager — a stateless OS side-effect, so components may call it directly. */
  revealAuditLog(): Promise<void>;
}

export interface ShellApi {
  revealFile(relativePath?: string): Promise<void>;
  openInDefault(relativePath: string): Promise<void>;
  openInTerminal(relativePath?: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}

/** App + build metadata for the About dialog (#803). */
export interface AppInfo {
  name: string;
  version: string;
  commit: string;
  buildDate: string;
  electron: string;
  chrome: string;
  node: string;
}

/** One keyboard shortcut for the Help ▸ Keyboard Shortcuts reference (#804). */
export interface ShortcutItem {
  label: string;
  keys: string;
}
export interface ShortcutGroup {
  menu: string;
  items: ShortcutItem[];
}

export interface AppApi {
  getInfo(): Promise<AppInfo>;
  getShortcuts(): Promise<ShortcutGroup[]>;
}

export interface ImagesApi {
  /** Cached-or-fetched bytes + mime for an external image URL, or null when
   *  unavailable (offline + not yet cached, non-image, or oversized). */
  cacheExternal(url: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
}

export interface YoutubeApi {
  /** Cached-or-fetched poster thumbnail bytes for a video id, or null when
   *  unavailable (offline + not yet cached). */
  thumbnail(id: string): Promise<Uint8Array | null>;
}

/** Whole-window zoom (#...). Synchronous wrappers over the renderer's own
 *  `webFrame`, so no promises. */
export interface ViewApi {
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
}

export interface BookmarksApi {
  load(): Promise<BookmarkNode[]>;
  save(tree: BookmarkNode[]): Promise<void>;
}

export interface ClipperApi {
  /** Enable toggle + secret + (when running) pairing code, for Settings (#791). */
  getState(): Promise<ClipperState>;
  setEnabled(enabled: boolean): Promise<ClipperState>;
  /** Rotate the secret, invalidating the old pairing code. */
  regenerateSecret(): Promise<ClipperState>;
}

export interface ConversationsApi {
  create(contextBundle: ContextBundle, triggerNodeUri?: string, options?: { systemPrompt?: string; model?: string; webEnabled?: boolean }): Promise<Conversation>;
  append(id: string, role: ConversationMessage['role'], content: string): Promise<Conversation>;
  archive(id: string): Promise<Conversation>;
  load(id: string): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  listActive(): Promise<Conversation[]>;
  send(
    convId: string,
    userMessage: string,
    systemPrompt?: string,
    currentNotePath?: string,
    extraTools?: import('../../../shared/conversation-tools').ConversationToolKey[],
  ): Promise<Conversation>;
  loadUIState(): Promise<import('../../../shared/types').ConversationsUIState>;
  saveUIState(state: import('../../../shared/types').ConversationsUIState): Promise<void>;
  onAskUser(cb: (req: import('../../../shared/conversation-tools').AskUserRequest) => void): void;
  askUserReply(questionId: string, answer: string): Promise<void>;
  onStream(cb: (chunk: string) => void): void;
  cancel(): Promise<void>;
  setModel(conversationId: string, model: string | undefined): Promise<Conversation>;
  /** Per-conversation reasoning-effort override (#825). Pass undefined to
   *  clear it and inherit the global default. */
  setEffort(
    conversationId: string,
    effort: import('../../../shared/tools/effort').Effort | undefined,
  ): Promise<Conversation>;
  /** Client-side compaction (#824): summarize earlier turns into a fresh
   *  conversation, archiving the original. */
  compact(conversationId: string): Promise<import('../../../shared/types').CompactResult>;
  /** Subscribe to drafts produced by the propose_notes tool. Drafts are scoped per conversation. */
  onDraft(cb: (draft: import('../../../shared/conversation-drafts').ConversationDraft) => void): void;
  /** File a draft as a Proposal AND auto-approve it (the user already reviewed the inline card). */
  fileDraft(
    draft: import('../../../shared/conversation-drafts').ConversationDraft,
  ): Promise<import('../../../shared/conversation-drafts').FileDraftResult>;
  /** Subscribe to drafts produced by the propose_sources tool. */
  onSourceDraft(
    cb: (draft: import('../../../shared/conversation-source-drafts').ConversationSourceDraft) => void,
  ): void;
  /** Run the ingest pipeline for each source in the draft and return per-source outcomes. */
  fileSourceDraft(
    draft: import('../../../shared/conversation-source-drafts').ConversationSourceDraft,
  ): Promise<import('../../../shared/conversation-source-drafts').FileSourceDraftResult>;
  /** Subscribe to frontmatter-patch drafts produced by the set_properties tool. */
  onPropertyDraft(
    cb: (draft: import('../../../shared/conversation-property-drafts').ConversationPropertyDraft) => void,
  ): void;
  /** Apply each {path, properties} patch in an approved draft. Returns per-update outcomes. */
  filePropertyDraft(
    draft: import('../../../shared/conversation-property-drafts').ConversationPropertyDraft,
  ): Promise<import('../../../shared/conversation-property-drafts').FilePropertyDraftResult>;
  /** Subscribe to source-summary drafts produced by propose_source_properties (#103). */
  onSourcePropertyDraft(
    cb: (draft: import('../../../shared/conversation-source-property-drafts').ConversationSourcePropertyDraft) => void,
  ): void;
  /** Apply an approved source-summary draft (upsert dc:abstract / thought:tldr + reindex). */
  fileSourcePropertyDraft(
    draft: import('../../../shared/conversation-source-property-drafts').ConversationSourcePropertyDraft,
  ): Promise<import('../../../shared/conversation-source-property-drafts').FileSourcePropertyDraftResult>;
  /** Subscribe to key-claim drafts produced by the propose_claims tool (#104). */
  onClaimsDraft(
    cb: (draft: import('../../../shared/conversation-claims-drafts').ConversationClaimsDraft) => void,
  ): void;
  /** Apply an approved claims draft (file claim notes + excerpt nodes via approval). */
  fileClaimsDraft(
    draft: import('../../../shared/conversation-claims-drafts').ConversationClaimsDraft,
  ): Promise<import('../../../shared/conversation-claims-drafts').FileClaimsDraftResult>;
  /** Subscribe to code-cell drafts produced by the propose_compute tool (#245). */
  onComputeDraft(
    cb: (draft: import('../../../shared/conversation-compute-drafts').ConversationComputeDraft) => void,
  ): void;
  /** Run a compute draft and append the output to the conversation log. */
  runComputeDraft(
    input: import('../../../shared/conversation-compute-drafts').RunComputeDraftInput,
  ): Promise<import('../../../shared/conversation-compute-drafts').RunComputeDraftResult>;
  /** File a compute draft as a notebook cell with provenance frontmatter. */
  insertComputeDraft(
    input: import('../../../shared/conversation-compute-drafts').InsertComputeDraftInput,
  ): Promise<import('../../../shared/conversation-compute-drafts').InsertComputeDraftResult>;
  /** Subscribe to note move/rename drafts from propose_note_rename/move (#912). */
  onRefactorDraft(
    cb: (draft: import('../../../shared/conversation-refactor-drafts').ConversationRefactorDraft) => void,
  ): void;
  /** Approve a refactor draft — file + apply the note-refactor proposal (#912). */
  fileRefactorDraft(
    draft: import('../../../shared/conversation-refactor-drafts').ConversationRefactorDraft,
  ): Promise<{ proposalUri: string | null; applied: boolean }>;
  /** Subscribe to batch reorganization plans from propose_reorganization (#914). */
  onReorgDraft(
    cb: (draft: import('../../../shared/conversation-refactor-drafts').ConversationReorgDraft) => void,
  ): void;
  /** Approve a reorg plan — file + apply the selected items as one ordered bundle (#914). */
  fileReorgDraft(
    draft: import('../../../shared/conversation-refactor-drafts').ConversationReorgDraft,
    selected: Array<{ fromPath: string; toPath: string }>,
  ): Promise<{ proposalUri: string | null; applied: boolean }>;
  /** Subscribe to batch deletions from propose_note_delete. */
  onDeleteDraft(
    cb: (draft: import('../../../shared/conversation-refactor-drafts').ConversationDeleteDraft) => void,
  ): void;
  /** Approve a deletion — file + apply the selected notes as one note-delete bundle. */
  fileDeleteDraft(
    draft: import('../../../shared/conversation-refactor-drafts').ConversationDeleteDraft,
    selected: string[],
  ): Promise<{ proposalUri: string | null; applied: boolean }>;
  /** Subscribe to in-place note rewrites from propose_note_body (#937). */
  onNoteBodyDraft(
    cb: (draft: import('../../../shared/conversation-note-body-drafts').ConversationNoteBodyDraft) => void,
  ): void;
  /** Approve a body rewrite — file + apply a note_rewrite proposal, then reload the open editor. */
  fileNoteBodyDraft(
    draft: import('../../../shared/conversation-note-body-drafts').ConversationNoteBodyDraft,
  ): Promise<import('../../../shared/conversation-note-body-drafts').FileNoteBodyDraftResult>;
}

export interface ProposalsApi {
  list(status?: string): Promise<unknown[]>;
  detail(uri: string): Promise<unknown>;
  approve(uri: string): Promise<boolean>;
  reject(uri: string): Promise<boolean>;
  expire(): Promise<number>;
  /** Fires when the pending-proposal set changes (in-app or routed from a
   *  CLI/MCP client) — the proposals store re-fetches on it (#1524). */
  onChanged(cb: () => void): void;
  /** Raise a native OS notification for an arrival while unfocused (#1541). */
  notifyArrival(arg: { count: number; proposer: string }): Promise<void>;
  /** Main → renderer: surface the Proposals panel (native notification clicked). */
  onShowRequested(cb: () => void): void;
}

export interface TabsApi {
  save(session: LayoutSession): Promise<void>;
  /** Returns the new multi-group format, or a legacy flat `TabSession` written
   *  by an older build — the renderer migrates the latter on load (#816). */
  load(): Promise<LayoutSession | TabSession | null>;
}

export interface RefactorApi {
  /** SUGGEST phase (#940): ask the LLM for tags; writes nothing. */
  autoTag(relativePath: string): Promise<{ added: string[] }>;
  /** APPLY phase (#940): file the accepted tags through the note_rewrite approval payload. */
  autoTagApply(relativePath: string, acceptedTags: string[]): Promise<{ applied: string[] }>;
  autoLinkSuggest(relativePath: string): Promise<{
    suggestions: import('../../../shared/refactor/auto-link').AutoLinkSuggestion[];
    candidateCount: number;
  }>;
  autoLinkApply(
    relativePath: string,
    accepted: import('../../../shared/refactor/auto-link').AutoLinkSuggestion[],
  ): Promise<{
    applied: import('../../../shared/refactor/auto-link').AutoLinkSuggestion[];
    skipped: import('../../../shared/refactor/auto-link').AutoLinkSuggestion[];
  }>;
  /** Accept a semantic suggested link — file `[[target]]` under "See also" (#840). */
  applySuggestedLink(activeRelPath: string, targetRelPath: string): Promise<{ changed: boolean }>;
  autoLinkInboundSuggest(relativePath: string): Promise<{
    suggestions: import('../../../shared/refactor/auto-link-inbound').AutoLinkInboundSuggestion[];
    candidateCount: number;
  }>;
  autoLinkInboundApply(
    relativePath: string,
    accepted: import('../../../shared/refactor/auto-link-inbound').AutoLinkInboundSuggestion[],
  ): Promise<{
    applied: import('../../../shared/refactor/auto-link-inbound').AutoLinkInboundSuggestion[];
    skipped: import('../../../shared/refactor/auto-link-inbound').AutoLinkInboundSuggestion[];
    touchedPaths: string[];
  }>;
}

export interface FormatterApi {
  formatContent(
    content: string,
    settings: import('../../../shared/formatter/engine').FormatSettings,
    relativePath?: string,
  ): Promise<string>;
  formatFile(
    relativePath: string,
    settings: import('../../../shared/formatter/engine').FormatSettings,
  ): Promise<import('../../../shared/formatter/types').FormatFileResult>;
  formatFolder(
    relDir: string,
    settings: import('../../../shared/formatter/engine').FormatSettings,
  ): Promise<{ changedPaths: string[]; cascadedPaths: string[]; totalScanned: number }>;
  loadSettings(): Promise<import('../../../shared/formatter/engine').FormatSettings>;
  saveSettings(settings: import('../../../shared/formatter/engine').FormatSettings): Promise<void>;
}

export interface ToolsApi {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
  prepareConversation(request: ToolExecutionRequest): Promise<ConversationToolPayload>;
  cancel(): Promise<void>;
  onStream(cb: (chunk: string) => void): void;
  getSettings(): Promise<import('../../../shared/tools/types').LLMSettingsView>;
  setSettings(update: import('../../../shared/tools/types').LLMSettingsUpdate): Promise<void>;
  getKeyStorage(): Promise<import('../../../shared/tools/types').ApiKeyStorage>;
  /** Actively validate a provider's credentials. Pass the unsaved typed key
   *  (and baseURL, for local) to test before saving; omit/empty to test the
   *  stored values (BYOM #1498). */
  checkConnection(
    providerId: import('../../../shared/tools/providers').ProviderId,
    candidateKey?: string,
    baseURL?: string,
  ): Promise<import('../../../shared/tools/types').ConnectionCheckResult>;
  onInvoke(cb: (toolId: string) => void): void;
}

export interface TypesApi {
  /** The current project's type catalog (stock + in-tree user types, #1062). */
  list(): Promise<import('../../../shared/objects/type-def').TypeCatalogInfo>;
  /** A note's declared properties + current values, keyed to its type (#1063). */
  noteProperties(relativePath: string): Promise<import('../../../shared/objects/type-def').NoteTypedProperties>;
  /** Every instance of a type + its property values, for the multi-view (#1070). */
  instances(typeId: string): Promise<import('../../../shared/objects/type-def').TypeInstancesResult>;
  /** Save a user object type — "Save Note as Object Type" + the Type Manager. */
  save(input: { label: string; properties: import('../../../shared/objects/type-def').PropertyDef[]; icon?: string; color?: string; cover?: string; card?: string[]; template?: string }): Promise<{ id: string; filePath: string }>;
  /** Delete a user object type by id (#1584). */
  delete(id: string): Promise<void>;
}

export interface SkillsApi {
  list(): Promise<import('../../../shared/skills/types').SkillCatalogInfo>;
  reload(): Promise<import('../../../shared/skills/types').SkillCatalogInfo>;
  /** Pick a .md file or skill folder and import it. Returns null on cancel. */
  import(): Promise<{ id: string; name: string } | null>;
  remove(id: string): Promise<void>;
  revealFolder(): Promise<void>;
  /** Persist the per-machine menu config; returns the normalized config. */
  setMenuConfig(
    config: import('../../../shared/skills/menu-config').MenuConfig,
  ): Promise<import('../../../shared/skills/menu-config').MenuConfig>;
}

export interface MenuApi {
  onNewNote(cb: () => void): void;
  onEditThoughtbaseDoc(cb: () => void): void;
  onThoughtbaseProperties(cb: () => void): void;
  onSave(cb: () => void): void;
  onSaveAsTemplate(cb: () => void): void;
  onSaveAsObjectType(cb: () => void): void;
  onInsertTemplate(cb: () => void): void;
  onToggleSidebar(cb: () => void): void;
  onTogglePreview(cb: () => void): void;
  onQuickOpen(cb: () => void): void;
  onCycleTheme(cb: () => void): void;
  onSetTheme(cb: (mode: ThemeMode) => void): void;
  reportTheme(mode: ThemeMode): void;
  reportEditorState(state: MenuEditorState): void;
  onSplitRight(cb: () => void): void;
  onSplitDown(cb: () => void): void;
  onFocusNextGroup(cb: () => void): void;
  onFocusPrevGroup(cb: () => void): void;
  onCloseGroup(cb: () => void): void;
  onFontIncrease(cb: () => void): void;
  onFontDecrease(cb: () => void): void;
  onFontReset(cb: () => void): void;
  onToggleRightSidebar(cb: () => void): void;
  onToggleConversations(cb: () => void): void;
  onNewConversation(cb: () => void): void;
  onNavBack(cb: () => void): void;
  onNavForward(cb: () => void): void;
  onGotoLine(cb: () => void): void;
  onFind(cb: () => void): void;
  onFindReplace(cb: () => void): void;
  onFindInNotes(cb: () => void): void;
  onReplaceInNotes(cb: () => void): void;
  onNewQuery(cb: () => void): void;
  onOpenStockQuery(cb: (payload: { query: string; language: 'sparql' | 'sql' }) => void): void;
  onEditSavedQueries(cb: () => void): void;
  onSortLines(cb: () => void): void;
  onOpenSettings(cb: () => void): void;
  onPrint(cb: () => void): void;
  onAbout(cb: () => void): void;
  onShortcuts(cb: () => void): void;
  onOpenInDefault(cb: () => void): void;
  onOpenInTerminal(cb: () => void): void;
  onOpenProject(cb: () => void): void;
  onNewProject(cb: () => void): void;
  onInstallTutorial(cb: () => void): void;
  onOpenRecentProject(cb: (path: string) => void): void;
  onCloseProject(cb: () => void): void;
  onClearRecent(cb: () => void): void;
  onProjectOpened(cb: (meta: { rootPath: string; name: string }) => void): void;
  onRefactorRename(cb: () => void): void;
  onRefactorMove(cb: () => void): void;
  onRefactorCopy(cb: () => void): void;
  onRefactorExtract(cb: () => void): void;
  onRefactorSplitHere(cb: () => void): void;
  onRefactorSplitByHeading(cb: () => void): void;
  onRefactorAutoTag(cb: () => void): void;
  onRefactorAutoLink(cb: () => void): void;
  onRefactorAutoLinkInbound(cb: () => void): void;
  onRefactorDecompose(cb: () => void): void;
  onFormat(cb: () => void): void;
  onBibliography(cb: () => void): void;
  onIngestUrl(cb: () => void): void;
  onIngestIdentifier(cb: () => void): void;
  onIngestFile(cb: () => void): void;
  onExport(cb: (exporterId: string) => void): void;
  onPublish(cb: () => void): void;
  onImportBibtex(cb: () => void): void;
  onImportZoteroRdf(cb: () => void): void;
}

export interface IdeApi {
  notebase: NotebaseApi;
  links: LinksApi;
  queries: QueriesApi;
  views: ViewsApi;
  search: SearchApi;
  git: GitApi;
  graph: GraphApi;
  tables: TablesApi;
  embeddings: EmbeddingsApi;
  tags: TagsApi;
  templates: TemplatesApi;
  export: ExportApi;
  files: FilesApi;
  compute: ComputeApi;
  publish: PublishApi;
  shell: ShellApi;
  app: AppApi;
  images: ImagesApi;
  youtube: YoutubeApi;
  view: ViewApi;
  bookmarks: BookmarksApi;
  clipper: ClipperApi;
  conversations: ConversationsApi;
  proposals: ProposalsApi;
  tabs: TabsApi;
  tools: ToolsApi;
  types: TypesApi;
  skills: SkillsApi;
  refactor: RefactorApi;
  formatter: FormatterApi;
  sources: SourcesApi;
  collections: CollectionsApi;
  sites: SitesApi;
  bibliography: BibliographyApi;
  csl: CslApi;
  citations: CitationsApi;
  menu: MenuApi;
}

export interface CitationsApi {
  renderInline(refs: { kind: 'cite' | 'quote'; id: string }[]): Promise<{
    markers: string[];
    bibliography: string[] | null;
    missing: string[];
    styleId: string;
  }>;
}

export interface SitesApi {
  list(): Promise<import('../../../shared/types').PrivilegedSite[]>;
  add(domain: string, label?: string): Promise<import('../../../shared/types').PrivilegedSite>;
  remove(id: string): Promise<void>;
  login(id: string): Promise<void>;
  logout(id: string): Promise<void>;
}

export interface BibliographyApi {
  /** List bundled + user-imported styles. `isUser` flags entries from `.minerva/csl-styles/` so the UI can render them differently. */
  listStyles(): Promise<{ id: string; label: string; isUser?: boolean }[]>;
  getStyle(): Promise<string>;
  setStyle(styleId: string): Promise<void>;
  generate(relativePath: string): Promise<{
    entriesCount: number;
    missingIds: string[];
    changed: boolean;
    styleId: string;
  }>;
}

/**
 * User-imported CSL assets (#302). Project-scoped; files live under
 * `.minerva/csl-styles/` and `.minerva/csl-locales/` so they travel with
 * the thoughtbase via git.
 */
export interface CslApi {
  listUserStyles(): Promise<{ id: string; label: string; filePath: string }[]>;
  listUserLocales(): Promise<{ id: string; filePath: string }[]>;
  /** Open a file picker, validate, copy into `.minerva/csl-styles/`. Returns `null` when the user cancels. */
  importStyle(): Promise<{ id: string; label: string; filePath: string } | null>;
  importLocale(): Promise<{ id: string; filePath: string } | null>;
  removeStyle(id: string): Promise<void>;
  removeLocale(id: string): Promise<void>;
}


export interface SourcesApi {
  /** Ingest a URL: fetches, runs Readability, persists under .minerva/sources/<id>/. */
  ingestUrl(url: string): Promise<{
    sourceId: string;
    relativePath: string;
    duplicate: boolean;
    title: string;
    /** 'web' for an HTML page; 'pdf' when the URL served a PDF (routed to the
     *  PDF pipeline). */
    kind?: 'web' | 'pdf' | 'text';
    /** Page count when kind === 'pdf'. */
    pageCount?: number;
    /** True when a PDF URL had no text layer and needs OCR. */
    needsOcr?: boolean;
  }>;
  /** Ingest a DOI / arXiv id / PubMed id via the matching bibliographic API. */
  ingestIdentifier(identifier: string): Promise<{
    sourceId: string;
    relativePath: string;
    duplicate: boolean;
    title: string;
    kind: 'doi' | 'arxiv' | 'pubmed';
    pdfSaved: boolean;
    pdfError: string | null;
  }>;
  /** Open an OS file picker and ingest the selected file as a source — PDF, HTML,
   *  or text/Markdown. Returns null if cancelled. */
  ingestFile(): Promise<{
    sourceId: string;
    relativePath: string;
    duplicate: boolean;
    title: string;
    kind?: 'web' | 'pdf' | 'text';
    /** Page count when kind === 'pdf'. */
    pageCount?: number;
    /** True if a PDF has no text layer; caller should run OCR via readPdf + finishPdfOcr. */
    needsOcr?: boolean;
  } | null>;
  /** Read raw bytes of a persisted source's original.pdf (#95). */
  readPdf(sourceId: string): Promise<Uint8Array>;
  /** True iff `.minerva/sources/<id>/original.pdf` exists. Used by the
   *  source detail UI to decide whether to show the PDF affordance. */
  hasPdf(sourceId: string): Promise<boolean>;
  /** Per-project default folder for excerpt-derived notes (#101).
   *  Returns '' = project root. */
  getExcerptNoteFolder(): Promise<string>;
  setExcerptNoteFolder(folder: string): Promise<void>;
  /** Hand per-page OCR'd text back to main; it writes body.md + stamps meta.ttl (#95). */
  finishPdfOcr(sourceId: string, pages: string[]): Promise<void>;
  /** Open a .bib picker and bulk-import every entry (#98). Returns null if cancelled. */
  importBibtex(): Promise<{
    imported: Array<{ sourceId: string; title: string }>;
    duplicate: Array<{ sourceId: string; title: string }>;
    failed: Array<{ key: string; reason: string }>;
    parseErrors: number;
    totalEntries: number;
  } | null>;
  /** Stream progress while a BibTeX import runs. */
  onImportBibtexProgress(cb: (progress: { done: number; total: number; currentTitle: string }) => void): void;
  /** Open a .rdf picker and import a Zotero RDF export (#270). Returns null if cancelled. */
  importZoteroRdf(): Promise<{
    imported: Array<{ sourceId: string; title: string; pdfAttached: boolean }>;
    duplicate: Array<{ sourceId: string; title: string }>;
    failed: Array<{ subject: string; reason: string }>;
    totalItems: number;
  } | null>;
  /** Stream progress while a Zotero RDF import runs. */
  onImportZoteroRdfProgress(cb: (progress: { done: number; total: number; currentTitle: string }) => void): void;
  /** All indexed sources, sorted by title. */
  listAll(): Promise<import('../../../shared/types').SourceMetadata[]>;
  /** Delete a source + cascade-delete its excerpts. */
  delete(sourceId: string): Promise<{ sourceId: string; excerptsRemoved: number }>;
  /** Merge src into dest: dest keeps its identity but gains any
   *  metadata fields / body / artifacts src had and dest didn't. All
   *  excerpts of src move to dest; every `[[cite::src]]` is rewritten
   *  to `[[cite::dest]]`. Src folder is removed. (#90) */
  merge(srcId: string, destId: string): Promise<{
    destId: string;
    removedId: string;
    excerptsMoved: number;
    notesRewritten: number;
    metadataAdded: string[];
    artifactsCopied: string[];
  }>;
  /** Set / change / clear a source's reading-queue status (#116). */
  setReadStatus(sourceId: string, status: import('../../../shared/types').ReadStatus | null): Promise<void>;
  /** Rename a source (upsert dc:title) (#765). */
  setTitle(sourceId: string, title: string): Promise<void>;
  /** Set / change / clear a source's due-by date (ISO YYYY-MM-DD). */
  setReadDueBy(sourceId: string, dueBy: string | null): Promise<void>;
  /** Add a user tag to a source (#766). */
  addTag(sourceId: string, tag: string): Promise<void>;
  /** Remove a tag from a source (#766). */
  removeTag(sourceId: string, tag: string): Promise<void>;
  /** Resolve a built-in Reading Queue view against the live graph. */
  queueMembers(view: 'unread' | 'reading' | 'dueThisWeek' | 'recentlyFinished'):
    Promise<import('../../../shared/types').SourceMetadata[]>;
  /** Strip API-derived `minerva:upstreamTag` triples from a source.
   *  Returns the count of dropped tags. */
  stripUpstreamTags(sourceId: string): Promise<{ removed: number }>;
  /** Per-machine ingest preferences (#473). */
  getIngestSettings(): Promise<{ importUpstreamTags: boolean }>;
  setIngestSettings(settings: { importUpstreamTags: boolean }): Promise<void>;
  /** Smart-route ingest: detect DOI / arXiv id / PMID / URL in
   *  `rawInput` and dispatch to the matching ingest path (#473). */
  ingestSmart(rawInput: string): Promise<{
    sourceId: string;
    duplicate: boolean;
    title: string;
    route: 'identifier' | 'url';
  }>;
  /** Mine a source's References section via the LLM. Returns the
   *  parsed candidates for user approval; no stubs are written until
   *  `createReferenceStubs` is called. (#106) */
  mineReferences(sourceId: string): Promise<import('../../../shared/mine-references').ParsedReference[]>;
  /** Materialise approved references as stub sources + add
   *  `minerva:references` edges from the parent (#106). */
  createReferenceStubs(sourceId: string, refs: import('../../../shared/mine-references').ParsedReference[]): Promise<{
    created: { sourceId: string; title: string }[];
    matchedExisting: { sourceId: string; title: string }[];
    skipped: { reason: string; raw: string }[];
  }>;
  /** Resolve a stub source by searching CrossRef. Returns top-3
   *  candidates ranked by confidence (#107). */
  resolveStub(sourceId: string): Promise<import('../../../shared/resolve-stub').ResolveCandidate[]>;
  /** Apply the user-picked DOI to a stub source. Rewrites the
   *  meta.ttl with full CrossRef metadata and flips stubStatus to
   *  "resolved". (#107) */
  applyStubResolution(sourceId: string, doi: string): Promise<{ ok: boolean }>;
  /** Fires when a source is added, updated, or removed. */
  onChanged(cb: () => void): void;
  /** Create a `thought:Excerpt` from a highlighted passage. Idempotent by (sourceId, citedText). */
  createExcerpt(params: {
    sourceId: string;
    citedText: string;
    page?: number | null;
    pageRange?: string | null;
    locationText?: string | null;
  }): Promise<{ excerptId: string; relativePath: string; duplicate: boolean }>;
  /** Fires when an excerpt is added, updated, or removed. */
  onExcerptsChanged(cb: () => void): void;
}

/** Source collections (#470). */
export interface CollectionsApi {
  list(): Promise<import('../../../shared/types').CollectionsFile>;
  create(args: { name: string; parent?: string | null }): Promise<import('../../../shared/types').Collection>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  addSource(collectionId: string, sourceId: string): Promise<void>;
  removeSource(collectionId: string, sourceId: string): Promise<void>;
  /** Smart-collection CRUD (#470 phase 2 — tag predicate). */
  createSmart(args: { name: string; predicate: import('../../../shared/types').SmartCollectionPredicate }):
    Promise<import('../../../shared/types').SmartCollection>;
  renameSmart(id: string, name: string): Promise<void>;
  removeSmart(id: string): Promise<void>;
  updateSmartPredicate(id: string, predicate: import('../../../shared/types').SmartCollectionPredicate): Promise<void>;
  /** Resolve a smart collection's members against the live graph. */
  smartMembers(id: string): Promise<import('../../../shared/types').SourceMetadata[]>;
  /** Fires when a collection (manual or smart) is added, renamed,
   *  deleted, or its membership changes. */
  onChanged(cb: () => void): void;
}

declare global {
  interface Window {
    api: IdeApi;
  }
}

export const api: IdeApi = window.api;
