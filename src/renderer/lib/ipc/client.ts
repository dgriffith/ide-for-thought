import type { NoteFile, NotebaseMeta, TagInfo, TaggedNote, TaggedSource, SavedQuery, SearchResult, OutgoingLink, Backlink, TabSession, Conversation, ContextBundle, ConversationMessage, BookmarkNode, SourceDetail } from '../../../shared/types';
import type { ToolExecutionRequest, ToolExecutionResult, LLMSettings, ConversationToolPayload } from '../../../shared/tools/types';

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

export interface SearchApi {
  query(query: string): Promise<SearchResult[]>;
}

export interface GitApi {
  status(): Promise<{ files: unknown[] }>;
  commit(message: string): Promise<{ success: boolean; message: string }>;
}

export interface GraphApi {
  query(sparql: string): Promise<{ results: unknown[]; error?: string }>;
  groundCheck(claimText: string): Promise<{ node: string; label: string; type: string }[]>;
  inspections(): Promise<{ id: string; type: string; severity: string; nodeUri: string; nodeLabel: string; message: string; suggestedAction?: string }[]>;
  runInspections(): Promise<{ id: string; type: string; severity: string; nodeUri: string; nodeLabel: string; message: string; suggestedAction?: string }[]>;
  export(): Promise<void>;
  sourceDetail(sourceId: string): Promise<SourceDetail | null>;
  excerptSource(excerptId: string): Promise<{ sourceId: string } | null>;
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
  relativePath: string;
  columns: string[];
  rowCount: number;
}

export interface TablesApi {
  query(sql: string): Promise<TablesQueryResult>;
  list(): Promise<TableInfo[]>;
  /** Fires when a CSV is registered/unregistered or the initial scan completes. */
  onChanged(cb: () => void): void;
}

export interface TagsApi {
  list(): Promise<TagInfo[]>;
  notesByTag(tag: string): Promise<TaggedNote[]>;
  /** Notes with any tag at-or-under `prefix` (#466). */
  notesByTagPrefix(prefix: string): Promise<TaggedNote[]>;
  sourcesByTag(tag: string): Promise<TaggedSource[]>;
  allNames(): Promise<string[]>;
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
import type { CellResult } from '../../../shared/compute/types';

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
  listExporters(): Promise<Array<{ id: string; label: string; acceptedKinds: ExportInputKind[] }>>;
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
}

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
  getPythonSettings(): Promise<{ pythonPath: string }>;
  setPythonSettings(settings: { pythonPath: string }): Promise<void>;
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
   * Per-project Python trust flag (#373). The renderer-side guard
   * around `runCell` consults this before firing a Python execution;
   * the first-run trust dialog calls `setPythonTrust(true)` when
   * the user clicks Run. */
  getPythonTrust(): Promise<boolean>;
  setPythonTrust(trusted: boolean): Promise<void>;
}

export interface ShellApi {
  revealFile(relativePath?: string): Promise<void>;
  openInDefault(relativePath: string): Promise<void>;
  openInTerminal(relativePath?: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}

export interface BookmarksApi {
  load(): Promise<BookmarkNode[]>;
  save(tree: BookmarkNode[]): Promise<void>;
}

export interface ConversationsApi {
  create(contextBundle: ContextBundle, triggerNodeUri?: string, options?: { systemPrompt?: string; model?: string }): Promise<Conversation>;
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
}

export interface ProposalsApi {
  list(status?: string): Promise<unknown[]>;
  detail(uri: string): Promise<unknown>;
  approve(uri: string): Promise<boolean>;
  reject(uri: string): Promise<boolean>;
  expire(): Promise<number>;
}

export interface TabsApi {
  save(session: TabSession): Promise<void>;
  load(): Promise<TabSession | null>;
}

export interface RefactorApi {
  autoTag(relativePath: string): Promise<{ added: string[] }>;
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
  getSettings(): Promise<LLMSettings>;
  setSettings(settings: LLMSettings): Promise<void>;
  onInvoke(cb: (toolId: string) => void): void;
}

export interface MenuApi {
  onNewNote(cb: () => void): void;
  onSave(cb: () => void): void;
  onToggleSidebar(cb: () => void): void;
  onTogglePreview(cb: () => void): void;
  onQuickOpen(cb: () => void): void;
  onCycleTheme(cb: () => void): void;
  onFontIncrease(cb: () => void): void;
  onFontDecrease(cb: () => void): void;
  onFontReset(cb: () => void): void;
  onToggleRightSidebar(cb: () => void): void;
  onToggleConversations(cb: () => void): void;
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
  onOpenInDefault(cb: () => void): void;
  onOpenInTerminal(cb: () => void): void;
  onOpenProject(cb: () => void): void;
  onNewProject(cb: () => void): void;
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
  onIngestPdf(cb: () => void): void;
  onExport(cb: (exporterId: string) => void): void;
  onImportBibtex(cb: () => void): void;
  onImportZoteroRdf(cb: () => void): void;
}

export interface IdeApi {
  notebase: NotebaseApi;
  links: LinksApi;
  queries: QueriesApi;
  search: SearchApi;
  git: GitApi;
  graph: GraphApi;
  tables: TablesApi;
  tags: TagsApi;
  export: ExportApi;
  files: FilesApi;
  compute: ComputeApi;
  publish: PublishApi;
  shell: ShellApi;
  bookmarks: BookmarksApi;
  conversations: ConversationsApi;
  proposals: ProposalsApi;
  tabs: TabsApi;
  tools: ToolsApi;
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
  /** Open an OS file picker and ingest the selected PDF (#94). Returns null if cancelled. */
  ingestPdf(): Promise<{
    sourceId: string;
    relativePath: string;
    duplicate: boolean;
    title: string;
    pageCount: number;
    /** True if the PDF has no text layer; caller should run OCR via readPdf + finishPdfOcr. */
    needsOcr: boolean;
  } | null>;
  /** Read raw bytes of a persisted source's original.pdf (#95). */
  readPdf(sourceId: string): Promise<Uint8Array>;
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
  /** Set / change / clear a source's due-by date (ISO YYYY-MM-DD). */
  setReadDueBy(sourceId: string, dueBy: string | null): Promise<void>;
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
