import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { Channels } from '../shared/channels';

/**
 * Subscribe to an IPC channel and forward the typed payload to `cb`.
 * Centralises the unavoidable cast at the IPC boundary — the main
 * process owns the wire shape, so each subscriber names what it expects.
 */
function subscribeIpc<T>(channel: string, cb: (payload: T) => void): void {
  ipcRenderer.on(channel, (_e, payload: unknown) => cb(payload as T));
}

contextBridge.exposeInMainWorld('api', {
  notebase: {
    open: () => ipcRenderer.invoke(Channels.NOTEBASE_OPEN),
    openPath: (rootPath: string) => ipcRenderer.invoke('notebase:openPath', rootPath),
    newProject: () => ipcRenderer.invoke('notebase:newProject'),
    openInNewWindow: () => ipcRenderer.invoke('notebase:openInNewWindow'),
    newProjectInNewWindow: () => ipcRenderer.invoke('notebase:newProjectInNewWindow'),
    openPathInNewWindow: (rootPath: string) => ipcRenderer.invoke('notebase:openPathInNewWindow', rootPath),
    close: () => ipcRenderer.invoke('notebase:close'),
    clearRecent: () => ipcRenderer.invoke('recent:clear'),
    listFiles: () => ipcRenderer.invoke(Channels.NOTEBASE_LIST_FILES),
    readFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_READ_FILE, relativePath),
    writeFile: (relativePath: string, content: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_WRITE_FILE, relativePath, content),
    createFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_CREATE_FILE, relativePath),
    deleteFile: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_DELETE_FILE, relativePath),
    createFolder: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_CREATE_FOLDER, relativePath),
    deleteFolder: (relativePath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_DELETE_FOLDER, relativePath),
    rename: (oldRelPath: string, newRelPath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_RENAME, oldRelPath, newRelPath),
    copy: (srcRelPath: string, destRelPath: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_COPY, srcRelPath, destRelPath),
    searchInNotes: (opts: unknown) => ipcRenderer.invoke(Channels.NOTEBASE_SEARCH_IN_NOTES, opts),
    replaceInNotes: (opts: unknown) => ipcRenderer.invoke(Channels.NOTEBASE_REPLACE_IN_NOTES, opts),
    onFileChanged: (cb: (path: string) => void) => subscribeIpc(Channels.NOTEBASE_FILE_CHANGED, cb),
    onFileCreated: (cb: (path: string) => void) => subscribeIpc(Channels.NOTEBASE_FILE_CREATED, cb),
    onFileDeleted: (cb: (path: string) => void) => subscribeIpc(Channels.NOTEBASE_FILE_DELETED, cb),
    onRenamed: (cb: (transitions: Array<{ old: string; new: string }>) => void) =>
      subscribeIpc(Channels.NOTEBASE_RENAMED, cb),
    onRewritten: (cb: (paths: string[]) => void) => subscribeIpc(Channels.NOTEBASE_REWRITTEN, cb),
    onHeadingRenameSuggested: (cb: (candidate: {
      relativePath: string;
      oldSlug: string;
      oldText: string;
      newSlug: string;
      newText: string;
      incomingLinkCount: number;
    }) => void) => subscribeIpc(Channels.NOTEBASE_HEADING_RENAME_SUGGESTED, cb),
    renameAnchor: (targetRelativePath: string, oldSlug: string, newSlug: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_RENAME_ANCHOR, targetRelativePath, oldSlug, newSlug),
    renameSource: (oldId: string, newId: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_RENAME_SOURCE, oldId, newId),
    renameExcerpt: (oldId: string, newId: string) =>
      ipcRenderer.invoke(Channels.NOTEBASE_RENAME_EXCERPT, oldId, newId),
  },
  links: {
    outgoing: (relativePath: string) => ipcRenderer.invoke(Channels.LINKS_OUTGOING, relativePath),
    backlinks: (relativePath: string) => ipcRenderer.invoke(Channels.LINKS_BACKLINKS, relativePath),
    bundle: (relativePath: string) => ipcRenderer.invoke(Channels.LINKS_BUNDLE, relativePath),
  },
  queries: {
    list: () => ipcRenderer.invoke(Channels.QUERIES_LIST),
    save: (scope: string, name: string, description: string, query: string, language: string, group: string | null = null) =>
      ipcRenderer.invoke(Channels.QUERIES_SAVE, scope, name, description, query, language, group),
    delete: (filePath: string) => ipcRenderer.invoke(Channels.QUERIES_DELETE, filePath),
    rename: (filePath: string, newName: string) => ipcRenderer.invoke(Channels.QUERIES_RENAME, filePath, newName),
    move: (filePath: string, newScope: 'project' | 'global') =>
      ipcRenderer.invoke(Channels.QUERIES_MOVE, filePath, newScope),
    setGroup: (filePath: string, group: string | null) =>
      ipcRenderer.invoke(Channels.QUERIES_SET_GROUP, filePath, group),
    setOrder: (entries: Array<{ filePath: string; order: number | null }>) =>
      ipcRenderer.invoke(Channels.QUERIES_SET_ORDER, entries),
  },
  search: {
    query: (query: string) => ipcRenderer.invoke(Channels.SEARCH_QUERY, query),
  },
  git: {
    status: () => ipcRenderer.invoke(Channels.GIT_STATUS),
    commit: (message: string) => ipcRenderer.invoke(Channels.GIT_COMMIT, message),
  },
  graph: {
    query: (sparql: string) => ipcRenderer.invoke(Channels.GRAPH_QUERY, sparql),
    groundCheck: (claimText: string) => ipcRenderer.invoke(Channels.GRAPH_GROUND_CHECK, claimText),
    inspections: () => ipcRenderer.invoke(Channels.INSPECTIONS_LIST),
    runInspections: () => ipcRenderer.invoke(Channels.INSPECTIONS_RUN),
    export: () => ipcRenderer.invoke(Channels.GRAPH_EXPORT),
    sourceDetail: (sourceId: string) => ipcRenderer.invoke(Channels.GRAPH_SOURCE_DETAIL, sourceId),
    excerptSource: (excerptId: string) => ipcRenderer.invoke(Channels.GRAPH_EXCERPT_SOURCE, excerptId),
    schemaForCompletion: () => ipcRenderer.invoke(Channels.GRAPH_SCHEMA_FOR_COMPLETION),
  },
  tables: {
    query: (sql: string) => ipcRenderer.invoke(Channels.TABLES_QUERY, sql),
    list: () => ipcRenderer.invoke(Channels.TABLES_LIST),
    onChanged: (cb: () => void) => {
      ipcRenderer.on(Channels.TABLES_CHANGED, () => cb());
    },
  },
  tags: {
    list: () => ipcRenderer.invoke(Channels.TAGS_LIST),
    notesByTag: (tag: string) => ipcRenderer.invoke(Channels.TAGS_NOTES_BY_TAG, tag),
    sourcesByTag: (tag: string) => ipcRenderer.invoke(Channels.TAGS_SOURCES_BY_TAG, tag),
    allNames: () => ipcRenderer.invoke(Channels.TAGS_ALL_NAMES),
  },
  export: {
    csv: (csv: string) => ipcRenderer.invoke(Channels.EXPORT_CSV, csv),
  },
  files: {
    // Resolve a DataTransfer File to its absolute disk path. Electron ≥ 32:
    // `File.path` was deprecated and removed in 34; webUtils is the forward-
    // compatible accessor and works in preload where `electron` is in scope.
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    dropImport: (targetFolder: string, localPaths: string[]) =>
      ipcRenderer.invoke(Channels.FILES_DROP_IMPORT, targetFolder, localPaths),
  },
  compute: {
    runCell: (language: string, code: string, notePath?: string) =>
      ipcRenderer.invoke(Channels.COMPUTE_RUN_CELL, language, code, notePath),
    languages: () => ipcRenderer.invoke(Channels.COMPUTE_LANGUAGES),
    saveCellOutput: (input: unknown) =>
      ipcRenderer.invoke(Channels.COMPUTE_SAVE_CELL_OUTPUT, input),
    restartPythonKernel: () => ipcRenderer.invoke(Channels.COMPUTE_RESTART_PYTHON_KERNEL),
  },
  publish: {
    listExporters: () => ipcRenderer.invoke(Channels.PUBLISH_LIST_EXPORTERS),
    resolvePlan: (input: unknown, opts: unknown) =>
      ipcRenderer.invoke(Channels.PUBLISH_RESOLVE_PLAN, input, opts),
    runExport: (args: unknown) => ipcRenderer.invoke(Channels.PUBLISH_RUN_EXPORT, args),
  },
  shell: {
    revealFile: (relativePath?: string) =>
      ipcRenderer.invoke(Channels.SHELL_REVEAL_FILE, relativePath),
    openInDefault: (relativePath: string) =>
      ipcRenderer.invoke(Channels.SHELL_OPEN_IN_DEFAULT, relativePath),
    openInTerminal: (relativePath?: string) =>
      ipcRenderer.invoke(Channels.SHELL_OPEN_IN_TERMINAL, relativePath),
    openExternal: (url: string) =>
      ipcRenderer.invoke(Channels.SHELL_OPEN_EXTERNAL, url),
  },
  conversations: {
    create: (contextBundle: unknown, triggerNodeUri?: string, options?: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_CREATE, contextBundle, triggerNodeUri, options),
    append: (id: string, role: string, content: string) =>
      ipcRenderer.invoke(Channels.CONVERSATION_APPEND, id, role, content),
    resolve: (id: string) => ipcRenderer.invoke(Channels.CONVERSATION_RESOLVE, id),
    abandon: (id: string) => ipcRenderer.invoke(Channels.CONVERSATION_ABANDON, id),
    load: (id: string) => ipcRenderer.invoke(Channels.CONVERSATION_LOAD, id),
    list: () => ipcRenderer.invoke(Channels.CONVERSATION_LIST),
    listActive: () => ipcRenderer.invoke(Channels.CONVERSATION_LIST_ACTIVE),
    send: (convId: string, userMessage: string, systemPrompt?: string) =>
      ipcRenderer.invoke(Channels.CONVERSATION_SEND, convId, userMessage, systemPrompt),
    onStream: (cb: (chunk: string) => void) => subscribeIpc(Channels.CONVERSATION_STREAM, cb),
    cancel: () => ipcRenderer.invoke(Channels.CONVERSATION_CANCEL),
    crystallize: (text: string, conversationId: string) =>
      ipcRenderer.invoke(Channels.CONVERSATION_CRYSTALLIZE, text, conversationId),
    setModel: (conversationId: string, model: string | undefined) =>
      ipcRenderer.invoke(Channels.CONVERSATION_SET_MODEL, conversationId, model),
    slashCommand: (convId: string, slashCmd: string, argText: string) =>
      ipcRenderer.invoke(Channels.CONVERSATION_SLASH_COMMAND, convId, slashCmd, argText),
  },
  proposals: {
    list: (status?: string) => ipcRenderer.invoke(Channels.PROPOSAL_LIST, status),
    detail: (uri: string) => ipcRenderer.invoke(Channels.PROPOSAL_DETAIL, uri),
    approve: (uri: string) => ipcRenderer.invoke(Channels.PROPOSAL_APPROVE, uri),
    reject: (uri: string) => ipcRenderer.invoke(Channels.PROPOSAL_REJECT, uri),
    expire: () => ipcRenderer.invoke(Channels.PROPOSAL_EXPIRE),
  },
  bookmarks: {
    load: () => ipcRenderer.invoke(Channels.BOOKMARKS_LOAD),
    save: (tree: unknown) => ipcRenderer.invoke(Channels.BOOKMARKS_SAVE, tree),
  },
  tabs: {
    save: (session: unknown) => ipcRenderer.invoke(Channels.TABS_SAVE, session),
    load: () => ipcRenderer.invoke(Channels.TABS_LOAD),
  },
  refactor: {
    autoTag: (relativePath: string) => ipcRenderer.invoke(Channels.REFACTOR_AUTO_TAG, relativePath),
    autoLinkSuggest: (relativePath: string) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_LINK_SUGGEST, relativePath),
    autoLinkApply: (relativePath: string, accepted: unknown) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_LINK_APPLY, relativePath, accepted),
    autoLinkInboundSuggest: (relativePath: string) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_LINK_INBOUND_SUGGEST, relativePath),
    autoLinkInboundApply: (relativePath: string, accepted: unknown) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_LINK_INBOUND_APPLY, relativePath, accepted),
    decomposeSuggest: (relativePath: string, hints?: unknown) =>
      ipcRenderer.invoke(Channels.REFACTOR_DECOMPOSE_SUGGEST, relativePath, hints),
  },
  research: {
    decomposeClaims: (args: unknown) =>
      ipcRenderer.invoke(Channels.RESEARCH_DECOMPOSE_CLAIMS, args),
    findArguments: (args: unknown) =>
      ipcRenderer.invoke(Channels.RESEARCH_FIND_ARGUMENTS, args),
  },
  sources: {
    ingestUrl: (url: string) => ipcRenderer.invoke(Channels.SOURCES_INGEST_URL, url),
    ingestIdentifier: (identifier: string) =>
      ipcRenderer.invoke(Channels.SOURCES_INGEST_IDENTIFIER, identifier),
    ingestPdf: () => ipcRenderer.invoke(Channels.SOURCES_INGEST_PDF),
    readPdf: (sourceId: string) => ipcRenderer.invoke(Channels.SOURCES_READ_PDF, sourceId),
    finishPdfOcr: (sourceId: string, pages: string[]) =>
      ipcRenderer.invoke(Channels.SOURCES_FINISH_PDF_OCR, sourceId, pages),
    importBibtex: () => ipcRenderer.invoke(Channels.SOURCES_IMPORT_BIBTEX),
    onImportBibtexProgress: (cb: (progress: { done: number; total: number; currentTitle: string }) => void) =>
      subscribeIpc(Channels.SOURCES_IMPORT_BIBTEX_PROGRESS, cb),
    importZoteroRdf: () => ipcRenderer.invoke(Channels.SOURCES_IMPORT_ZOTERO_RDF),
    onImportZoteroRdfProgress: (cb: (progress: { done: number; total: number; currentTitle: string }) => void) =>
      subscribeIpc(Channels.SOURCES_IMPORT_ZOTERO_RDF_PROGRESS, cb),
    listAll: () => ipcRenderer.invoke(Channels.SOURCES_LIST_ALL),
    delete: (sourceId: string) => ipcRenderer.invoke(Channels.SOURCES_DELETE, sourceId),
    onChanged: (cb: () => void) => {
      ipcRenderer.on(Channels.SOURCES_CHANGED, () => cb());
    },
    createExcerpt: (params: {
      sourceId: string;
      citedText: string;
      page?: number | null;
      pageRange?: string | null;
      locationText?: string | null;
    }) => ipcRenderer.invoke(Channels.SOURCES_CREATE_EXCERPT, params),
    onExcerptsChanged: (cb: () => void) => {
      ipcRenderer.on(Channels.EXCERPTS_CHANGED, () => cb());
    },
  },
  formatter: {
    formatContent: (content: string, settings: unknown, relativePath?: string) =>
      ipcRenderer.invoke(Channels.FORMATTER_FORMAT_CONTENT, content, settings, relativePath),
    formatFile: (relativePath: string, settings: unknown) =>
      ipcRenderer.invoke(Channels.FORMATTER_FORMAT_FILE, relativePath, settings),
    formatFolder: (relDir: string, settings: unknown) =>
      ipcRenderer.invoke(Channels.FORMATTER_FORMAT_FOLDER, relDir, settings),
    loadSettings: () => ipcRenderer.invoke(Channels.FORMATTER_LOAD_SETTINGS),
    saveSettings: (settings: unknown) =>
      ipcRenderer.invoke(Channels.FORMATTER_SAVE_SETTINGS, settings),
  },
  tools: {
    execute: (request: unknown) => ipcRenderer.invoke(Channels.TOOL_EXECUTE, request),
    prepareConversation: (request: unknown) => ipcRenderer.invoke(Channels.TOOL_PREPARE_CONVERSATION, request),
    cancel: () => ipcRenderer.invoke(Channels.TOOL_CANCEL),
    onStream: (cb: (chunk: string) => void) => subscribeIpc(Channels.TOOL_STREAM, cb),
    getSettings: () => ipcRenderer.invoke(Channels.TOOL_GET_SETTINGS),
    setSettings: (settings: unknown) => ipcRenderer.invoke(Channels.TOOL_SET_SETTINGS, settings),
    onInvoke: (cb: (toolId: string) => void) => subscribeIpc(Channels.TOOL_INVOKE, cb),
  },
  menu: {
    onNewNote: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NEW_NOTE, () => cb());
    },
    onSave: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SAVE, () => cb());
    },
    onToggleSidebar: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_TOGGLE_SIDEBAR, () => cb());
    },
    onTogglePreview: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_TOGGLE_PREVIEW, () => cb());
    },
    onQuickOpen: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_QUICK_OPEN, () => cb());
    },
    onCycleTheme: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_CYCLE_THEME, () => cb());
    },
    onFontIncrease: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FONT_INCREASE, () => cb());
    },
    onFontDecrease: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FONT_DECREASE, () => cb());
    },
    onFontReset: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FONT_RESET, () => cb());
    },
    onToggleRightSidebar: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_TOGGLE_RIGHT_SIDEBAR, () => cb());
    },
    onNavBack: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NAV_BACK, () => cb());
    },
    onNavForward: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NAV_FORWARD, () => cb());
    },
    onGotoLine: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_GOTO_LINE, () => cb());
    },
    onFind: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FIND, () => cb());
    },
    onFindReplace: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FIND_REPLACE, () => cb());
    },
    onFindInNotes: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FIND_IN_NOTES, () => cb());
    },
    onReplaceInNotes: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REPLACE_IN_NOTES, () => cb());
    },
    onNewQuery: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NEW_QUERY, () => cb());
    },
    onOpenStockQuery: (cb: (payload: { query: string; language: 'sparql' | 'sql' }) => void) =>
      subscribeIpc(Channels.MENU_OPEN_STOCK_QUERY, cb),
    onEditSavedQueries: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_EDIT_SAVED_QUERIES, () => cb());
    },
    onSortLines: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SORT_LINES, () => cb());
    },
    onOpenSettings: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_OPEN_SETTINGS, () => cb());
    },
    onOpenProject: (cb: () => void) => {
      ipcRenderer.on('menu:openProject', () => cb());
    },
    onNewProject: (cb: () => void) => {
      ipcRenderer.on('menu:newProject', () => cb());
    },
    onOpenRecentProject: (cb: (path: string) => void) => subscribeIpc('menu:openRecentProject', cb),
    onCloseProject: (cb: () => void) => {
      ipcRenderer.on('menu:closeProject', () => cb());
    },
    onClearRecent: (cb: () => void) => {
      ipcRenderer.on('menu:clearRecent', () => cb());
    },
    onPrint: (cb: () => void) => {
      ipcRenderer.on('menu:print', () => cb());
    },
    onOpenInDefault: (cb: () => void) => {
      ipcRenderer.on('menu:openInDefault', () => cb());
    },
    onOpenInTerminal: (cb: () => void) => {
      ipcRenderer.on('menu:openInTerminal', () => cb());
    },
    onRefactorRename: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_RENAME, () => cb());
    },
    onRefactorMove: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_MOVE, () => cb());
    },
    onRefactorCopy: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_COPY, () => cb());
    },
    onRefactorExtract: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_EXTRACT, () => cb());
    },
    onRefactorSplitHere: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_SPLIT_HERE, () => cb());
    },
    onRefactorSplitByHeading: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_SPLIT_BY_HEADING, () => cb());
    },
    onRefactorAutoTag: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_AUTOTAG, () => cb());
    },
    onRefactorAutoLink: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_AUTOLINK, () => cb());
    },
    onRefactorAutoLinkInbound: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_AUTOLINK_INBOUND, () => cb());
    },
    onRefactorDecompose: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_REFACTOR_DECOMPOSE, () => cb());
    },
    onResearchDecomposeClaims: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_RESEARCH_DECOMPOSE_CLAIMS, () => cb());
    },
    onResearchFindSupporting: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_RESEARCH_FIND_SUPPORTING, () => cb());
    },
    onResearchFindOpposing: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_RESEARCH_FIND_OPPOSING, () => cb());
    },
    onFormatCurrentNote: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FORMAT_CURRENT_NOTE, () => cb());
    },
    onFormatFolder: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FORMAT_FOLDER, () => cb());
    },
    onFormatAll: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FORMAT_ALL, () => cb());
    },
    onIngestUrl: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_INGEST_URL, () => cb());
    },
    onIngestIdentifier: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_INGEST_IDENTIFIER, () => cb());
    },
    onIngestPdf: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_INGEST_PDF, () => cb());
    },
    onExport: (cb: (exporterId: string) => void) => subscribeIpc(Channels.MENU_EXPORT, cb),
    onImportBibtex: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_IMPORT_BIBTEX, () => cb());
    },
    onImportZoteroRdf: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_IMPORT_ZOTERO_RDF, () => cb());
    },
    onProjectOpened: (cb: (meta: { rootPath: string; name: string }) => void) =>
      subscribeIpc('project:opened', cb),
  },
});

