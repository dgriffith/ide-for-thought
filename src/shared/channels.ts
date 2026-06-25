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
  /** Pre-flight count of how many files / link occurrences a merge would touch (#464). */
  NOTEBASE_MERGE_PREVIEW: 'notebase:mergePreview',
  /** Merge source note into target: append body, rewrite incoming links, delete source (#464). */
  NOTEBASE_MERGE: 'notebase:merge',
  NOTEBASE_COPY: 'notebase:copy',
  NOTEBASE_SEARCH_IN_NOTES: 'notebase:searchInNotes',
  NOTEBASE_REPLACE_IN_NOTES: 'notebase:replaceInNotes',

  // Project + window lifecycle (#673)
  NOTEBASE_OPEN_PATH: 'notebase:openPath',
  NOTEBASE_NEW_PROJECT: 'notebase:newProject',
  NOTEBASE_CLOSE: 'notebase:close',
  NOTEBASE_OPEN_IN_NEW_WINDOW: 'notebase:openInNewWindow',
  NOTEBASE_NEW_PROJECT_IN_NEW_WINDOW: 'notebase:newProjectInNewWindow',
  NOTEBASE_OPEN_PATH_IN_NEW_WINDOW: 'notebase:openPathInNewWindow',
  /** Clear the recent-projects list. */
  RECENT_CLEAR: 'recent:clear',
  /** main → renderer: a project finished opening in this window. Payload is
   *  `{ rootPath, name }`. Sent from every open/new path (#673). */
  PROJECT_OPENED: 'project:opened',

  // File watcher events (main → renderer)
  NOTEBASE_FILE_CHANGED: 'notebase:fileChanged',
  NOTEBASE_FILE_CREATED: 'notebase:fileCreated',
  NOTEBASE_FILE_DELETED: 'notebase:fileDeleted',
  /** Emitted by the main process after a note rename completes. Payload is PathTransition[]. */
  NOTEBASE_RENAMED: 'notebase:renamed',
  /** Emitted after link-rewrites touched other notes' content. Payload is string[] (relativePaths). */
  NOTEBASE_REWRITTEN: 'notebase:rewritten',
  /** Per-project new-thoughtbase onboarding dismissal flag. Read on
   *  project open to decide whether to surface the onboarding modal,
   *  written when the user clicks "Don't show again". */
  NOTEBASE_GET_ONBOARDING_DISMISSED: 'notebase:getOnboardingDismissed',
  NOTEBASE_SET_ONBOARDING_DISMISSED: 'notebase:setOnboardingDismissed',
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
  /** Safe-delete pre-flight (#429): given a set of .md paths slated
   *  for deletion, return every inbound edge from outside that set. */
  LINKS_EXTERNAL_INBOUND: 'links:externalInbound',

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
  /** Frontmatter alias → relativePath map for wiki-link resolution (#469). */
  GRAPH_ALIAS_MAP: 'graph:aliasMap',
  /** Same data as GRAPH_ALIAS_MAP but in entries form, preserving the
   *  original casing the user wrote in frontmatter. Powers the
   *  wiki-link autocomplete's alias surfacing (#492). */
  GRAPH_ALIAS_ENTRIES: 'graph:aliasEntries',
  /** Project-wide frontmatter key list. Powers the Properties panel's
   *  Add-Property autocomplete (#488). */
  GRAPH_FRONTMATTER_KEYS: 'graph:frontmatterKeys',

  // Tags
  TAGS_LIST: 'tags:list',
  TAGS_NOTES_BY_TAG: 'tags:notesByTag',
  /** Notes with any tag at-or-under a given prefix (#466). */
  TAGS_NOTES_BY_TAG_PREFIX: 'tags:notesByTagPrefix',
  TAGS_SOURCES_BY_TAG: 'tags:sourcesByTag',
  TAGS_ALL_NAMES: 'tags:allNames',

  // Templates (#475) — per-project markdown templates under
  // `.minerva/templates/`. Listing, reading, and saving go through
  // these channels; substitution is pure and lives in shared/.
  TEMPLATES_LIST: 'templates:list',
  TEMPLATES_GET: 'templates:get',
  TEMPLATES_SAVE_AS: 'templates:saveAs',

  // Menu → renderer events (main sends, renderer listens)
  // Project / file menu actions (#673)
  MENU_OPEN_PROJECT: 'menu:openProject',
  MENU_NEW_PROJECT: 'menu:newProject',
  MENU_CLOSE_PROJECT: 'menu:closeProject',
  MENU_CLEAR_RECENT: 'menu:clearRecent',
  MENU_PRINT: 'menu:print',
  MENU_ABOUT: 'menu:about',
  MENU_SHORTCUTS: 'menu:shortcuts',
  MENU_OPEN_IN_DEFAULT: 'menu:openInDefault',
  MENU_OPEN_IN_TERMINAL: 'menu:openInTerminal',
  MENU_NEW_NOTE: 'menu:newNote',
  MENU_SAVE_AS_TEMPLATE: 'menu:saveAsTemplate',
  MENU_INSERT_TEMPLATE: 'menu:insertTemplate',
  MENU_SAVE: 'menu:save',
  MENU_TOGGLE_SIDEBAR: 'menu:toggleSidebar',
  MENU_TOGGLE_PREVIEW: 'menu:togglePreview',
  MENU_TOGGLE_RIGHT_SIDEBAR: 'menu:toggleRightSidebar',
  MENU_TOGGLE_CONVERSATIONS: 'menu:toggleConversations',
  MENU_NEW_CONVERSATION: 'menu:newConversation',
  MENU_CYCLE_THEME: 'menu:cycleTheme',
  // Editor split — focus & pane commands (#814)
  MENU_SPLIT_RIGHT: 'menu:splitRight',
  MENU_SPLIT_DOWN: 'menu:splitDown',
  MENU_FOCUS_NEXT_GROUP: 'menu:focusNextGroup',
  MENU_FOCUS_PREV_GROUP: 'menu:focusPrevGroup',
  MENU_CLOSE_GROUP: 'menu:closeGroup',
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

  /** Ingest a URL (#93). Fetches, runs Readability, persists under .minerva/sources/<id>/. */
  SOURCES_INGEST_URL: 'sources:ingestUrl',
  /** Ingest a DOI / arXiv id / PubMed id (#96). Hits CrossRef / arXiv / PubMed. */
  SOURCES_INGEST_IDENTIFIER: 'sources:ingestIdentifier',
  /** Ingest a local file as a source. Main opens a file picker; dispatches by
   *  type — PDF (text+OCR), HTML (Readability), text/Markdown (verbatim body). */
  SOURCES_INGEST_FILE: 'sources:ingestFile',
  /** Read raw PDF bytes of a persisted source, used by the OCR worker (#95). */
  SOURCES_READ_PDF: 'sources:readPdf',
  /** Cheap check used by the source detail UI to decide whether to
   *  show the "Open original PDF" button. Returns true iff
   *  `.minerva/sources/<id>/original.pdf` exists. */
  SOURCES_HAS_PDF: 'sources:hasPdf',
  /** Per-project default folder where "New note from excerpt"
   *  lands (#101). Empty string = project root. */
  EXCERPT_GET_NOTE_FOLDER: 'excerpt:getNoteFolder',
  EXCERPT_SET_NOTE_FOLDER: 'excerpt:setNoteFolder',
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
  /** Menu → "Ingest File as Source…" — opens a file picker in main and ingests it. */
  MENU_INGEST_FILE: 'menu:ingestFile',
  /** Menu → "Import BibTeX…" — opens a .bib picker and imports each entry as a Source. */
  MENU_IMPORT_BIBTEX: 'menu:importBibtex',
  /** Menu → "Import Zotero RDF…" — opens a .rdf picker; lifts attached PDFs when present. */
  MENU_IMPORT_ZOTERO_RDF: 'menu:importZoteroRdf',
  /** List every indexed source, for the sidebar Sources panel. */
  SOURCES_LIST_ALL: 'sources:listAll',
  /** Delete a source + cascade-delete its excerpts. */
  SOURCES_DELETE: 'sources:delete',
  /** Merge two sources: fold src's metadata into dest, move excerpts,
   *  rewrite `[[cite::src]]`, delete src folder (#90). */
  SOURCES_MERGE: 'sources:merge',
  /** Set/clear a source's reading-queue status (#116). */
  SOURCES_SET_READ_STATUS: 'sources:setReadStatus',
  /** Rename a source (upsert dc:title) (#765). */
  SOURCES_SET_TITLE: 'sources:setTitle',
  /** Set/clear a source's due-by date (#116). */
  SOURCES_SET_READ_DUE_BY: 'sources:setReadDueBy',
  /** Add a user tag to a source (#766). */
  SOURCES_ADD_TAG: 'sources:addTag',
  /** Remove a tag from a source (#766). */
  SOURCES_REMOVE_TAG: 'sources:removeTag',
  /** Resolve a built-in Reading Queue view (unread / reading /
   *  dueThisWeek / recentlyFinished) against the live graph (#116). */
  SOURCES_QUEUE_MEMBERS: 'sources:queueMembers',
  /** Drop every API-derived `minerva:upstreamTag` from a source's
   *  meta.ttl and re-index (#473). User-authored body tags survive. */
  SOURCES_STRIP_UPSTREAM_TAGS: 'sources:stripUpstreamTags',
  /** Per-machine ingest preferences (#473): "Import upstream subject
   *  tags on source ingest" and friends. */
  INGEST_GET_SETTINGS: 'ingest:getSettings',
  INGEST_SET_SETTINGS: 'ingest:setSettings',
  /** Browser-clipper enable + pairing (#791). */
  CLIPPER_GET_STATE: 'clipper:getState',
  CLIPPER_SET_ENABLED: 'clipper:setEnabled',
  CLIPPER_REGENERATE_SECRET: 'clipper:regenerateSecret',
  /** Smart-route ingest: takes a raw string from a clipboard paste or
   *  the "+" button, detects whether it's a DOI / arXiv id / PMID /
   *  URL, and dispatches to the matching ingest path (#473). */
  SOURCES_INGEST_SMART: 'sources:ingestSmart',
  /** Mine a source's References section via the LLM and return the
   *  parsed candidates for user approval (#106). */
  SOURCES_MINE_REFERENCES: 'sources:mineReferences',
  /** Materialise approved reference candidates as stub Source nodes
   *  + add `minerva:references` edges from the parent (#106). */
  SOURCES_CREATE_REFERENCE_STUBS: 'sources:createReferenceStubs',
  /** Resolve a stub source by searching CrossRef. Returns top-3
   *  candidates with confidence; the renderer surfaces them in a
   *  picker (or auto-applies the top one when confidence is high).
   *  (#107) */
  SOURCES_RESOLVE_STUB: 'sources:resolveStub',
  /** Apply the user-picked DOI to a stub source: rewrite meta.ttl
   *  with full CrossRef metadata + flip stubStatus to "resolved". */
  SOURCES_APPLY_STUB_RESOLUTION: 'sources:applyStubResolution',

  // Collections (#470)
  /** Read `.minerva/collections.json` as a CollectionsFile. */
  COLLECTIONS_LIST: 'collections:list',
  COLLECTIONS_CREATE: 'collections:create',
  COLLECTIONS_RENAME: 'collections:rename',
  COLLECTIONS_DELETE: 'collections:delete',
  COLLECTIONS_ADD_SOURCE: 'collections:addSource',
  COLLECTIONS_REMOVE_SOURCE: 'collections:removeSource',
  /** Broadcast from main when the collections file changes so any open
   *  sidebar refreshes its tree. */
  COLLECTIONS_CHANGED: 'collections:changed',
  /** Smart-collection CRUD (#470 phase 2). */
  COLLECTIONS_CREATE_SMART: 'collections:createSmart',
  COLLECTIONS_RENAME_SMART: 'collections:renameSmart',
  COLLECTIONS_DELETE_SMART: 'collections:deleteSmart',
  COLLECTIONS_UPDATE_SMART_PREDICATE: 'collections:updateSmartPredicate',
  /** Resolve a smart collection's members against the live graph.
   *  Returns the matching SourceMetadata[] sorted by title. */
  COLLECTIONS_SMART_MEMBERS: 'collections:smartMembers',
  /** Broadcast from main when a source is added/updated/removed so panels refresh. */
  SOURCES_CHANGED: 'sources:changed',

  /** Run a SQL query against the project's DuckDB (#232). */
  TABLES_QUERY: 'tables:query',
  /** List every registered CSV table with its columns + row count (#234, for autocomplete). */
  TABLES_LIST: 'tables:list',
  /** Broadcast from main when the set of registered DuckDB tables changes (#235). */
  TABLES_CHANGED: 'tables:changed',
  /** Broadcast from main when a CSV register would clobber an existing
   *  table name and got skipped (#354). Payload: \`CsvTableCollision\`. */
  TABLES_NAME_COLLISION: 'tables:nameCollision',

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

  // Skills (markdown skill files — #622)
  /** List the loaded skill catalog (metadata + load errors). */
  SKILLS_LIST: 'skills:list',
  /** Re-scan stock + user skill files and return the refreshed catalog. */
  SKILLS_RELOAD: 'skills:reload',
  /** Pick a .md file or skill folder and import it into ~/.minerva/skills/. */
  SKILLS_IMPORT: 'skills:import',
  /** Delete a user skill by id. */
  SKILLS_REMOVE: 'skills:remove',
  /** Reveal the user skills folder (~/.minerva/skills/) in the OS file manager. */
  SKILLS_REVEAL: 'skills:reveal',
  /** Persist the per-machine menu config (enabled / menu override / order). */
  SKILLS_MENU_CONFIG_SET: 'skills:menuConfig:set',

  // Proposals
  PROPOSAL_LIST: 'proposal:list',
  PROPOSAL_DETAIL: 'proposal:detail',
  PROPOSAL_APPROVE: 'proposal:approve',
  PROPOSAL_REJECT: 'proposal:reject',
  PROPOSAL_EXPIRE: 'proposal:expire',

  // Conversations
  CONVERSATION_CREATE: 'conversation:create',
  CONVERSATION_APPEND: 'conversation:append',
  CONVERSATION_ARCHIVE: 'conversation:archive',
  CONVERSATION_LOAD: 'conversation:load',
  CONVERSATION_LIST: 'conversation:list',
  CONVERSATION_LIST_ACTIVE: 'conversation:listActive',
  CONVERSATION_SEND: 'conversation:send',
  CONVERSATION_STREAM: 'conversation:stream',
  CONVERSATION_CANCEL: 'conversation:cancel',
  /** main → renderer: a propose_notes tool call produced a draft for review. Payload is ConversationDraft. */
  CONVERSATION_DRAFT: 'conversation:draft',
  /** renderer → main: user approved a draft; file the bundle as a Proposal AND auto-approve it. */
  CONVERSATION_FILE_DRAFT: 'conversation:fileDraft',
  /** main → renderer: a propose_sources tool call produced a source-ingest draft for review. Payload is ConversationSourceDraft. */
  CONVERSATION_SOURCE_DRAFT: 'conversation:sourceDraft',
  /** renderer → main: user approved a source draft; run the ingest pipeline for each URL/identifier and return the per-source outcomes. */
  CONVERSATION_FILE_SOURCE_DRAFT: 'conversation:fileSourceDraft',
  /** main → renderer: a set_properties tool call produced a frontmatter-patch draft for review. Payload is ConversationPropertyDraft. */
  CONVERSATION_PROPERTY_DRAFT: 'conversation:propertyDraft',
  /** renderer → main: user approved a property draft; apply each {path, properties} patch and return the per-update outcomes. */
  CONVERSATION_FILE_PROPERTY_DRAFT: 'conversation:filePropertyDraft',
  /** main → renderer: a propose_source_properties tool call produced a source-meta draft for review (#103). Payload is ConversationSourcePropertyDraft. */
  CONVERSATION_SOURCE_PROPERTY_DRAFT: 'conversation:sourcePropertyDraft',
  /** renderer → main: user approved a source-property draft; upsert dc:abstract / thought:tldr into the source's meta.ttl and reindex. */
  CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT: 'conversation:fileSourcePropertyDraft',
  /** main → renderer: a propose_claims tool call produced a key-claims draft for review (#104). Payload is ConversationClaimsDraft. */
  CONVERSATION_CLAIMS_DRAFT: 'conversation:claimsDraft',
  /** renderer → main: user approved a claims draft; file claim notes + excerpt nodes through the approval engine. */
  CONVERSATION_FILE_CLAIMS_DRAFT: 'conversation:fileClaimsDraft',
  /** main → renderer: a propose_compute tool call produced a code-cell draft for review (#245). Payload is ConversationComputeDraft. */
  CONVERSATION_COMPUTE_DRAFT: 'conversation:computeDraft',
  /** renderer → main: user clicked Run on a compute draft. Executes via the existing compute registry and appends the result to the conversation log. */
  CONVERSATION_RUN_COMPUTE_DRAFT: 'conversation:runComputeDraft',
  /** renderer → main: user clicked Insert into notebook on a compute draft. Appends the cell to a destination note with provenance frontmatter. */
  CONVERSATION_INSERT_COMPUTE_DRAFT: 'conversation:insertComputeDraft',
  CONVERSATION_SET_MODEL: 'conversation:setModel',
  /** Per-conversation reasoning-effort override (#825). */
  CONVERSATION_SET_EFFORT: 'conversation:setEffort',
  /** Client-side compaction (#824): summarize earlier turns into a fresh
   *  conversation, archiving the original. */
  CONVERSATION_COMPACT: 'conversation:compact',
  /** Load tool-window UI state (.minerva/conversations/_ui.json). */
  CONVERSATION_UI_STATE_LOAD: 'conversation:uiStateLoad',
  /** Persist tool-window UI state (visibility, height, last-active tab). */
  CONVERSATION_UI_STATE_SAVE: 'conversation:uiStateSave',
  /** main → renderer: agent invoked the `ask_user` tool. Payload is AskUserRequest. */
  CONVERSATION_ASK_USER: 'conversation:askUser',
  /** renderer → main: user's reply to an ask_user prompt. Payload is { questionId, answer }. */
  CONVERSATION_ASK_USER_REPLY: 'conversation:askUserReply',
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
  APP_GET_INFO: 'app:getInfo',
  APP_GET_SHORTCUTS: 'app:getShortcuts',
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
