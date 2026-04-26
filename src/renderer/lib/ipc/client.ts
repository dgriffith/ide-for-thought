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
  writeFile(relativePath: string, content: string): Promise<void>;
  createFile(relativePath: string): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
  createFolder(relativePath: string): Promise<void>;
  deleteFolder(relativePath: string): Promise<void>;
  rename(oldRelPath: string, newRelPath: string): Promise<void>;
  copy(srcRelPath: string, destRelPath: string): Promise<void>;
  searchInNotes(opts: SearchInNotesOptions): Promise<SearchInNotesFileResult[]>;
  replaceInNotes(opts: ReplaceInNotesOptions): Promise<ReplaceInNotesResult>;
  onFileChanged(cb: (path: string) => void): void;
  onFileCreated(cb: (path: string) => void): void;
  onFileDeleted(cb: (path: string) => void): void;
  onRenamed(cb: (transitions: Array<{ old: string; new: string }>) => void): void;
  onRewritten(cb: (paths: string[]) => void): void;
  onHeadingRenameSuggested(cb: (candidate: HeadingRenameCandidate) => void): void;
  renameAnchor(targetRelativePath: string, oldSlug: string, newSlug: string): Promise<{ rewrittenPaths: string[] }>;
  renameSource(oldId: string, newId: string): Promise<{ rewrittenPaths: string[] }>;
  renameExcerpt(oldId: string, newId: string): Promise<{ rewrittenPaths: string[] }>;
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
}

export interface QueriesApi {
  list(): Promise<SavedQuery[]>;
  save(scope: string, name: string, description: string, query: string, language: 'sparql' | 'sql'): Promise<SavedQuery>;
  delete(filePath: string): Promise<void>;
  rename(filePath: string, newName: string): Promise<string>;
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

export interface ExportPreviewPlan {
  exporterId: string;
  exporterLabel: string;
  inputs: Array<{ relativePath: string; kind: 'note' | 'source' | 'excerpt'; title: string }>;
  excluded: Array<{ relativePath: string; reason: string }>;
}

export type ExportInputKind = 'single-note' | 'folder' | 'project' | 'tree';

export interface RunExportInput {
  exporterId: string;
  input: {
    kind: ExportInputKind;
    relativePath?: string;
    maxDepth?: number;
  };
  outputDir: string;
  linkPolicy?: 'drop' | 'inline-title' | 'follow-to-file';
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
    opts?: { exporterId?: string; linkPolicy?: RunExportInput['linkPolicy'] },
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
   */
  saveCellOutput(input: {
    sourcePath: string;
    cellLanguage: string;
    cellCode: string;
    output: import('../../../shared/compute/types').CellOutput;
    destPath?: string;
    title?: string;
  }): Promise<{ derivedPath: string; cellId: string; injectedId: boolean }>;
  /** Wipe and respawn the project's Python kernel — palette command
   *  "Compute: Restart Python Kernel". Loses every notebook's namespace. */
  restartPythonKernel(): Promise<void>;
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
  resolve(id: string): Promise<Conversation>;
  abandon(id: string): Promise<Conversation>;
  load(id: string): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  listActive(): Promise<Conversation[]>;
  send(convId: string, userMessage: string, systemPrompt?: string): Promise<Conversation>;
  onStream(cb: (chunk: string) => void): void;
  cancel(): Promise<void>;
  crystallize(text: string, conversationId: string): Promise<{ turtle: string; componentCount: number }>;
  slashCommand(convId: string, slashCmd: string, argText: string): Promise<Conversation>;
  setModel(conversationId: string, model: string | undefined): Promise<Conversation>;
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
  decomposeSuggest(
    relativePath: string,
    hints?: { normalizeHeadings?: boolean; transcludeByDefault?: boolean },
  ): Promise<{
    proposal: import('../../../shared/refactor/decompose').DecomposeProposal | null;
    error?: string;
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
  onFormatCurrentNote(cb: () => void): void;
  onFormatFolder(cb: () => void): void;
  onFormatAll(cb: () => void): void;
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
  menu: MenuApi;
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

declare global {
  interface Window {
    api: IdeApi;
  }
}

export const api: IdeApi = window.api;
