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

  // File watcher events (main → renderer)
  NOTEBASE_FILE_CHANGED: 'notebase:fileChanged',
  NOTEBASE_FILE_CREATED: 'notebase:fileCreated',
  NOTEBASE_FILE_DELETED: 'notebase:fileDeleted',

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

  // Tags
  TAGS_LIST: 'tags:list',
  TAGS_NOTES_BY_TAG: 'tags:notesByTag',
  TAGS_ALL_NAMES: 'tags:allNames',

  // Menu → renderer events (main sends, renderer listens)
  MENU_NEW_NOTE: 'menu:newNote',
  MENU_SAVE: 'menu:save',
  MENU_TOGGLE_SIDEBAR: 'menu:toggleSidebar',
  MENU_TOGGLE_PREVIEW: 'menu:togglePreview',
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

  // Graph
  MENU_NEW_QUERY: 'menu:newQuery',
  MENU_SAVE_QUERY: 'menu:saveQuery',
  MENU_OPEN_STOCK_QUERY: 'menu:openStockQuery',

  // Renderer → main (for menu-triggered main-process actions)
  EXPORT_CSV: 'export:csv',
  SHELL_REVEAL_FILE: 'shell:revealFile',
  GRAPH_REBUILD: 'graph:rebuild',
  GRAPH_EXPORT: 'graph:export',
} as const;
