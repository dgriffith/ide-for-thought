export const Channels = {
  // Notebase
  NOTEBASE_OPEN: 'notebase:open',
  NOTEBASE_LIST_FILES: 'notebase:listFiles',
  NOTEBASE_READ_FILE: 'notebase:readFile',
  NOTEBASE_WRITE_FILE: 'notebase:writeFile',
  NOTEBASE_CREATE_FILE: 'notebase:createFile',
  NOTEBASE_DELETE_FILE: 'notebase:deleteFile',
  NOTEBASE_CREATE_FOLDER: 'notebase:createFolder',
  NOTEBASE_DELETE_FOLDER: 'notebase:deleteFolder',
  NOTEBASE_RENAME: 'notebase:rename',
  NOTEBASE_COPY: 'notebase:copy',

  // File watcher events (main → renderer)
  NOTEBASE_FILE_CHANGED: 'notebase:fileChanged',
  NOTEBASE_FILE_CREATED: 'notebase:fileCreated',
  NOTEBASE_FILE_DELETED: 'notebase:fileDeleted',
  /** Emitted by the main process after a note rename completes. Payload is PathTransition[]. */
  NOTEBASE_RENAMED: 'notebase:renamed',
  /** Emitted after link-rewrites touched other notes' content. Payload is string[] (relativePaths). */
  NOTEBASE_REWRITTEN: 'notebase:rewritten',
  /** Emitted when indexNote detects a single-heading rename with incoming links (main → renderer). */
  NOTEBASE_HEADING_RENAME_SUGGESTED: 'notebase:headingRenameSuggested',
  /** Renderer-initiated rewrite of `[[path#oldSlug]]` → `[[path#newSlug]]`. */
  NOTEBASE_RENAME_ANCHOR: 'notebase:renameAnchor',
  /** Rename a Source (directory under `.minerva/sources/`) and rewrite `[[cite::id]]`. */
  NOTEBASE_RENAME_SOURCE: 'notebase:renameSource',
  /** Rename an Excerpt (file under `.minerva/excerpts/`) and rewrite `[[quote::id]]`. */
  NOTEBASE_RENAME_EXCERPT: 'notebase:renameExcerpt',

  // Links
  LINKS_OUTGOING: 'links:outgoing',
  LINKS_BACKLINKS: 'links:backlinks',

  // Saved queries
  QUERIES_LIST: 'queries:list',
  QUERIES_SAVE: 'queries:save',
  QUERIES_DELETE: 'queries:delete',

  // Search
  SEARCH_QUERY: 'search:query',

  // Git (stubs)
  GIT_STATUS: 'git:status',
  GIT_COMMIT: 'git:commit',

  // Graph
  GRAPH_QUERY: 'graph:query',
  /** Snapshot of the live graph's predicates + classes for SPARQL autocomplete (#198). */
  GRAPH_SCHEMA_FOR_COMPLETION: 'graph:schemaForCompletion',
  GRAPH_SOURCE_DETAIL: 'graph:sourceDetail',
  GRAPH_EXCERPT_SOURCE: 'graph:excerptSource',

  // Tags
  TAGS_LIST: 'tags:list',
  TAGS_NOTES_BY_TAG: 'tags:notesByTag',
  TAGS_SOURCES_BY_TAG: 'tags:sourcesByTag',
  TAGS_ALL_NAMES: 'tags:allNames',

  // Menu → renderer events (main sends, renderer listens)
  MENU_NEW_NOTE: 'menu:newNote',
  MENU_SAVE: 'menu:save',
  MENU_TOGGLE_SIDEBAR: 'menu:toggleSidebar',
  MENU_TOGGLE_PREVIEW: 'menu:togglePreview',
  MENU_TOGGLE_RIGHT_SIDEBAR: 'menu:toggleRightSidebar',
  MENU_CYCLE_THEME: 'menu:cycleTheme',
  MENU_FONT_INCREASE: 'menu:fontIncrease',
  MENU_FONT_DECREASE: 'menu:fontDecrease',
  MENU_FONT_RESET: 'menu:fontReset',
  MENU_QUICK_OPEN: 'menu:quickOpen',
  MENU_NAV_BACK: 'menu:navBack',
  MENU_NAV_FORWARD: 'menu:navForward',
  MENU_GOTO_LINE: 'menu:gotoLine',
  MENU_FIND: 'menu:find',
  MENU_FIND_REPLACE: 'menu:findReplace',
  MENU_TOGGLE_CASE: 'menu:toggleCase',
  MENU_EXTEND_SELECTION: 'menu:extendSelection',
  MENU_SHRINK_SELECTION: 'menu:shrinkSelection',
  MENU_JOIN_LINES: 'menu:joinLines',
  MENU_DUPLICATE_LINE: 'menu:duplicateLine',
  MENU_SORT_LINES: 'menu:sortLines',
  MENU_OPEN_SETTINGS: 'menu:openSettings',

  // Refactor menu (issue #172) — title-bar menu commands dispatched to the renderer.
  MENU_REFACTOR_RENAME: 'menu:refactor:rename',
  MENU_REFACTOR_MOVE: 'menu:refactor:move',
  MENU_REFACTOR_EXTRACT: 'menu:refactor:extract',
  MENU_REFACTOR_SPLIT_HERE: 'menu:refactor:splitHere',
  MENU_REFACTOR_SPLIT_BY_HEADING: 'menu:refactor:splitByHeading',
  MENU_REFACTOR_AUTOTAG: 'menu:refactor:autotag',
  MENU_REFACTOR_AUTOLINK: 'menu:refactor:autolink',
  MENU_REFACTOR_AUTOLINK_INBOUND: 'menu:refactor:autolinkInbound',
  MENU_REFACTOR_DECOMPOSE: 'menu:refactor:decompose',

  // Formatter menu (issue #153)
  MENU_FORMAT_CURRENT_NOTE: 'menu:format:currentNote',
  MENU_FORMAT_FOLDER: 'menu:format:folder',
  MENU_FORMAT_ALL: 'menu:format:all',

  /** Renderer-initiated LLM Auto-tag of a note (#174). */
  REFACTOR_AUTO_TAG: 'refactor:autoTag',
  /** LLM-suggested outbound wiki-links for a note (#175). */
  REFACTOR_AUTO_LINK_SUGGEST: 'refactor:autoLinkSuggest',
  /** Apply accepted Auto-link suggestions to the active note. */
  REFACTOR_AUTO_LINK_APPLY: 'refactor:autoLinkApply',
  /** LLM-suggested inbound wiki-links from other notes to the active note. */
  REFACTOR_AUTO_LINK_INBOUND_SUGGEST: 'refactor:autoLinkInboundSuggest',
  /** Apply accepted inbound Auto-link suggestions (writes to multiple source notes). */
  REFACTOR_AUTO_LINK_INBOUND_APPLY: 'refactor:autoLinkInboundApply',
  /** LLM-driven decomposition of a note into a parent index + children (#178). */
  REFACTOR_DECOMPOSE_SUGGEST: 'refactor:decomposeSuggest',

  /** Ingest a URL (#93). Fetches, runs Readability, persists under .minerva/sources/<id>/. */
  SOURCES_INGEST_URL: 'sources:ingestUrl',
  /** Menu → "Ingest URL…" — prompts the renderer for a URL and calls SOURCES_INGEST_URL. */
  MENU_INGEST_URL: 'menu:ingestUrl',

  /** Format a single file on disk (#153). Writes through the standard index+broadcast pipeline. */
  FORMATTER_FORMAT_FILE: 'formatter:formatFile',
  /** Format every .md under a relative folder (empty string = whole thoughtbase). */
  FORMATTER_FORMAT_FOLDER: 'formatter:formatFolder',
  /** Pure: format a content string and return the result (used for the active note's editor buffer). */
  FORMATTER_FORMAT_CONTENT: 'formatter:formatContent',
  /** Load per-rule enable + config map from .minerva/formatter.json. */
  FORMATTER_LOAD_SETTINGS: 'formatter:loadSettings',
  /** Write per-rule enable + config map to .minerva/formatter.json. */
  FORMATTER_SAVE_SETTINGS: 'formatter:saveSettings',

  // Graph
  MENU_NEW_QUERY: 'menu:newQuery',
  MENU_SAVE_QUERY: 'menu:saveQuery',
  MENU_OPEN_STOCK_QUERY: 'menu:openStockQuery',

  // Tools for Thought
  TOOL_INVOKE: 'tool:invoke',
  TOOL_EXECUTE: 'tool:execute',
  TOOL_STREAM: 'tool:stream',
  TOOL_CANCEL: 'tool:cancel',
  TOOL_GET_SETTINGS: 'tool:getSettings',
  TOOL_SET_SETTINGS: 'tool:setSettings',
  /** Prepare the system prompt + first message + model for a conversational tool. */
  TOOL_PREPARE_CONVERSATION: 'tool:prepareConversation',

  // Proposals
  PROPOSAL_LIST: 'proposal:list',
  PROPOSAL_DETAIL: 'proposal:detail',
  PROPOSAL_APPROVE: 'proposal:approve',
  PROPOSAL_REJECT: 'proposal:reject',
  PROPOSAL_EXPIRE: 'proposal:expire',

  // Conversations
  CONVERSATION_CREATE: 'conversation:create',
  CONVERSATION_APPEND: 'conversation:append',
  CONVERSATION_RESOLVE: 'conversation:resolve',
  CONVERSATION_ABANDON: 'conversation:abandon',
  CONVERSATION_LOAD: 'conversation:load',
  CONVERSATION_LIST: 'conversation:list',
  CONVERSATION_LIST_ACTIVE: 'conversation:listActive',
  CONVERSATION_SEND: 'conversation:send',
  CONVERSATION_STREAM: 'conversation:stream',
  CONVERSATION_CANCEL: 'conversation:cancel',
  CONVERSATION_CRYSTALLIZE: 'conversation:crystallize',
  CONVERSATION_SLASH_COMMAND: 'conversation:slashCommand',
  CONVERSATION_SET_MODEL: 'conversation:setModel',
  GRAPH_GROUND_CHECK: 'graph:groundCheck',
  INSPECTIONS_LIST: 'inspections:list',
  INSPECTIONS_RUN: 'inspections:run',

  // Bookmarks
  BOOKMARKS_LOAD: 'bookmarks:load',
  BOOKMARKS_SAVE: 'bookmarks:save',

  // Tab session
  TABS_SAVE: 'tabs:save',
  TABS_LOAD: 'tabs:load',

  // Renderer → main (for menu-triggered main-process actions)
  EXPORT_CSV: 'export:csv',
  SHELL_REVEAL_FILE: 'shell:revealFile',
  SHELL_OPEN_IN_DEFAULT: 'shell:openInDefault',
  SHELL_OPEN_IN_TERMINAL: 'shell:openInTerminal',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  GRAPH_REBUILD: 'graph:rebuild',
  GRAPH_EXPORT: 'graph:export',
} as const;
