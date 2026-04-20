import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';

contextBridge.exposeInMainWorld('api', {
  notebase: {
    open: () => ipcRenderer.invoke(Channels.NOTEBASE_OPEN),
    openPath: (rootPath: string) => ipcRenderer.invoke('notebase:openPath', rootPath),
    newProject: () => ipcRenderer.invoke('notebase:newProject'),
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
    onFileChanged: (cb: (path: string) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_FILE_CHANGED, (_e, p) => cb(p));
    },
    onFileCreated: (cb: (path: string) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_FILE_CREATED, (_e, p) => cb(p));
    },
    onFileDeleted: (cb: (path: string) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_FILE_DELETED, (_e, p) => cb(p));
    },
    onRenamed: (cb: (transitions: Array<{ old: string; new: string }>) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_RENAMED, (_e, transitions) => cb(transitions));
    },
    onRewritten: (cb: (paths: string[]) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_REWRITTEN, (_e, paths) => cb(paths));
    },
    onHeadingRenameSuggested: (cb: (candidate: {
      relativePath: string;
      oldSlug: string;
      oldText: string;
      newSlug: string;
      newText: string;
      incomingLinkCount: number;
    }) => void) => {
      ipcRenderer.on(Channels.NOTEBASE_HEADING_RENAME_SUGGESTED, (_e, c) => cb(c));
    },
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
  },
  queries: {
    list: () => ipcRenderer.invoke(Channels.QUERIES_LIST),
    save: (scope: string, name: string, description: string, query: string) =>
      ipcRenderer.invoke(Channels.QUERIES_SAVE, scope, name, description, query),
    delete: (filePath: string) => ipcRenderer.invoke(Channels.QUERIES_DELETE, filePath),
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
    rebuild: () => ipcRenderer.invoke(Channels.GRAPH_REBUILD),
    groundCheck: (claimText: string) => ipcRenderer.invoke(Channels.GRAPH_GROUND_CHECK, claimText),
    inspections: () => ipcRenderer.invoke(Channels.INSPECTIONS_LIST),
    runInspections: () => ipcRenderer.invoke(Channels.INSPECTIONS_RUN),
    export: () => ipcRenderer.invoke(Channels.GRAPH_EXPORT),
    sourceDetail: (sourceId: string) => ipcRenderer.invoke(Channels.GRAPH_SOURCE_DETAIL, sourceId),
    excerptSource: (excerptId: string) => ipcRenderer.invoke(Channels.GRAPH_EXCERPT_SOURCE, excerptId),
    schemaForCompletion: () => ipcRenderer.invoke(Channels.GRAPH_SCHEMA_FOR_COMPLETION),
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
    onStream: (cb: (chunk: string) => void) => {
      ipcRenderer.on(Channels.CONVERSATION_STREAM, (_e, chunk) => cb(chunk));
    },
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
  tools: {
    execute: (request: unknown) => ipcRenderer.invoke(Channels.TOOL_EXECUTE, request),
    prepareConversation: (request: unknown) => ipcRenderer.invoke(Channels.TOOL_PREPARE_CONVERSATION, request),
    cancel: () => ipcRenderer.invoke(Channels.TOOL_CANCEL),
    onStream: (cb: (chunk: string) => void) => {
      ipcRenderer.on(Channels.TOOL_STREAM, (_e, chunk) => cb(chunk));
    },
    getSettings: () => ipcRenderer.invoke(Channels.TOOL_GET_SETTINGS),
    setSettings: (settings: unknown) => ipcRenderer.invoke(Channels.TOOL_SET_SETTINGS, settings),
    onInvoke: (cb: (toolId: string) => void) => {
      ipcRenderer.on(Channels.TOOL_INVOKE, (_e, toolId) => cb(toolId));
    },
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
    onNewQuery: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_NEW_QUERY, () => cb());
    },
    onSaveQuery: (cb: () => void) => {
      ipcRenderer.on(Channels.MENU_SAVE_QUERY, () => cb());
    },
    onOpenStockQuery: (cb: (query: string) => void) => {
      ipcRenderer.on(Channels.MENU_OPEN_STOCK_QUERY, (_e, q) => cb(q));
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
    onOpenRecentProject: (cb: (path: string) => void) => {
      ipcRenderer.on('menu:openRecentProject', (_e, p) => cb(p));
    },
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
    onProjectOpened: (cb: (meta: { rootPath: string; name: string }) => void) => {
      ipcRenderer.on('project:opened', (_e, meta) => cb(meta));
    },
  },
});

