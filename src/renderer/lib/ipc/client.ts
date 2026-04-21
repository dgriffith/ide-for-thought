import type { NoteFile, NotebaseMeta, TagInfo, TaggedNote, TaggedSource, SavedQuery, SearchResult, OutgoingLink, Backlink, TabSession, Conversation, ContextBundle, ConversationMessage, BookmarkNode, SourceDetail } from '../../../shared/types';
import type { ToolExecutionRequest, ToolExecutionResult, LLMSettings, ConversationToolPayload } from '../../../shared/tools/types';

export interface NotebaseApi {
  open(): Promise<NotebaseMeta | null>;
  openPath(rootPath: string): Promise<NotebaseMeta>;
  newProject(): Promise<NotebaseMeta | null>;
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
}

export interface QueriesApi {
  list(): Promise<SavedQuery[]>;
  save(scope: string, name: string, description: string, query: string): Promise<SavedQuery>;
  delete(filePath: string): Promise<void>;
}

export interface SearchApi {
  query(query: string): Promise<SearchResult[]>;
}

export interface GitApi {
  status(): Promise<{ files: unknown[] }>;
  commit(message: string): Promise<{ success: boolean; message: string }>;
}

export interface GraphApi {
  query(sparql: string): Promise<{ results: unknown[] }>;
  rebuild(): Promise<{ count: number }>;
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

export interface TagsApi {
  list(): Promise<TagInfo[]>;
  notesByTag(tag: string): Promise<TaggedNote[]>;
  sourcesByTag(tag: string): Promise<TaggedSource[]>;
  allNames(): Promise<string[]>;
}

export interface ExportApi {
  csv(csv: string): Promise<void>;
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
  detail(uri: string): Promise<unknown | null>;
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
  ): Promise<string>;
  formatFile(
    relativePath: string,
    settings: import('../../../shared/formatter/engine').FormatSettings,
  ): Promise<import('../../../shared/formatter/types').FormatFileResult>;
  formatFolder(
    relDir: string,
    settings: import('../../../shared/formatter/engine').FormatSettings,
  ): Promise<{ changedPaths: string[]; totalScanned: number }>;
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
  onNewQuery(cb: () => void): void;
  onSaveQuery(cb: () => void): void;
  onOpenStockQuery(cb: (query: string) => void): void;
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
}

export interface IdeApi {
  notebase: NotebaseApi;
  links: LinksApi;
  queries: QueriesApi;
  search: SearchApi;
  git: GitApi;
  graph: GraphApi;
  tags: TagsApi;
  export: ExportApi;
  shell: ShellApi;
  bookmarks: BookmarksApi;
  conversations: ConversationsApi;
  proposals: ProposalsApi;
  tabs: TabsApi;
  tools: ToolsApi;
  refactor: RefactorApi;
  formatter: FormatterApi;
  menu: MenuApi;
}

declare global {
  interface Window {
    api: IdeApi;
  }
}

export const api: IdeApi = window.api;
