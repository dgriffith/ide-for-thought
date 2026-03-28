export const Channels = {
  // Notebase
  NOTEBASE_OPEN: 'notebase:open',
  NOTEBASE_LIST_FILES: 'notebase:listFiles',
  NOTEBASE_READ_FILE: 'notebase:readFile',
  NOTEBASE_WRITE_FILE: 'notebase:writeFile',
  NOTEBASE_CREATE_FILE: 'notebase:createFile',
  NOTEBASE_DELETE_FILE: 'notebase:deleteFile',

  // File watcher events (main → renderer)
  NOTEBASE_FILE_CHANGED: 'notebase:fileChanged',
  NOTEBASE_FILE_CREATED: 'notebase:fileCreated',
  NOTEBASE_FILE_DELETED: 'notebase:fileDeleted',

  // Git (stubs)
  GIT_STATUS: 'git:status',
  GIT_COMMIT: 'git:commit',

  // Graph
  GRAPH_QUERY: 'graph:query',
} as const;
