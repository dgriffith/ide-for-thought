import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron';
import { Channels } from '../shared/channels';
import { invoke } from './typed-invoke';
import type { SearchInNotesOptions, ReplaceInNotesOptions, MenuEditorState, BookmarkNode, LayoutSession, NeighborhoodOptions } from '../shared/types';
import type { ThemeMode } from '../shared/theme';
import type { ChannelMap, EventMap } from '../shared/ipc-contract';
import type { ConversationDraftBase } from '../shared/conversation-draft-base';
import type { AskUserRequest } from '../shared/conversation-tools';

/**
 * Typed main→renderer event subscription (#1633). The channel + the `cb` payload
 * types are checked against {@link EventMap}, so a subscriber that disagrees with
 * the sender fails `tsc` — no more `unknown` cast at this boundary. Every
 * main→renderer channel now flows through here.
 */
function subscribe<K extends keyof EventMap>(channel: K, cb: EventMap[K]): () => void {
  const handler = (_e: unknown, ...args: unknown[]) => (cb as (...a: unknown[]) => void)(...args);
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
    installTutorial: () => invoke(Channels.NOTEBASE_INSTALL_TUTORIAL),
    installTutorialInNewWindow: () => invoke(Channels.NOTEBASE_INSTALL_TUTORIAL_IN_NEW_WINDOW),
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
    onFileChanged: (cb: (path: string) => void) => subscribe(Channels.NOTEBASE_FILE_CHANGED, cb),
    onFileCreated: (cb: (path: string) => void) => subscribe(Channels.NOTEBASE_FILE_CREATED, cb),
    onFileDeleted: (cb: (path: string) => void) => subscribe(Channels.NOTEBASE_FILE_DELETED, cb),
    onRenamed: (cb: (transitions: Array<{ old: string; new: string }>) => void) =>
      subscribe(Channels.NOTEBASE_RENAMED, cb),
    onRewritten: (cb: (paths: string[]) => void) => subscribe(Channels.NOTEBASE_REWRITTEN, cb),
    onHeadingRenameSuggested: (cb: (candidate: {
      relativePath: string;
      oldSlug: string;
      oldText: string;
      newSlug: string;
      newText: string;
      incomingLinkCount: number;
    }) => void) => subscribe(Channels.NOTEBASE_HEADING_RENAME_SUGGESTED, cb),
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
    getProperties: () => invoke(Channels.NOTEBASE_GET_PROPERTIES),
    setDisplayName: (name: string) => invoke(Channels.NOTEBASE_SET_DISPLAY_NAME, name),
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
  views: {
    list: () => invoke(Channels.VIEWS_LIST),
    save: (scope: 'project' | 'global', input: Parameters<ChannelMap['views:save']>[1]) =>
      invoke(Channels.VIEWS_SAVE, scope, input),
    delete: (filePath: string) => invoke(Channels.VIEWS_DELETE, filePath),
    rename: (filePath: string, newName: string) => invoke(Channels.VIEWS_RENAME, filePath, newName),
    setOrder: (entries: Array<{ filePath: string; order: number | null }>) =>
      invoke(Channels.VIEWS_SET_ORDER, entries),
  },
  search: {
    query: (query: string) => invoke(Channels.SEARCH_QUERY, query),
  },
  git: {
    status: () => invoke(Channels.GIT_STATUS),
    commit: (message: string) => invoke(Channels.GIT_COMMIT, message),
  },
  graph: {
    query: (sparql: string) => invoke(Channels.GRAPH_QUERY, sparql),
    setBaseUri: (uri: string) => invoke(Channels.GRAPH_SET_BASE_URI, uri),
    groundCheck: (claimText: string) => invoke(Channels.GRAPH_GROUND_CHECK, claimText),
    inspections: () => invoke(Channels.INSPECTIONS_LIST),
    runInspections: () => invoke(Channels.INSPECTIONS_RUN),
    inspectionSettings: () => invoke(Channels.INSPECTIONS_GET_SETTINGS),
    setInspectionSettings: (settings: Parameters<ChannelMap['inspections:setSettings']>[0]) =>
      invoke(Channels.INSPECTIONS_SET_SETTINGS, settings),
    onInspectionsChanged: (cb: () => void) => subscribe(Channels.INSPECTIONS_CHANGED, cb),
    export: () => invoke(Channels.GRAPH_EXPORT),
    sourceDetail: (sourceId: string) => invoke(Channels.GRAPH_SOURCE_DETAIL, sourceId),
    excerptSource: (excerptId: string) => invoke(Channels.GRAPH_EXCERPT_SOURCE, excerptId),
    attachExcerptEvidence: (excerptId: string, claimPath: string, role: 'grounds' | 'supports' | 'rebuts') =>
      invoke(Channels.GRAPH_ATTACH_EXCERPT_EVIDENCE, excerptId, claimPath, role),
    schemaForCompletion: () => invoke(Channels.GRAPH_SCHEMA_FOR_COMPLETION),
    aliasMap: () => invoke(Channels.GRAPH_ALIAS_MAP),
    aliasEntries: () => invoke(Channels.GRAPH_ALIAS_ENTRIES),
    frontmatterKeys: () => invoke(Channels.GRAPH_FRONTMATTER_KEYS),
  },
  maintenance: {
    /** Progress + completion for the File ▸ maintenance operations (#1814). */
    onProgress: (cb: (p: import('../shared/maintenance').MaintenanceProgress) => void) =>
      subscribe(Channels.MAINTENANCE_PROGRESS, cb),
  },
  embeddings: {
    onBackfillProgress: (cb: (p: { done: number; total: number; running: boolean }) => void) =>
      subscribe(Channels.EMBEDDINGS_BACKFILL_PROGRESS, cb),
    related: (relativePath: string, limit?: number) =>
      invoke(Channels.EMBEDDINGS_RELATED, relativePath, limit),
    unlinkedMentions: (relativePath: string, limit?: number) =>
      invoke(Channels.EMBEDDINGS_UNLINKED_MENTIONS, relativePath, limit),
    searchText: (query: string, opts?: { limit?: number; kinds?: readonly ('note' | 'source' | 'excerpt')[]; excludePath?: string }) =>
      invoke(Channels.EMBEDDINGS_SEARCH_TEXT, query, opts),
  },
  tables: {
    query: (sql: string) => invoke(Channels.TABLES_QUERY, sql),
    list: () => invoke(Channels.TABLES_LIST),
    onChanged: (cb: () => void) => subscribe(Channels.TABLES_CHANGED, cb),
    onNameCollision: (cb: (collision: import('../shared/types').CsvTableCollision) => void) =>
      subscribe(Channels.TABLES_NAME_COLLISION, cb),
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
      invoke(Channels.FILES_DROP_IMPORT, targetFolder, localPaths),
  },
  compute: {
    runCell: (language: string, code: string, notePath?: string) =>
      invoke(Channels.COMPUTE_RUN_CELL, language, code, notePath),
    languages: () => invoke(Channels.COMPUTE_LANGUAGES),
    saveCellOutput: (input: Parameters<ChannelMap['compute:saveCellOutput']>[0]) =>
      invoke(Channels.COMPUTE_SAVE_CELL_OUTPUT, input),
    restartPythonKernel: () => invoke(Channels.COMPUTE_RESTART_PYTHON_KERNEL),
    interruptPythonKernel: () => invoke(Channels.COMPUTE_INTERRUPT_PYTHON),
    getPythonSettings: () => invoke(Channels.COMPUTE_GET_PYTHON_SETTINGS),
    setPythonSettings: (settings: { pythonPath: string; allowNetwork: boolean }) =>
      invoke(Channels.COMPUTE_SET_PYTHON_SETTINGS, settings),
    probePython: (candidate?: string) =>
      invoke(Channels.COMPUTE_PROBE_PYTHON, candidate),
    browsePython: () => invoke(Channels.COMPUTE_BROWSE_PYTHON),
    consentStatus: (language: string, code: string) =>
      invoke(Channels.COMPUTE_CONSENT_STATUS, language, code),
    grantConsent: (language: string, code: string, scope: 'cell' | 'project') =>
      invoke(Channels.COMPUTE_GRANT_CONSENT, language, code, scope),
    listConsent: () => invoke(Channels.COMPUTE_LIST_CONSENT),
    revokeConsent: (rootPath: string) => invoke(Channels.COMPUTE_REVOKE_CONSENT, rootPath),
    revealAuditLog: () => invoke(Channels.COMPUTE_REVEAL_AUDIT_LOG),
  },
  publish: {
    listExporters: () => invoke(Channels.PUBLISH_LIST_EXPORTERS),
    resolvePlan: (input: Parameters<ChannelMap['publish:resolvePlan']>[0], opts?: Parameters<ChannelMap['publish:resolvePlan']>[1]) =>
      invoke(Channels.PUBLISH_RESOLVE_PLAN, input, opts),
    runExport: (args: Parameters<ChannelMap['publish:runExport']>[0]) => invoke(Channels.PUBLISH_RUN_EXPORT, args),
    listTargets: () => invoke(Channels.PUBLISH_LIST_TARGETS),
    upsertTarget: (target: Parameters<ChannelMap['publish:upsertTarget']>[0]) => invoke(Channels.PUBLISH_UPSERT_TARGET, target),
    removeTarget: (id: string) => invoke(Channels.PUBLISH_REMOVE_TARGET, id),
    toGit: (targetId: string, opts?: Parameters<ChannelMap['publish:toGit']>[1]) =>
      invoke(Channels.PUBLISH_TO_GIT, targetId, opts),
    checkS3: (config: Parameters<ChannelMap['publish:checkS3']>[0]) =>
      invoke(Channels.PUBLISH_CHECK_S3, config),
    checkGitHub: (config: Parameters<ChannelMap['publish:checkGitHub']>[0]) =>
      invoke(Channels.PUBLISH_CHECK_GITHUB, config),
  },
  app: {
    getInfo: () => invoke(Channels.APP_GET_INFO),
    getShortcuts: () => invoke(Channels.APP_GET_SHORTCUTS),
  },
  images: {
    // Cached-or-fetched bytes+mime for an external image URL (offline cache, #...).
    cacheExternal: (url: string) => invoke(Channels.IMAGES_CACHE_EXTERNAL, url),
  },
  youtube: {
    // Cached-or-fetched poster bytes for a video id (offline cache, #...).
    thumbnail: (id: string) => invoke(Channels.YOUTUBE_THUMBNAIL, id),
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
    showEmojiPanel: () => invoke(Channels.SHELL_SHOW_EMOJI_PANEL),
  },
  conversations: {
    create: (contextBundle: Parameters<ChannelMap['conversation:create']>[0], triggerNodeUri?: string, options?: Parameters<ChannelMap['conversation:create']>[2]) =>
      invoke(Channels.CONVERSATION_CREATE, contextBundle, triggerNodeUri, options),
    append: (id: string, role: Parameters<ChannelMap['conversation:append']>[1], content: string) =>
      invoke(Channels.CONVERSATION_APPEND, id, role, content),
    archive: (id: string) => invoke(Channels.CONVERSATION_ARCHIVE, id),
    load: (id: string) => invoke(Channels.CONVERSATION_LOAD, id),
    list: () => invoke(Channels.CONVERSATION_LIST),
    listActive: () => invoke(Channels.CONVERSATION_LIST_ACTIVE),
    send: (convId: string, userMessage: string, systemPrompt?: string, currentNotePath?: string, extraTools?: Parameters<ChannelMap['conversation:send']>[4]) =>
      invoke(Channels.CONVERSATION_SEND, convId, userMessage, systemPrompt, currentNotePath, extraTools),
    retry: (convId: string, systemPrompt?: string, currentNotePath?: string, extraTools?: Parameters<ChannelMap['conversation:retry']>[3]) =>
      invoke(Channels.CONVERSATION_RETRY, convId, systemPrompt, currentNotePath, extraTools),
    loadUIState: () => invoke(Channels.CONVERSATION_UI_STATE_LOAD),
    saveUIState: (state: Parameters<ChannelMap['conversation:uiStateSave']>[0]) => invoke(Channels.CONVERSATION_UI_STATE_SAVE, state),
    onAskUser: (cb: (req: AskUserRequest) => void) => subscribe(Channels.CONVERSATION_ASK_USER, cb),
    askUserReply: (questionId: string, answer: string) =>
      invoke(Channels.CONVERSATION_ASK_USER_REPLY, questionId, answer),
    onStream: (cb: (chunk: string) => void) => subscribe(Channels.CONVERSATION_STREAM, cb),
    cancel: () => invoke(Channels.CONVERSATION_CANCEL),
    onDraft: (cb: (draft: ConversationDraftBase) => void) => subscribe(Channels.CONVERSATION_DRAFT, cb),
    fileDraft: (draft: Parameters<ChannelMap['conversation:fileDraft']>[0]) => invoke(Channels.CONVERSATION_FILE_DRAFT, draft),
    onSourceDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_SOURCE_DRAFT, cb),
    fileSourceDraft: (draft: Parameters<ChannelMap['conversation:fileSourceDraft']>[0]) =>
      invoke(Channels.CONVERSATION_FILE_SOURCE_DRAFT, draft),
    onPropertyDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_PROPERTY_DRAFT, cb),
    filePropertyDraft: (draft: Parameters<ChannelMap['conversation:filePropertyDraft']>[0]) =>
      invoke(Channels.CONVERSATION_FILE_PROPERTY_DRAFT, draft),
    onSourcePropertyDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_SOURCE_PROPERTY_DRAFT, cb),
    fileSourcePropertyDraft: (draft: Parameters<ChannelMap['conversation:fileSourcePropertyDraft']>[0]) =>
      invoke(Channels.CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT, draft),
    onClaimsDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_CLAIMS_DRAFT, cb),
    fileClaimsDraft: (draft: Parameters<ChannelMap['conversation:fileClaimsDraft']>[0]) =>
      invoke(Channels.CONVERSATION_FILE_CLAIMS_DRAFT, draft),
    onComputeDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_COMPUTE_DRAFT, cb),
    runComputeDraft: (input: Parameters<ChannelMap['conversation:runComputeDraft']>[0]) =>
      invoke(Channels.CONVERSATION_RUN_COMPUTE_DRAFT, input),
    onRefactorDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_REFACTOR_DRAFT, cb),
    fileRefactorDraft: (draft: Parameters<ChannelMap['conversation:fileRefactorDraft']>[0]) =>
      invoke(Channels.CONVERSATION_FILE_REFACTOR_DRAFT, draft),
    onReorgDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_REORG_DRAFT, cb),
    fileReorgDraft: (draft: Parameters<ChannelMap['conversation:fileReorgDraft']>[0], selected: Parameters<ChannelMap['conversation:fileReorgDraft']>[1]) =>
      invoke(Channels.CONVERSATION_FILE_REORG_DRAFT, draft, selected),
    onDeleteDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_DELETE_DRAFT, cb),
    fileDeleteDraft: (draft: Parameters<ChannelMap['conversation:fileDeleteDraft']>[0], selected: Parameters<ChannelMap['conversation:fileDeleteDraft']>[1]) =>
      invoke(Channels.CONVERSATION_FILE_DELETE_DRAFT, draft, selected),
    onNoteBodyDraft: (cb: (draft: ConversationDraftBase) => void) =>
      subscribe(Channels.CONVERSATION_NOTE_BODY_DRAFT, cb),
    fileNoteBodyDraft: (draft: Parameters<ChannelMap['conversation:fileNoteBodyDraft']>[0], selected: Parameters<ChannelMap['conversation:fileNoteBodyDraft']>[1]) =>
      invoke(Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT, draft, selected),
    insertComputeDraft: (input: Parameters<ChannelMap['conversation:insertComputeDraft']>[0]) =>
      invoke(Channels.CONVERSATION_INSERT_COMPUTE_DRAFT, input),
    setModel: (conversationId: string, model: string | undefined) =>
      invoke(Channels.CONVERSATION_SET_MODEL, conversationId, model),
    setEffort: (conversationId: string, effort: Parameters<ChannelMap['conversation:setEffort']>[1]) =>
      invoke(Channels.CONVERSATION_SET_EFFORT, conversationId, effort),
    compact: (conversationId: string) =>
      invoke(Channels.CONVERSATION_COMPACT, conversationId),
  },
  proposals: {
    list: (status?: string) => invoke(Channels.PROPOSAL_LIST, status),
    detail: (uri: string) => invoke(Channels.PROPOSAL_DETAIL, uri),
    approve: (uri: string) => invoke(Channels.PROPOSAL_APPROVE, uri),
    reject: (uri: string) => invoke(Channels.PROPOSAL_REJECT, uri),
    expire: () => invoke(Channels.PROPOSAL_EXPIRE),
    /** The pending-proposal set changed — filed in-app, filed out-of-process
     *  and routed through the substrate server, approved, rejected, or expired
     *  (#1524). The proposals store re-fetches on this. */
    onChanged: (cb: () => void) => subscribe(Channels.PROPOSALS_CHANGED, cb),
    /** Ask main to raise a native OS notification for a proposal that arrived
     *  while Minerva was unfocused (#1541). */
    notifyArrival: (arg: { count: number; proposer: string }) =>
      invoke(Channels.PROPOSALS_NOTIFY_ARRIVAL, arg),
    /** Main asks the renderer to surface the Proposals panel (native arrival
     *  notification clicked, #1541). */
    onShowRequested: (cb: () => void) => subscribe(Channels.PROPOSALS_SHOW, cb),
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
  history: {
    list: (relativePath: string) => invoke(Channels.HISTORY_LIST, relativePath),
    getRevision: (relativePath: string, ts: number) => invoke(Channels.HISTORY_GET_REVISION, relativePath, ts),
    restore: (relativePath: string, ts: number) => invoke(Channels.HISTORY_RESTORE, relativePath, ts),
    setLabel: (relativePath: string, ts: number, label: string | null) =>
      invoke(Channels.HISTORY_SET_LABEL, relativePath, ts, label),
    labelNotes: (relativePaths: string[], label: string) =>
      invoke(Channels.HISTORY_LABEL_NOTES, relativePaths, label),
    onChanged: (cb: (relPath: string | null) => void) => subscribe(Channels.HISTORY_CHANGED, cb),
    getSettings: () => invoke(Channels.HISTORY_GET_SETTINGS),
    setSettings: (settings: Parameters<ChannelMap['history:setSettings']>[0]) =>
      invoke(Channels.HISTORY_SET_SETTINGS, settings),
  },
  refactor: {
    autoTagSuggest: (relativePath: string) => invoke(Channels.REFACTOR_AUTO_TAG_SUGGEST, relativePath),
    autoTagApply: (relativePath: string, acceptedTags: string[]) =>
      invoke(Channels.REFACTOR_AUTO_TAG_APPLY, relativePath, acceptedTags),
    autoLinkSuggest: (relativePath: string) =>
      invoke(Channels.REFACTOR_AUTO_LINK_SUGGEST, relativePath),
    autoLinkApply: (relativePath: string, accepted: Parameters<ChannelMap['refactor:autoLinkApply']>[1]) =>
      invoke(Channels.REFACTOR_AUTO_LINK_APPLY, relativePath, accepted),
    applySuggestedLink: (activeRelPath: string, targetRelPath: string) =>
      invoke(Channels.REFACTOR_APPLY_SUGGESTED_LINK, activeRelPath, targetRelPath),
    autoLinkInboundSuggest: (relativePath: string) =>
      invoke(Channels.REFACTOR_AUTO_LINK_INBOUND_SUGGEST, relativePath),
    autoLinkInboundApply: (relativePath: string, accepted: Parameters<ChannelMap['refactor:autoLinkInboundApply']>[1]) =>
      invoke(Channels.REFACTOR_AUTO_LINK_INBOUND_APPLY, relativePath, accepted),
  },
  sources: {
    ingestUrl: (url: string) => invoke(Channels.SOURCES_INGEST_URL, url),
    ingestIdentifier: (identifier: string) =>
      invoke(Channels.SOURCES_INGEST_IDENTIFIER, identifier),
    ingestFile: () => invoke(Channels.SOURCES_INGEST_FILE),
    readPdf: (sourceId: string) => invoke(Channels.SOURCES_READ_PDF, sourceId),
    hasPdf: (sourceId: string) => invoke(Channels.SOURCES_HAS_PDF, sourceId),
    getExcerptNoteFolder: () => invoke(Channels.EXCERPT_GET_NOTE_FOLDER),
    setExcerptNoteFolder: (folder: string) =>
      invoke(Channels.EXCERPT_SET_NOTE_FOLDER, folder),
    finishPdfOcr: (sourceId: string, pages: string[]) =>
      invoke(Channels.SOURCES_FINISH_PDF_OCR, sourceId, pages),
    importBibtex: () => invoke(Channels.SOURCES_IMPORT_BIBTEX),
    onImportBibtexProgress: (cb: (progress: { done: number; total: number; currentTitle: string }) => void) =>
      subscribe(Channels.SOURCES_IMPORT_BIBTEX_PROGRESS, cb),
    importZoteroRdf: () => invoke(Channels.SOURCES_IMPORT_ZOTERO_RDF),
    onImportZoteroRdfProgress: (cb: (progress: { done: number; total: number; currentTitle: string }) => void) =>
      subscribe(Channels.SOURCES_IMPORT_ZOTERO_RDF_PROGRESS, cb),
    listAll: () => invoke(Channels.SOURCES_LIST_ALL),
    delete: (sourceId: string) => invoke(Channels.SOURCES_DELETE, sourceId),
    merge: (srcId: string, destId: string) =>
      invoke(Channels.SOURCES_MERGE, { srcId, destId }),
    setReadStatus: (sourceId: string, status: 'unread' | 'reading' | 'read' | 'skipped' | null) =>
      invoke(Channels.SOURCES_SET_READ_STATUS, { sourceId, status }),
    setTitle: (sourceId: string, title: string) =>
      invoke(Channels.SOURCES_SET_TITLE, { sourceId, title }),
    setReadDueBy: (sourceId: string, dueBy: string | null) =>
      invoke(Channels.SOURCES_SET_READ_DUE_BY, { sourceId, dueBy }),
    addTag: (sourceId: string, tag: string) =>
      invoke(Channels.SOURCES_ADD_TAG, { sourceId, tag }),
    removeTag: (sourceId: string, tag: string) =>
      invoke(Channels.SOURCES_REMOVE_TAG, { sourceId, tag }),
    queueMembers: (view: 'unread' | 'reading' | 'dueThisWeek' | 'recentlyFinished') =>
      invoke(Channels.SOURCES_QUEUE_MEMBERS, view),
    stripUpstreamTags: (sourceId: string) =>
      invoke(Channels.SOURCES_STRIP_UPSTREAM_TAGS, sourceId),
    getIngestSettings: () => invoke(Channels.INGEST_GET_SETTINGS),
    setIngestSettings: (settings: { importUpstreamTags: boolean }) =>
      invoke(Channels.INGEST_SET_SETTINGS, settings),
    ingestSmart: (rawInput: string) =>
      invoke(Channels.SOURCES_INGEST_SMART, rawInput),
    mineReferences: (sourceId: string) =>
      invoke(Channels.SOURCES_MINE_REFERENCES, sourceId),
    createReferenceStubs: (sourceId: string, refs: Parameters<ChannelMap['sources:createReferenceStubs']>[0]['refs']) =>
      invoke(Channels.SOURCES_CREATE_REFERENCE_STUBS, { sourceId, refs }),
    resolveStub: (sourceId: string) =>
      invoke(Channels.SOURCES_RESOLVE_STUB, sourceId),
    applyStubResolution: (sourceId: string, doi: string) =>
      invoke(Channels.SOURCES_APPLY_STUB_RESOLUTION, { sourceId, doi }),
    onChanged: (cb: () => void) => subscribe(Channels.SOURCES_CHANGED, cb),
    createExcerpt: (params: {
      sourceId: string;
      citedText: string;
      page?: number | null;
      pageRange?: string | null;
      locationText?: string | null;
    }) => invoke(Channels.SOURCES_CREATE_EXCERPT, params),
    onExcerptsChanged: (cb: () => void) => subscribe(Channels.EXCERPTS_CHANGED, () => cb()),
  },
  collections: {
    list: () => invoke(Channels.COLLECTIONS_LIST),
    create: (args: { name: string; parent?: string | null }) =>
      invoke(Channels.COLLECTIONS_CREATE, args),
    rename: (id: string, name: string) =>
      invoke(Channels.COLLECTIONS_RENAME, { id, name }),
    remove: (id: string) => invoke(Channels.COLLECTIONS_DELETE, id),
    addSource: (collectionId: string, sourceId: string) =>
      invoke(Channels.COLLECTIONS_ADD_SOURCE, { collectionId, sourceId }),
    removeSource: (collectionId: string, sourceId: string) =>
      invoke(Channels.COLLECTIONS_REMOVE_SOURCE, { collectionId, sourceId }),
    createSmart: (args: { name: string; predicate: { kind: 'tags'; allOf: string[] } }) =>
      invoke(Channels.COLLECTIONS_CREATE_SMART, args),
    renameSmart: (id: string, name: string) =>
      invoke(Channels.COLLECTIONS_RENAME_SMART, { id, name }),
    removeSmart: (id: string) => invoke(Channels.COLLECTIONS_DELETE_SMART, id),
    updateSmartPredicate: (id: string, predicate: { kind: 'tags'; allOf: string[] }) =>
      invoke(Channels.COLLECTIONS_UPDATE_SMART_PREDICATE, { id, predicate }),
    smartMembers: (id: string) =>
      invoke(Channels.COLLECTIONS_SMART_MEMBERS, id),
    onChanged: (cb: () => void) => subscribe(Channels.COLLECTIONS_CHANGED, cb),
  },
  formatter: {
    formatContent: (content: string, settings: Parameters<ChannelMap['formatter:formatContent']>[1], relativePath?: string) =>
      invoke(Channels.FORMATTER_FORMAT_CONTENT, content, settings, relativePath),
    formatFile: (relativePath: string, settings: Parameters<ChannelMap['formatter:formatFile']>[1]) =>
      invoke(Channels.FORMATTER_FORMAT_FILE, relativePath, settings),
    formatFolder: (relDir: string, settings: Parameters<ChannelMap['formatter:formatFolder']>[1]) =>
      invoke(Channels.FORMATTER_FORMAT_FOLDER, relDir, settings),
    loadSettings: () => invoke(Channels.FORMATTER_LOAD_SETTINGS),
    saveSettings: (settings: Parameters<ChannelMap['formatter:saveSettings']>[0]) =>
      invoke(Channels.FORMATTER_SAVE_SETTINGS, settings),
  },
  tools: {
    execute: (request: Parameters<ChannelMap['tool:execute']>[0]) => invoke(Channels.TOOL_EXECUTE, request),
    prepareConversation: (request: Parameters<ChannelMap['tool:prepareConversation']>[0]) => invoke(Channels.TOOL_PREPARE_CONVERSATION, request),
    cancel: () => invoke(Channels.TOOL_CANCEL),
    onStream: (cb: (chunk: string) => void) => subscribe(Channels.TOOL_STREAM, cb),
    getSettings: () => invoke(Channels.TOOL_GET_SETTINGS),
    setSettings: (settings: Parameters<ChannelMap['tool:setSettings']>[0]) => invoke(Channels.TOOL_SET_SETTINGS, settings),
    getKeyStorage: () => invoke(Channels.TOOL_GET_KEY_STORAGE),
    checkConnection: (providerId: Parameters<ChannelMap['tool:checkConnection']>[0], candidateKey?: string, baseURL?: string) =>
      invoke(Channels.TOOL_CHECK_CONNECTION, providerId, candidateKey, baseURL),
    onInvoke: (cb: (toolId: string) => void) => subscribe(Channels.TOOL_INVOKE, cb),
  },
  types: {
    list: () => invoke(Channels.TYPES_LIST),
    noteProperties: (relativePath: string) => invoke(Channels.TYPES_NOTE_PROPERTIES, relativePath),
    instances: (typeId: string) => invoke(Channels.TYPES_INSTANCES, typeId),
    noteTypeMap: () => invoke(Channels.TYPES_NOTE_TYPE_MAP),
    save: (input: Parameters<ChannelMap['types:save']>[0]) => invoke(Channels.TYPES_SAVE, input),
    delete: (id: string) => invoke(Channels.TYPES_DELETE, id),
    deleteSafely: (id: string, clearInstances: boolean) => invoke(Channels.TYPES_DELETE_SAFELY, id, clearInstances),
    rename: (oldId: string, newLabel: string) => invoke(Channels.TYPES_RENAME, oldId, newLabel),
  },
  skills: {
    list: () => invoke(Channels.SKILLS_LIST),
    reload: () => invoke(Channels.SKILLS_RELOAD),
    import: () => invoke(Channels.SKILLS_IMPORT),
    remove: (id: string) => invoke(Channels.SKILLS_REMOVE, id),
    revealFolder: () => invoke(Channels.SKILLS_REVEAL),
    setMenuConfig: (config: Parameters<ChannelMap['skills:menuConfig:set']>[0]) => invoke(Channels.SKILLS_MENU_CONFIG_SET, config),
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
    listStyles: () => invoke(Channels.BIBLIOGRAPHY_LIST_STYLES),
    getStyle: () => invoke(Channels.BIBLIOGRAPHY_GET_STYLE),
    setStyle: (styleId: string) =>
      invoke(Channels.BIBLIOGRAPHY_SET_STYLE, styleId),
    generate: (relativePath: string) =>
      invoke(Channels.BIBLIOGRAPHY_GENERATE, relativePath),
  },
  csl: {
    listUserStyles: () => invoke(Channels.CSL_LIST_USER_STYLES),
    listUserLocales: () => invoke(Channels.CSL_LIST_USER_LOCALES),
    importStyle: () => invoke(Channels.CSL_IMPORT_STYLE),
    importLocale: () => invoke(Channels.CSL_IMPORT_LOCALE),
    removeStyle: (id: string) => invoke(Channels.CSL_REMOVE_STYLE, id),
    removeLocale: (id: string) => invoke(Channels.CSL_REMOVE_LOCALE, id),
  },
  citations: {
    renderInline: (refs: { kind: 'cite' | 'quote'; id: string }[]) =>
      invoke(Channels.CITATION_RENDER_INLINE, refs),
  },
  menu: {
    onNewNote: (cb: () => void) => subscribe(Channels.MENU_NEW_NOTE, cb),
    onEditThoughtbaseDoc: (cb: () => void) => subscribe(Channels.MENU_EDIT_THOUGHTBASE_DOC, cb),
    onThoughtbaseProperties: (cb: () => void) => subscribe(Channels.MENU_THOUGHTBASE_PROPERTIES, cb),
    onSave: (cb: () => void) => subscribe(Channels.MENU_SAVE, cb),
    onSaveAsObjectType: (cb: () => void) => subscribe(Channels.MENU_SAVE_AS_OBJECT_TYPE, cb),
    onSaveAsTemplate: (cb: () => void) => subscribe(Channels.MENU_SAVE_AS_TEMPLATE, cb),
    onInsertTemplate: (cb: () => void) => subscribe(Channels.MENU_INSERT_TEMPLATE, cb),
    onToggleSidebar: (cb: () => void) => subscribe(Channels.MENU_TOGGLE_SIDEBAR, cb),
    onTogglePreview: (cb: () => void) => subscribe(Channels.MENU_TOGGLE_PREVIEW, cb),
    onQuickOpen: (cb: () => void) => subscribe(Channels.MENU_QUICK_OPEN, cb),
    onCycleTheme: (cb: () => void) => subscribe(Channels.MENU_CYCLE_THEME, cb),
    onSetTheme: (cb: (mode: ThemeMode) => void) => subscribe(Channels.MENU_SET_THEME, cb),
    reportTheme: (mode: ThemeMode) => ipcRenderer.send(Channels.MENU_REPORT_THEME, mode),
    reportEditorState: (state: MenuEditorState) => ipcRenderer.send(Channels.MENU_REPORT_EDITOR_STATE, state),
    onSplitRight: (cb: () => void) => subscribe(Channels.MENU_SPLIT_RIGHT, cb),
    onSplitDown: (cb: () => void) => subscribe(Channels.MENU_SPLIT_DOWN, cb),
    onFocusNextGroup: (cb: () => void) => subscribe(Channels.MENU_FOCUS_NEXT_GROUP, cb),
    onFocusPrevGroup: (cb: () => void) => subscribe(Channels.MENU_FOCUS_PREV_GROUP, cb),
    onCloseGroup: (cb: () => void) => subscribe(Channels.MENU_CLOSE_GROUP, cb),
    onFontIncrease: (cb: () => void) => subscribe(Channels.MENU_FONT_INCREASE, cb),
    onFontDecrease: (cb: () => void) => subscribe(Channels.MENU_FONT_DECREASE, cb),
    onFontReset: (cb: () => void) => subscribe(Channels.MENU_FONT_RESET, cb),
    onToggleRightSidebar: (cb: () => void) => subscribe(Channels.MENU_TOGGLE_RIGHT_SIDEBAR, cb),
    onToggleConversations: (cb: () => void) => subscribe(Channels.MENU_TOGGLE_CONVERSATIONS, cb),
    onNewConversation: (cb: () => void) => subscribe(Channels.MENU_NEW_CONVERSATION, cb),
    onNavBack: (cb: () => void) => subscribe(Channels.MENU_NAV_BACK, cb),
    onNavForward: (cb: () => void) => subscribe(Channels.MENU_NAV_FORWARD, cb),
    onGotoLine: (cb: () => void) => subscribe(Channels.MENU_GOTO_LINE, cb),
    onFind: (cb: () => void) => subscribe(Channels.MENU_FIND, cb),
    onFindReplace: (cb: () => void) => subscribe(Channels.MENU_FIND_REPLACE, cb),
    onFindInNotes: (cb: () => void) => subscribe(Channels.MENU_FIND_IN_NOTES, cb),
    onReplaceInNotes: (cb: () => void) => subscribe(Channels.MENU_REPLACE_IN_NOTES, cb),
    onNewQuery: (cb: () => void) => subscribe(Channels.MENU_NEW_QUERY, cb),
    onOpenStockQuery: (cb: (payload: { query: string; language: 'sparql' | 'sql' }) => void) =>
      subscribe(Channels.MENU_OPEN_STOCK_QUERY, cb),
    onEditSavedQueries: (cb: () => void) => subscribe(Channels.MENU_EDIT_SAVED_QUERIES, cb),
    onSortLines: (cb: () => void) => subscribe(Channels.MENU_SORT_LINES, cb),
    onOpenSettings: (cb: () => void) => subscribe(Channels.MENU_OPEN_SETTINGS, cb),
    onOpenProject: (cb: () => void) => subscribe(Channels.MENU_OPEN_PROJECT, cb),
    onNewProject: (cb: () => void) => subscribe(Channels.MENU_NEW_PROJECT, cb),
    onInstallTutorial: (cb: () => void) => subscribe(Channels.MENU_INSTALL_TUTORIAL, cb),
    onOpenRecentProject: (cb: (path: string) => void) => subscribe('menu:openRecentProject', cb),
    onCloseProject: (cb: () => void) => subscribe(Channels.MENU_CLOSE_PROJECT, cb),
    onClearRecent: (cb: () => void) => subscribe(Channels.MENU_CLEAR_RECENT, cb),
    onPrint: (cb: () => void) => subscribe(Channels.MENU_PRINT, cb),
    onAbout: (cb: () => void) => subscribe(Channels.MENU_ABOUT, cb),
    onShortcuts: (cb: () => void) => subscribe(Channels.MENU_SHORTCUTS, cb),
    onOpenInDefault: (cb: () => void) => subscribe(Channels.MENU_OPEN_IN_DEFAULT, cb),
    onOpenInTerminal: (cb: () => void) => subscribe(Channels.MENU_OPEN_IN_TERMINAL, cb),
    onRefactorRename: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_RENAME, cb),
    onRefactorMove: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_MOVE, cb),
    onRefactorCopy: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_COPY, cb),
    onRefactorExtract: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_EXTRACT, cb),
    onRefactorSplitHere: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_SPLIT_HERE, cb),
    onRefactorSplitByHeading: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_SPLIT_BY_HEADING, cb),
    onRefactorAutoTag: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_AUTOTAG, cb),
    onRefactorAutoLink: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_AUTOLINK, cb),
    onRefactorAutoLinkInbound: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_AUTOLINK_INBOUND, cb),
    onRefactorDecompose: (cb: () => void) => subscribe(Channels.MENU_REFACTOR_DECOMPOSE, cb),
    onFormat: (cb: () => void) => subscribe(Channels.MENU_FORMAT, cb),
    onBibliography: (cb: () => void) => subscribe(Channels.MENU_BIBLIOGRAPHY, cb),
    onIngestUrl: (cb: () => void) => subscribe(Channels.MENU_INGEST_URL, cb),
    onIngestIdentifier: (cb: () => void) => subscribe(Channels.MENU_INGEST_IDENTIFIER, cb),
    onIngestFile: (cb: () => void) => subscribe(Channels.MENU_INGEST_FILE, cb),
    onExport: (cb: (exporterId: string) => void) => subscribe(Channels.MENU_EXPORT, cb),
    onPublish: (cb: () => void) => subscribe(Channels.MENU_PUBLISH, cb),
    onImportBibtex: (cb: () => void) => subscribe(Channels.MENU_IMPORT_BIBTEX, cb),
    onImportZoteroRdf: (cb: () => void) => subscribe(Channels.MENU_IMPORT_ZOTERO_RDF, cb),
    onProjectOpened: (cb: (meta: { rootPath: string; name: string }) => void) =>
      subscribe(Channels.PROJECT_OPENED, cb),
  },
});

