import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron';
import { Channels } from '../shared/channels';
import { invoke } from './typed-invoke';
import type { SearchInNotesOptions, ReplaceInNotesOptions, MenuEditorState, BookmarkNode, LayoutSession, NeighborhoodOptions } from '../shared/types';
import type { ThemeMode } from '../shared/theme';

/**
 * Subscribe to an IPC channel and forward the typed payload to `cb`.
 * Centralises the unavoidable cast at the IPC boundary — the main
 * process owns the wire shape, so each subscriber names what it expects.
 */
function subscribeIpc<T>(channel: string, cb: (payload: T) => void): () => void {
  // Wrapper captured by reference so `off` removes the exact handler.
  const handler = (_e: unknown, payload: unknown) => cb(payload as T);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.off(channel, handler); };
}

contextBridge.exposeInMainWorld('api', {
  notebase: {
    open: () => invoke(Channels.NOTEBASE_OPEN),
    openPath: (rootPath: string) => invoke(Channels.NOTEBASE_OPEN_PATH, rootPath),
    newProject: () => invoke(Channels.NOTEBASE_NEW_PROJECT),
    openInNewWindow: () => invoke(Channels.NOTEBASE_OPEN_IN_NEW_WINDOW),
    newProjectInNewWindow: () => invoke(Channels.NOTEBASE_NEW_PROJECT_IN_NEW_WINDOW),
    openPathInNewWindow: (rootPath: string) => invoke(Channels.NOTEBASE_OPEN_PATH_IN_NEW_WINDOW, rootPath),
    close: () => invoke(Channels.NOTEBASE_CLOSE),
    clearRecent: () => invoke(Channels.RECENT_CLEAR),
    listFiles: () => invoke(Channels.NOTEBASE_LIST_FILES),
    readFile: (relativePath: string) =>
      invoke(Channels.NOTEBASE_READ_FILE, relativePath),
    readBinary: (relativePath: string) =>
      invoke(Channels.NOTEBASE_READ_BINARY, relativePath),
    writeBinary: (relativePath: string, bytes: Uint8Array) =>
      invoke(Channels.NOTEBASE_WRITE_BINARY, relativePath, bytes),
    fileExists: (relativePath: string) =>
      invoke(Channels.NOTEBASE_FILE_EXISTS, relativePath),
    writeFile: (relativePath: string, content: string) =>
      invoke(Channels.NOTEBASE_WRITE_FILE, relativePath, content),
    createFile: (relativePath: string) =>
      invoke(Channels.NOTEBASE_CREATE_FILE, relativePath),
    deleteFile: (relativePath: string) =>
      invoke(Channels.NOTEBASE_DELETE_FILE, relativePath),
    createFolder: (relativePath: string) =>
      invoke(Channels.NOTEBASE_CREATE_FOLDER, relativePath),
    deleteFolder: (relativePath: string) =>
      invoke(Channels.NOTEBASE_DELETE_FOLDER, relativePath),
    rename: (oldRelPath: string, newRelPath: string) =>
      invoke(Channels.NOTEBASE_RENAME, oldRelPath, newRelPath),
    mergePreview: (sourceRelPath: string, targetRelPath: string) =>
      invoke(Channels.NOTEBASE_MERGE_PREVIEW, sourceRelPath, targetRelPath),
    merge: (sourceRelPath: string, targetRelPath: string, separator?: string) =>
      invoke(Channels.NOTEBASE_MERGE, sourceRelPath, targetRelPath, separator),
    copy: (srcRelPath: string, destRelPath: string) =>
      invoke(Channels.NOTEBASE_COPY, srcRelPath, destRelPath),
    searchInNotes: (opts: SearchInNotesOptions) => invoke(Channels.NOTEBASE_SEARCH_IN_NOTES, opts),
    replaceInNotes: (opts: ReplaceInNotesOptions) => invoke(Channels.NOTEBASE_REPLACE_IN_NOTES, opts),
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
      invoke(Channels.NOTEBASE_RENAME_ANCHOR, targetRelativePath, oldSlug, newSlug),
    renameSource: (oldId: string, newId: string) =>
      invoke(Channels.NOTEBASE_RENAME_SOURCE, oldId, newId),
    renameExcerpt: (oldId: string, newId: string) =>
      invoke(Channels.NOTEBASE_RENAME_EXCERPT, oldId, newId),
    getOnboardingDismissed: () =>
      invoke(Channels.NOTEBASE_GET_ONBOARDING_DISMISSED),
    setOnboardingDismissed: (dismissed: boolean) =>
      invoke(Channels.NOTEBASE_SET_ONBOARDING_DISMISSED, dismissed),
  },
  links: {
    outgoing: (relativePath: string) => invoke(Channels.LINKS_OUTGOING, relativePath),
    backlinks: (relativePath: string) => invoke(Channels.LINKS_BACKLINKS, relativePath),
    bundle: (relativePath: string) => invoke(Channels.LINKS_BUNDLE, relativePath),
    citationsForNote: (relativePath: string, content?: string) =>
      invoke(Channels.LINKS_CITATIONS_FOR_NOTE, relativePath, content),
    externalInbound: (paths: string[]) =>
      invoke(Channels.LINKS_EXTERNAL_INBOUND, paths),
    neighborhood: (relativePath: string, opts?: NeighborhoodOptions) =>
      invoke(Channels.LINKS_NEIGHBORHOOD, relativePath, opts),
    expandNode: (relativePath: string) =>
      invoke(Channels.LINKS_EXPAND_NODE, relativePath),
  },
  queries: {
    list: () => invoke(Channels.QUERIES_LIST),
    save: (scope: string, name: string, description: string, query: string, language: 'sparql' | 'sql', group: string | null = null) =>
      invoke(Channels.QUERIES_SAVE, scope, name, description, query, language, group),
    delete: (filePath: string) => invoke(Channels.QUERIES_DELETE, filePath),
    rename: (filePath: string, newName: string) => invoke(Channels.QUERIES_RENAME, filePath, newName),
    move: (filePath: string, newScope: 'project' | 'global') =>
      invoke(Channels.QUERIES_MOVE, filePath, newScope),
    setGroup: (filePath: string, group: string | null) =>
      invoke(Channels.QUERIES_SET_GROUP, filePath, group),
    setOrder: (entries: Array<{ filePath: string; order: number | null }>) =>
      invoke(Channels.QUERIES_SET_ORDER, entries),
  },
  search: {
    query: (query: string) => invoke(Channels.SEARCH_QUERY, query),
  },
  git: {
    status: () => invoke(Channels.GIT_STATUS),
    commit: (message: string) => invoke(Channels.GIT_COMMIT, message),
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
    aliasMap: () => ipcRenderer.invoke(Channels.GRAPH_ALIAS_MAP),
    aliasEntries: () => ipcRenderer.invoke(Channels.GRAPH_ALIAS_ENTRIES),
    frontmatterKeys: () => ipcRenderer.invoke(Channels.GRAPH_FRONTMATTER_KEYS),
  },
  embeddings: {
    onBackfillProgress: (cb: (p: { done: number; total: number; running: boolean }) => void) =>
      subscribeIpc(Channels.EMBEDDINGS_BACKFILL_PROGRESS, cb),
    related: (relativePath: string, limit?: number) =>
      invoke(Channels.EMBEDDINGS_RELATED, relativePath, limit),
    searchText: (query: string, opts?: { limit?: number; kinds?: readonly ('note' | 'source' | 'excerpt')[]; excludePath?: string }) =>
      invoke(Channels.EMBEDDINGS_SEARCH_TEXT, query, opts),
  },
  tables: {
    query: (sql: string) => ipcRenderer.invoke(Channels.TABLES_QUERY, sql),
    list: () => ipcRenderer.invoke(Channels.TABLES_LIST),
    onChanged: (cb: () => void) => {
      ipcRenderer.on(Channels.TABLES_CHANGED, () => cb());
    },
    onNameCollision: (cb: (collision: import('../shared/types').CsvTableCollision) => void) => {
      ipcRenderer.on(Channels.TABLES_NAME_COLLISION, (_e, collision) => cb(collision as import('../shared/types').CsvTableCollision));
    },
  },
  tags: {
    list: () => invoke(Channels.TAGS_LIST),
    notesByTag: (tag: string) => invoke(Channels.TAGS_NOTES_BY_TAG, tag),
    notesByTagPrefix: (prefix: string) => invoke(Channels.TAGS_NOTES_BY_TAG_PREFIX, prefix),
    sourcesByTag: (tag: string) => invoke(Channels.TAGS_SOURCES_BY_TAG, tag),
    allNames: () => invoke(Channels.TAGS_ALL_NAMES),
  },
  templates: {
    list: () => invoke(Channels.TEMPLATES_LIST),
    get: (filename: string) => invoke(Channels.TEMPLATES_GET, filename),
    saveAs: (name: string, content: string) =>
      invoke(Channels.TEMPLATES_SAVE_AS, name, content),
  },
  export: {
    csv: (csv: string) => invoke(Channels.EXPORT_CSV, csv),
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
    interruptPythonKernel: () => ipcRenderer.invoke(Channels.COMPUTE_INTERRUPT_PYTHON),
    getPythonSettings: () => ipcRenderer.invoke(Channels.COMPUTE_GET_PYTHON_SETTINGS),
    setPythonSettings: (settings: { pythonPath: string }) =>
      ipcRenderer.invoke(Channels.COMPUTE_SET_PYTHON_SETTINGS, settings),
    probePython: (candidate?: string) =>
      ipcRenderer.invoke(Channels.COMPUTE_PROBE_PYTHON, candidate),
    browsePython: () => ipcRenderer.invoke(Channels.COMPUTE_BROWSE_PYTHON),
    getPythonTrust: () => ipcRenderer.invoke(Channels.COMPUTE_GET_PYTHON_TRUST),
    setPythonTrust: (trusted: boolean) =>
      ipcRenderer.invoke(Channels.COMPUTE_SET_PYTHON_TRUST, trusted),
  },
  publish: {
    listExporters: () => ipcRenderer.invoke(Channels.PUBLISH_LIST_EXPORTERS),
    resolvePlan: (input: unknown, opts: unknown) =>
      ipcRenderer.invoke(Channels.PUBLISH_RESOLVE_PLAN, input, opts),
    runExport: (args: unknown) => ipcRenderer.invoke(Channels.PUBLISH_RUN_EXPORT, args),
    listTargets: () => ipcRenderer.invoke(Channels.PUBLISH_LIST_TARGETS),
    upsertTarget: (target: unknown) => ipcRenderer.invoke(Channels.PUBLISH_UPSERT_TARGET, target),
    removeTarget: (id: string) => ipcRenderer.invoke(Channels.PUBLISH_REMOVE_TARGET, id),
    toGit: (targetId: string, opts?: unknown) =>
      ipcRenderer.invoke(Channels.PUBLISH_TO_GIT, targetId, opts),
  },
  app: {
    getInfo: () => ipcRenderer.invoke(Channels.APP_GET_INFO),
    getShortcuts: () => ipcRenderer.invoke(Channels.APP_GET_SHORTCUTS),
  },
  images: {
    // Cached-or-fetched bytes+mime for an external image URL (offline cache, #...).
    cacheExternal: (url: string) => ipcRenderer.invoke(Channels.IMAGES_CACHE_EXTERNAL, url),
  },
  youtube: {
    // Cached-or-fetched poster bytes for a video id (offline cache, #...).
    thumbnail: (id: string) => ipcRenderer.invoke(Channels.YOUTUBE_THUMBNAIL, id),
  },
  // Whole-window zoom (#...). Wraps the renderer's own `webFrame` — the same
  // frame zoom the View menu's zoom roles drive — so the Settings control and
  // the menu shortcuts stay in sync. Synchronous: no IPC round-trip.
  view: {
    getZoomFactor: (): number => webFrame.getZoomFactor(),
    setZoomFactor: (factor: number): void => webFrame.setZoomFactor(factor),
  },
  shell: {
    revealFile: (relativePath?: string) =>
      invoke(Channels.SHELL_REVEAL_FILE, relativePath),
    openInDefault: (relativePath: string) =>
      invoke(Channels.SHELL_OPEN_IN_DEFAULT, relativePath),
    openInTerminal: (relativePath?: string) =>
      invoke(Channels.SHELL_OPEN_IN_TERMINAL, relativePath),
    openExternal: (url: string) =>
      invoke(Channels.SHELL_OPEN_EXTERNAL, url),
  },
  conversations: {
    create: (contextBundle: unknown, triggerNodeUri?: string, options?: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_CREATE, contextBundle, triggerNodeUri, options),
    append: (id: string, role: string, content: string) =>
      ipcRenderer.invoke(Channels.CONVERSATION_APPEND, id, role, content),
    archive: (id: string) => ipcRenderer.invoke(Channels.CONVERSATION_ARCHIVE, id),
    load: (id: string) => ipcRenderer.invoke(Channels.CONVERSATION_LOAD, id),
    list: () => ipcRenderer.invoke(Channels.CONVERSATION_LIST),
    listActive: () => ipcRenderer.invoke(Channels.CONVERSATION_LIST_ACTIVE),
    send: (convId: string, userMessage: string, systemPrompt?: string, currentNotePath?: string, extraTools?: unknown[]) =>
      ipcRenderer.invoke(Channels.CONVERSATION_SEND, convId, userMessage, systemPrompt, currentNotePath, extraTools),
    loadUIState: () => ipcRenderer.invoke(Channels.CONVERSATION_UI_STATE_LOAD),
    saveUIState: (state: unknown) => ipcRenderer.invoke(Channels.CONVERSATION_UI_STATE_SAVE, state),
    onAskUser: (cb: (req: unknown) => void) => subscribeIpc(Channels.CONVERSATION_ASK_USER, cb),
    askUserReply: (questionId: string, answer: string) =>
      ipcRenderer.invoke(Channels.CONVERSATION_ASK_USER_REPLY, questionId, answer),
    onStream: (cb: (chunk: string) => void) => subscribeIpc(Channels.CONVERSATION_STREAM, cb),
    cancel: () => ipcRenderer.invoke(Channels.CONVERSATION_CANCEL),
    onDraft: (cb: (draft: unknown) => void) => subscribeIpc(Channels.CONVERSATION_DRAFT, cb),
    fileDraft: (draft: unknown) => ipcRenderer.invoke(Channels.CONVERSATION_FILE_DRAFT, draft),
    onSourceDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_SOURCE_DRAFT, cb),
    fileSourceDraft: (draft: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_FILE_SOURCE_DRAFT, draft),
    onPropertyDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_PROPERTY_DRAFT, cb),
    filePropertyDraft: (draft: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_FILE_PROPERTY_DRAFT, draft),
    onSourcePropertyDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_SOURCE_PROPERTY_DRAFT, cb),
    fileSourcePropertyDraft: (draft: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT, draft),
    onClaimsDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_CLAIMS_DRAFT, cb),
    fileClaimsDraft: (draft: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_FILE_CLAIMS_DRAFT, draft),
    onComputeDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_COMPUTE_DRAFT, cb),
    runComputeDraft: (input: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_RUN_COMPUTE_DRAFT, input),
    onRefactorDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_REFACTOR_DRAFT, cb),
    fileRefactorDraft: (draft: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_FILE_REFACTOR_DRAFT, draft),
    onReorgDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_REORG_DRAFT, cb),
    fileReorgDraft: (draft: unknown, selected: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_FILE_REORG_DRAFT, draft, selected),
    onDeleteDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_DELETE_DRAFT, cb),
    fileDeleteDraft: (draft: unknown, selected: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_FILE_DELETE_DRAFT, draft, selected),
    onNoteBodyDraft: (cb: (draft: unknown) => void) =>
      subscribeIpc(Channels.CONVERSATION_NOTE_BODY_DRAFT, cb),
    fileNoteBodyDraft: (draft: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT, draft),
    insertComputeDraft: (input: unknown) =>
      ipcRenderer.invoke(Channels.CONVERSATION_INSERT_COMPUTE_DRAFT, input),
    setModel: (conversationId: string, model: string | undefined) =>
      ipcRenderer.invoke(Channels.CONVERSATION_SET_MODEL, conversationId, model),
    setEffort: (conversationId: string, effort: string | undefined) =>
      ipcRenderer.invoke(Channels.CONVERSATION_SET_EFFORT, conversationId, effort),
    compact: (conversationId: string) =>
      ipcRenderer.invoke(Channels.CONVERSATION_COMPACT, conversationId),
  },
  proposals: {
    list: (status?: string) => ipcRenderer.invoke(Channels.PROPOSAL_LIST, status),
    detail: (uri: string) => ipcRenderer.invoke(Channels.PROPOSAL_DETAIL, uri),
    approve: (uri: string) => ipcRenderer.invoke(Channels.PROPOSAL_APPROVE, uri),
    reject: (uri: string) => ipcRenderer.invoke(Channels.PROPOSAL_REJECT, uri),
    expire: () => ipcRenderer.invoke(Channels.PROPOSAL_EXPIRE),
  },
  bookmarks: {
    load: () => invoke(Channels.BOOKMARKS_LOAD),
    save: (tree: BookmarkNode[]) => invoke(Channels.BOOKMARKS_SAVE, tree),
  },
  clipper: {
    getState: () => invoke(Channels.CLIPPER_GET_STATE),
    setEnabled: (enabled: boolean) => invoke(Channels.CLIPPER_SET_ENABLED, enabled),
    regenerateSecret: () => invoke(Channels.CLIPPER_REGENERATE_SECRET),
  },
  tabs: {
    save: (session: LayoutSession) => invoke(Channels.TABS_SAVE, session),
    load: () => invoke(Channels.TABS_LOAD),
  },
  refactor: {
    autoTag: (relativePath: string) => ipcRenderer.invoke(Channels.REFACTOR_AUTO_TAG_SUGGEST, relativePath),
    autoTagApply: (relativePath: string, acceptedTags: unknown) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_TAG_APPLY, relativePath, acceptedTags),
    autoLinkSuggest: (relativePath: string) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_LINK_SUGGEST, relativePath),
    autoLinkApply: (relativePath: string, accepted: unknown) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_LINK_APPLY, relativePath, accepted),
    applySuggestedLink: (activeRelPath: string, targetRelPath: string) =>
      ipcRenderer.invoke(Channels.REFACTOR_APPLY_SUGGESTED_LINK, activeRelPath, targetRelPath),
    autoLinkInboundSuggest: (relativePath: string) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_LINK_INBOUND_SUGGEST, relativePath),
    autoLinkInboundApply: (relativePath: string, accepted: unknown) =>
      ipcRenderer.invoke(Channels.REFACTOR_AUTO_LINK_INBOUND_APPLY, relativePath, accepted),
  },
  sources: {
    ingestUrl: (url: string) => ipcRenderer.invoke(Channels.SOURCES_INGEST_URL, url),
    ingestIdentifier: (identifier: string) =>
      ipcRenderer.invoke(Channels.SOURCES_INGEST_IDENTIFIER, identifier),
    ingestFile: () => ipcRenderer.invoke(Channels.SOURCES_INGEST_FILE),
    readPdf: (sourceId: string) => ipcRenderer.invoke(Channels.SOURCES_READ_PDF, sourceId),
    hasPdf: (sourceId: string) => ipcRenderer.invoke(Channels.SOURCES_HAS_PDF, sourceId),
    getExcerptNoteFolder: () => ipcRenderer.invoke(Channels.EXCERPT_GET_NOTE_FOLDER),
    setExcerptNoteFolder: (folder: string) =>
      ipcRenderer.invoke(Channels.EXCERPT_SET_NOTE_FOLDER, folder),
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
    merge: (srcId: string, destId: string) =>
      ipcRenderer.invoke(Channels.SOURCES_MERGE, { srcId, destId }),
    setReadStatus: (sourceId: string, status: 'unread' | 'reading' | 'read' | 'skipped' | null) =>
      ipcRenderer.invoke(Channels.SOURCES_SET_READ_STATUS, { sourceId, status }),
    setTitle: (sourceId: string, title: string) =>
      ipcRenderer.invoke(Channels.SOURCES_SET_TITLE, { sourceId, title }),
    setReadDueBy: (sourceId: string, dueBy: string | null) =>
      ipcRenderer.invoke(Channels.SOURCES_SET_READ_DUE_BY, { sourceId, dueBy }),
    addTag: (sourceId: string, tag: string) =>
      ipcRenderer.invoke(Channels.SOURCES_ADD_TAG, { sourceId, tag }),
    removeTag: (sourceId: string, tag: string) =>
      ipcRenderer.invoke(Channels.SOURCES_REMOVE_TAG, { sourceId, tag }),
    queueMembers: (view: 'unread' | 'reading' | 'dueThisWeek' | 'recentlyFinished') =>
      ipcRenderer.invoke(Channels.SOURCES_QUEUE_MEMBERS, view),
    stripUpstreamTags: (sourceId: string) =>
      ipcRenderer.invoke(Channels.SOURCES_STRIP_UPSTREAM_TAGS, sourceId),
    getIngestSettings: () => ipcRenderer.invoke(Channels.INGEST_GET_SETTINGS),
    setIngestSettings: (settings: { importUpstreamTags: boolean }) =>
      ipcRenderer.invoke(Channels.INGEST_SET_SETTINGS, settings),
    ingestSmart: (rawInput: string) =>
      ipcRenderer.invoke(Channels.SOURCES_INGEST_SMART, rawInput),
    mineReferences: (sourceId: string) =>
      ipcRenderer.invoke(Channels.SOURCES_MINE_REFERENCES, sourceId),
    createReferenceStubs: (sourceId: string, refs: unknown[]) =>
      ipcRenderer.invoke(Channels.SOURCES_CREATE_REFERENCE_STUBS, { sourceId, refs }),
    resolveStub: (sourceId: string) =>
      ipcRenderer.invoke(Channels.SOURCES_RESOLVE_STUB, sourceId),
    applyStubResolution: (sourceId: string, doi: string) =>
      ipcRenderer.invoke(Channels.SOURCES_APPLY_STUB_RESOLUTION, { sourceId, doi }),
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
  collections: {
    list: () => ipcRenderer.invoke(Channels.COLLECTIONS_LIST),
    create: (args: { name: string; parent?: string | null }) =>
      ipcRenderer.invoke(Channels.COLLECTIONS_CREATE, args),
    rename: (id: string, name: string) =>
      ipcRenderer.invoke(Channels.COLLECTIONS_RENAME, { id, name }),
    remove: (id: string) => ipcRenderer.invoke(Channels.COLLECTIONS_DELETE, id),
    addSource: (collectionId: string, sourceId: string) =>
      ipcRenderer.invoke(Channels.COLLECTIONS_ADD_SOURCE, { collectionId, sourceId }),
    removeSource: (collectionId: string, sourceId: string) =>
      ipcRenderer.invoke(Channels.COLLECTIONS_REMOVE_SOURCE, { collectionId, sourceId }),
    createSmart: (args: { name: string; predicate: { kind: 'tags'; allOf: string[] } }) =>
      ipcRenderer.invoke(Channels.COLLECTIONS_CREATE_SMART, args),
    renameSmart: (id: string, name: string) =>
      ipcRenderer.invoke(Channels.COLLECTIONS_RENAME_SMART, { id, name }),
    removeSmart: (id: string) => ipcRenderer.invoke(Channels.COLLECTIONS_DELETE_SMART, id),
    updateSmartPredicate: (id: string, predicate: { kind: 'tags'; allOf: string[] }) =>
      ipcRenderer.invoke(Channels.COLLECTIONS_UPDATE_SMART_PREDICATE, { id, predicate }),
    smartMembers: (id: string) =>
      ipcRenderer.invoke(Channels.COLLECTIONS_SMART_MEMBERS, id),
    onChanged: (cb: () => void) => {
      ipcRenderer.on(Channels.COLLECTIONS_CHANGED, () => cb());
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
    getKeyStorage: () => ipcRenderer.invoke(Channels.TOOL_GET_KEY_STORAGE),
    checkConnection: (candidateKey?: string) =>
      ipcRenderer.invoke(Channels.TOOL_CHECK_CONNECTION, candidateKey),
    onInvoke: (cb: (toolId: string) => void) => subscribeIpc(Channels.TOOL_INVOKE, cb),
  },
  skills: {
    list: () => ipcRenderer.invoke(Channels.SKILLS_LIST),
    reload: () => ipcRenderer.invoke(Channels.SKILLS_RELOAD),
    import: () => ipcRenderer.invoke(Channels.SKILLS_IMPORT),
    remove: (id: string) => ipcRenderer.invoke(Channels.SKILLS_REMOVE, id),
    revealFolder: () => ipcRenderer.invoke(Channels.SKILLS_REVEAL),
    setMenuConfig: (config: unknown) => ipcRenderer.invoke(Channels.SKILLS_MENU_CONFIG_SET, config),
  },
  sites: {
    list: () => invoke(Channels.SITES_LIST),
    add: (domain: string, label?: string) =>
      invoke(Channels.SITES_ADD, domain, label),
    remove: (id: string) => invoke(Channels.SITES_REMOVE, id),
    login: (id: string) => invoke(Channels.SITES_LOGIN, id),
    logout: (id: string) => invoke(Channels.SITES_LOGOUT, id),
  },
  bibliography: {
    listStyles: () => ipcRenderer.invoke(Channels.BIBLIOGRAPHY_LIST_STYLES),
    getStyle: () => ipcRenderer.invoke(Channels.BIBLIOGRAPHY_GET_STYLE),
    setStyle: (styleId: string) =>
      ipcRenderer.invoke(Channels.BIBLIOGRAPHY_SET_STYLE, styleId),
    generate: (relativePath: string) =>
      ipcRenderer.invoke(Channels.BIBLIOGRAPHY_GENERATE, relativePath),
  },
  csl: {
    listUserStyles: () => ipcRenderer.invoke(Channels.CSL_LIST_USER_STYLES),
    listUserLocales: () => ipcRenderer.invoke(Channels.CSL_LIST_USER_LOCALES),
    importStyle: () => ipcRenderer.invoke(Channels.CSL_IMPORT_STYLE),
    importLocale: () => ipcRenderer.invoke(Channels.CSL_IMPORT_LOCALE),
    removeStyle: (id: string) => ipcRenderer.invoke(Channels.CSL_REMOVE_STYLE, id),
    removeLocale: (id: string) => ipcRenderer.invoke(Channels.CSL_REMOVE_LOCALE, id),
  },
  citations: {
    renderInline: (refs: { kind: 'cite' | 'quote'; id: string }[]) =>
      ipcRenderer.invoke(Channels.CITATION_RENDER_INLINE, refs),
  },
  menu: {
    onNewNote: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NEW_NOTE, () => cb());
    },
    onEditThoughtbaseDoc: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_EDIT_THOUGHTBASE_DOC, () => cb());
    },
    onSave: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SAVE, () => cb());
    },
    onSaveAsTemplate: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SAVE_AS_TEMPLATE, () => cb());
    },
    onInsertTemplate: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_INSERT_TEMPLATE, () => cb());
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
    onSetTheme: (cb: (mode: ThemeMode) => void) => {
      ipcRenderer.on(Channels.MENU_SET_THEME, (_e, mode: ThemeMode) => cb(mode));
    },
    reportTheme: (mode: ThemeMode) => ipcRenderer.send(Channels.MENU_REPORT_THEME, mode),
    reportEditorState: (state: MenuEditorState) => ipcRenderer.send(Channels.MENU_REPORT_EDITOR_STATE, state),
    onSplitRight: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SPLIT_RIGHT, () => cb());
    },
    onSplitDown: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SPLIT_DOWN, () => cb());
    },
    onFocusNextGroup: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FOCUS_NEXT_GROUP, () => cb());
    },
    onFocusPrevGroup: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FOCUS_PREV_GROUP, () => cb());
    },
    onCloseGroup: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_CLOSE_GROUP, () => cb());
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
    onToggleConversations: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_TOGGLE_CONVERSATIONS, () => cb());
    },
    onNewConversation: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NEW_CONVERSATION, () => cb());
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
      ipcRenderer.on(Channels.MENU_OPEN_PROJECT, () => cb());
    },
    onNewProject: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NEW_PROJECT, () => cb());
    },
    onOpenRecentProject: (cb: (path: string) => void) => subscribeIpc('menu:openRecentProject', cb),
    onCloseProject: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_CLOSE_PROJECT, () => cb());
    },
    onClearRecent: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_CLEAR_RECENT, () => cb());
    },
    onPrint: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_PRINT, () => cb());
    },
    onAbout: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_ABOUT, () => cb());
    },
    onShortcuts: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SHORTCUTS, () => cb());
    },
    onOpenInDefault: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_OPEN_IN_DEFAULT, () => cb());
    },
    onOpenInTerminal: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_OPEN_IN_TERMINAL, () => cb());
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
    onFormat: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_FORMAT, () => cb());
    },
    onBibliography: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_BIBLIOGRAPHY, () => cb());
    },
    onIngestUrl: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_INGEST_URL, () => cb());
    },
    onIngestIdentifier: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_INGEST_IDENTIFIER, () => cb());
    },
    onIngestFile: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_INGEST_FILE, () => cb());
    },
    onExport: (cb: (exporterId: string) => void) => subscribeIpc(Channels.MENU_EXPORT, cb),
    onPublish: (cb: () => void) => subscribeIpc(Channels.MENU_PUBLISH, cb),
    onImportBibtex: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_IMPORT_BIBTEX, () => cb());
    },
    onImportZoteroRdf: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_IMPORT_ZOTERO_RDF, () => cb());
    },
    onProjectOpened: (cb: (meta: { rootPath: string; name: string }) => void) =>
      subscribeIpc(Channels.PROJECT_OPENED, cb),
  },
});

