export const Channels = {
  // Notebase
  NOTEBASE_OPEN: 'notebase:open',
  NOTEBASE_LIST_FILES: 'notebase:listFiles',
  NOTEBASE_READ_FILE: 'notebase:readFile',
  /** Read an arbitrary file as bytes — used by the Preview's image rule
   *  to inline `![](...)` references as data URLs (#244 image rendering). */
  NOTEBASE_READ_BINARY: 'notebase:readBinary',
  /** Write a binary blob (image / pdf / etc.) under a project-relative
   *  path. Used by the editor's image-upload-on-drop path (#455). */
  NOTEBASE_WRITE_BINARY: 'notebase:writeBinary',
  /** Cheap existence check — used by the upload path to dedupe
   *  content-hashed assets (#455). */
  NOTEBASE_FILE_EXISTS: 'notebase:fileExists',
  NOTEBASE_WRITE_FILE: 'notebase:writeFile',
  NOTEBASE_CREATE_FILE: 'notebase:createFile',
  NOTEBASE_DELETE_FILE: 'notebase:deleteFile',
  NOTEBASE_CREATE_FOLDER: 'notebase:createFolder',
  NOTEBASE_DELETE_FOLDER: 'notebase:deleteFolder',
  NOTEBASE_RENAME: 'notebase:rename',
  NOTEBASE_COPY: 'notebase:copy',
  NOTEBASE_SEARCH_IN_NOTES: 'notebase:searchInNotes',
  NOTEBASE_REPLACE_IN_NOTES: 'notebase:replaceInNotes',

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
  /** Coalesced fetch for the active-file link panels — one IPC, one
   *  graph-state round-trip, both directions back together (#351). */
  LINKS_BUNDLE: 'links:bundle',
  /**
   * Per-source aggregation of every citation in a note (#111). Driven
   * by the indexed `thought:cites` / `thought:quotes` edges; counts
   * come from re-scanning the note's content since the graph
   * deduplicates triples.
   */
  LINKS_CITATIONS_FOR_NOTE: 'links:citationsForNote',

  // Saved queries
  QUERIES_LIST: 'queries:list',
  QUERIES_SAVE: 'queries:save',
  QUERIES_DELETE: 'queries:delete',
  QUERIES_RENAME: 'queries:rename',
  /** Move a query between scopes (#314). */
  QUERIES_MOVE: 'queries:move',
  /** Re-tag a query's @group (#315). */
  QUERIES_SET_GROUP: 'queries:setGroup',
  /** Apply a new @order across many queries at once (#315 — drag-reorder). */
  QUERIES_SET_ORDER: 'queries:setOrder',

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
  MENU_FIND_IN_NOTES: 'menu:findInNotes',
  MENU_REPLACE_IN_NOTES: 'menu:replaceInNotes',
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
  MENU_REFACTOR_COPY: 'menu:refactor:copy',
  MENU_REFACTOR_EXTRACT: 'menu:refactor:extract',
  MENU_REFACTOR_SPLIT_HERE: 'menu:refactor:splitHere',
  MENU_REFACTOR_SPLIT_BY_HEADING: 'menu:refactor:splitByHeading',
  MENU_REFACTOR_AUTOTAG: 'menu:refactor:autotag',
  MENU_REFACTOR_AUTOLINK: 'menu:refactor:autolink',
  MENU_REFACTOR_AUTOLINK_INBOUND: 'menu:refactor:autolinkInbound',
  MENU_REFACTOR_DECOMPOSE: 'menu:refactor:decompose',

  // Formatter menu (issue #153)
  /** Selection-driven Format command. Runs on whatever is selected in
   *  the left sidebar (files + folders), falling back to the active
   *  note when nothing is selected. Replaces the old three-variant
   *  set (Format Current Note / Format Folder / Format All). */
  MENU_FORMAT: 'menu:format',

  /** Insert/Update Bibliography menu trigger (#113). */
  MENU_BIBLIOGRAPHY: 'menu:bibliography',

  /** Generate (or remove, when there are no remaining citations) the
   *  References section for a note. Returns the rendered entries count
   *  and any cited ids the renderer couldn't resolve. (#113) */
  BIBLIOGRAPHY_GENERATE: 'bibliography:generate',
  /** List bundled CSL styles, for the Settings picker. (#113) */
  BIBLIOGRAPHY_LIST_STYLES: 'bibliography:listStyles',
  /** Read the per-project configured CSL style id. (#113) */
  BIBLIOGRAPHY_GET_STYLE: 'bibliography:getStyle',
  /** Persist the per-project CSL style id. (#113) */
  BIBLIOGRAPHY_SET_STYLE: 'bibliography:setStyle',

  /** List user-imported CSL styles + locales for the Settings UI. (#302) */
  CSL_LIST_USER_STYLES: 'csl:listUserStyles',
  CSL_LIST_USER_LOCALES: 'csl:listUserLocales',
  /** Open file picker, validate, copy into .minerva/csl-{styles,locales}/. (#302) */
  CSL_IMPORT_STYLE: 'csl:importStyle',
  CSL_IMPORT_LOCALE: 'csl:importLocale',
  /** Delete a user-imported style/locale by id. (#302) */
  CSL_REMOVE_STYLE: 'csl:removeStyle',
  CSL_REMOVE_LOCALE: 'csl:removeLocale',

  /**
   * Render a batch of inline citations through citeproc using the
   * project's configured CSL style (#110). Input is the cite/quote
   * refs in document order; output is the formatted markers plus an
   * optional bibliography for numeric-class styles.
   */
  CITATION_RENDER_INLINE: 'citation:renderInline',

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
  /** Ingest a DOI / arXiv id / PubMed id (#96). Hits CrossRef / arXiv / PubMed. */
  SOURCES_INGEST_IDENTIFIER: 'sources:ingestIdentifier',
  /** Ingest a local PDF (#94). Main opens a file picker and extracts text via unpdf. */
  SOURCES_INGEST_PDF: 'sources:ingestPdf',
  /** Read raw PDF bytes of a persisted source, used by the OCR worker (#95). */
  SOURCES_READ_PDF: 'sources:readPdf',
  /** Renderer returns OCR'd per-page text; main writes body.md + stamps meta.ttl (#95). */
  SOURCES_FINISH_PDF_OCR: 'sources:finishPdfOcr',
  /** Bulk import from a .bib file (#98). Main opens a picker and parses via @retorquere/bibtex-parser. */
  SOURCES_IMPORT_BIBTEX: 'sources:importBibtex',
  /** Progress events during a BibTeX import — { done, total, currentTitle }. */
  SOURCES_IMPORT_BIBTEX_PROGRESS: 'sources:importBibtexProgress',
  /** Bulk import from a Zotero RDF export (#270). Main picks the .rdf and lifts attached PDFs. */
  SOURCES_IMPORT_ZOTERO_RDF: 'sources:importZoteroRdf',
  /** Progress events during a Zotero RDF import. */
  SOURCES_IMPORT_ZOTERO_RDF_PROGRESS: 'sources:importZoteroRdfProgress',
  /** Create an Excerpt (#224) from a highlighted passage in a source body. */
  SOURCES_CREATE_EXCERPT: 'sources:createExcerpt',
  /** Broadcast from main when an excerpt is added/updated/removed so source tabs refresh. */
  EXCERPTS_CHANGED: 'excerpts:changed',
  /** Menu → "Ingest URL…" — prompts the renderer for a URL and calls SOURCES_INGEST_URL. */
  MENU_INGEST_URL: 'menu:ingestUrl',
  /** Menu → "Ingest identifier…" — prompts the renderer for a DOI/arXiv/PMID. */
  MENU_INGEST_IDENTIFIER: 'menu:ingestIdentifier',
  /** Menu → "Ingest PDF…" — opens a file picker in main and extracts the text layer. */
  MENU_INGEST_PDF: 'menu:ingestPdf',
  /** Menu → "Import BibTeX…" — opens a .bib picker and imports each entry as a Source. */
  MENU_IMPORT_BIBTEX: 'menu:importBibtex',
  /** Menu → "Import Zotero RDF…" — opens a .rdf picker; lifts attached PDFs when present. */
  MENU_IMPORT_ZOTERO_RDF: 'menu:importZoteroRdf',
  /** List every indexed source, for the sidebar Sources panel. */
  SOURCES_LIST_ALL: 'sources:listAll',
  /** Delete a source + cascade-delete its excerpts. */
  SOURCES_DELETE: 'sources:delete',
  /** Broadcast from main when a source is added/updated/removed so panels refresh. */
  SOURCES_CHANGED: 'sources:changed',

  /** Run a SQL query against the project's DuckDB (#232). */
  TABLES_QUERY: 'tables:query',
  /** List every registered CSV table with its columns + row count (#234, for autocomplete). */
  TABLES_LIST: 'tables:list',
  /** Broadcast from main when the set of registered DuckDB tables changes (#235). */
  TABLES_CHANGED: 'tables:changed',

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
  MENU_OPEN_STOCK_QUERY: 'menu:openStockQuery',
  MENU_EDIT_SAVED_QUERIES: 'menu:editSavedQueries',

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
  /** main → renderer: a propose_notes tool call produced a draft for review. Payload is ConversationDraft. */
  CONVERSATION_DRAFT: 'conversation:draft',
  /** renderer → main: user approved a draft; file the bundle as a Proposal AND auto-approve it. */
  CONVERSATION_FILE_DRAFT: 'conversation:fileDraft',
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

  /** External file drag-drop ingestion (#259). Renderer hands over OS file paths. */
  FILES_DROP_IMPORT: 'files:dropImport',

  /** Notebook compute: dispatch a cell to its language's executor (#238). */
  COMPUTE_RUN_CELL: 'compute:runCell',
  /** Wipe and respawn the project's Python kernel. Loses every notebook's
   *  namespace state — palette command "Compute: Restart Python Kernel". */
  COMPUTE_RESTART_PYTHON_KERNEL: 'compute:restartPythonKernel',
  /** Send SIGINT to the active Python kernel so a runaway cell can
   *  be interrupted without losing namespace state — palette command
   *  "Compute: Interrupt Cell" (#372). POSIX-only for v1; Windows
   *  returns an unsupported-platform marker the UI surfaces as a
   *  "use Restart" suggestion. */
  COMPUTE_INTERRUPT_PYTHON: 'compute:interruptPython',
  /** Per-machine Python interpreter override (#374). */
  COMPUTE_GET_PYTHON_SETTINGS: 'compute:getPythonSettings',
  COMPUTE_SET_PYTHON_SETTINGS: 'compute:setPythonSettings',
  /** Probe a candidate interpreter (path or empty for the resolver
   *  default) for "does it run + what version". */
  COMPUTE_PROBE_PYTHON: 'compute:probePython',
  /** Open a native file picker scoped to executable files; returns the
   *  picked path or null on cancel. */
  COMPUTE_BROWSE_PYTHON: 'compute:browsePython',
  /** Per-project Python trust flag (#373). Read returns true once the
   *  user has OK'd cell execution for the current project; write is
   *  fired by the first-run trust dialog when the user clicks Run. */
  COMPUTE_GET_PYTHON_TRUST: 'compute:getPythonTrust',
  COMPUTE_SET_PYTHON_TRUST: 'compute:setPythonTrust',
  /** List every fence language that has a registered executor. Drives the editor's gutter. */
  COMPUTE_LANGUAGES: 'compute:languages',
  /** Save a cell's output as a first-class note with provenance (#244). */
  COMPUTE_SAVE_CELL_OUTPUT: 'compute:saveCellOutput',

  /** Publication: list every registered exporter for the menu + preview dialog (#282). */
  PUBLISH_LIST_EXPORTERS: 'publish:listExporters',
  /** Publication: resolve an ExportPlan so the preview can show includes / excludes. */
  PUBLISH_RESOLVE_PLAN: 'publish:resolvePlan',
  /** Publication: run an exporter end-to-end, writing files under the chosen output dir. */
  PUBLISH_RUN_EXPORT: 'publish:runExport',
  /** Menu → "Export…" — opens the preview dialog for a specific exporter id (payload). */
  MENU_EXPORT: 'menu:export',

  // Renderer → main (for menu-triggered main-process actions)
  EXPORT_CSV: 'export:csv',
  SHELL_REVEAL_FILE: 'shell:revealFile',
  SHELL_OPEN_IN_DEFAULT: 'shell:openInDefault',
  SHELL_OPEN_IN_TERMINAL: 'shell:openInTerminal',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  GRAPH_EXPORT: 'graph:export',

  // Privileged sites (per-machine domains the user has logged in to so
  // Minerva-initiated fetches can carry their session cookies).
  SITES_LIST: 'sites:list',
  SITES_ADD: 'sites:add',
  SITES_REMOVE: 'sites:remove',
  SITES_LOGIN: 'sites:login',
  SITES_LOGOUT: 'sites:logout',
} as const;
