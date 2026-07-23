/**
 * Typed IPC contract for the notebase domain (#981).
 *
 * ONE source of truth linking channel ↔ handler ↔ preload ↔ client
 * signatures. Keys are the channel string literals (matching the
 * `Channels.*` values in `./channels`); values are the renderer-facing
 * signature `(...args) => ReturnValue`, where `ReturnValue` is the
 * RESOLVED value (Promises are unwrapped — the wrappers re-wrap).
 *
 * Pure type module: no runtime, no electron import. The typed
 * `handle`/`invoke` wrappers derive their arg + return types from here,
 * so a wrong param/return type fails `tsc` instead of silently
 * corrupting renderer state.
 */
import type {
  NotebaseMeta,
  NoteFile,
  SearchInNotesOptions,
  SearchInNotesFileResult,
  ReplaceInNotesOptions,
  ReplaceInNotesResult,
  HeadingRenameCandidate,
  TagInfo,
  TaggedNote,
  TaggedSource,
  PrivilegedSite,
  BookmarkNode,
  LayoutSession,
  TabSession,
  SavedQuery,
  SearchResult,
  OutgoingLink,
  Backlink,
  CitationGroup,
  SafeDeleteBlocker,
  NeighborhoodOptions,
  NeighborhoodResult,
  NeighborhoodHop,
  RelatedNotesResult,
  SourceDetail,
} from './types';
import type { ClipperState } from './clipper-pairing';
import type { CellResult, CellOutput } from './compute/types';

// `HeadingRenameCandidate` is part of the notebase wire contract (the
// NOTEBASE_HEADING_RENAME_SUGGESTED event payload) but isn't an
// invoke channel, so it isn't a ChannelMap key — reference it here to
// keep the import meaningful for the domain's type surface.
export type { HeadingRenameCandidate };

export interface ChannelMap {
  'notebase:open': () => NotebaseMeta | null;
  'notebase:openPath': (rootPath: string) => NotebaseMeta;
  'notebase:newProject': () => NotebaseMeta | null;
  'notebase:openInNewWindow': () => NotebaseMeta | null;
  'notebase:newProjectInNewWindow': () => NotebaseMeta | null;
  'notebase:openPathInNewWindow': (rootPath: string) => NotebaseMeta;
  'notebase:close': () => null;
  'recent:clear': () => void;
  'notebase:listFiles': () => NoteFile[];
  'notebase:readFile': (relativePath: string) => string;
  'notebase:readBinary': (relativePath: string) => Uint8Array;
  'notebase:writeBinary': (relativePath: string, bytes: Uint8Array) => void;
  'images:cacheExternal': (url: string) => { bytes: Uint8Array; mime: string } | null;
  'youtube:thumbnail': (id: string) => Uint8Array | null;
  'notebase:fileExists': (relativePath: string) => boolean;
  'notebase:writeFile': (relativePath: string, content: string) => void;
  'notebase:createFile': (relativePath: string) => void;
  'notebase:deleteFile': (relativePath: string) => void;
  'notebase:createFolder': (relativePath: string) => void;
  'notebase:deleteFolder': (relativePath: string) => void;
  'notebase:rename': (oldRelPath: string, newRelPath: string) => void;
  'notebase:mergePreview': (sourceRelPath: string, targetRelPath: string) => { linkOccurrences: number; affectedFiles: number };
  'notebase:merge': (sourceRelPath: string, targetRelPath: string, separator?: string) => { targetPath: string; mergeOffset: number; mergeLine: number; rewrittenLinks: number; rewrittenPaths: string[]; deletedSource: string };
  'notebase:copy': (srcRelPath: string, destRelPath: string) => void;
  'notebase:searchInNotes': (opts: SearchInNotesOptions) => SearchInNotesFileResult[];
  'notebase:replaceInNotes': (opts: ReplaceInNotesOptions) => ReplaceInNotesResult;
  'notebase:renameAnchor': (targetRelativePath: string, oldSlug: string, newSlug: string) => { rewrittenPaths: string[] };
  'notebase:renameSource': (oldId: string, newId: string) => { rewrittenPaths: string[] };
  'notebase:renameExcerpt': (oldId: string, newId: string) => { rewrittenPaths: string[] };
  'notebase:getOnboardingDismissed': () => boolean;
  'notebase:setOnboardingDismissed': (dismissed: boolean) => void;

  // Tags
  'tags:list': () => TagInfo[];
  'tags:notesByTag': (tag: string) => TaggedNote[];
  'tags:notesByTagPrefix': (prefix: string) => TaggedNote[];
  'tags:sourcesByTag': (tag: string) => TaggedSource[];
  'tags:allNames': () => string[];

  // Templates
  'templates:list': () => { name: string; filename: string }[];
  'templates:get': (filename: string) => string | null;
  'templates:saveAs': (name: string, content: string) => { name: string; filename: string };

  // Git (stubs)
  'git:status': () => { isRepo: boolean; branch: string | null; files: unknown[] };
  'git:commit': (message: string) => { success: boolean; sha: string };

  // Privileged sites
  'sites:list': () => PrivilegedSite[];
  'sites:add': (domain: string, label?: string) => PrivilegedSite;
  'sites:remove': (id: string) => void;
  'sites:login': (id: string) => void;
  'sites:logout': (id: string) => void;

  // Browser clipper
  'clipper:getState': () => ClipperState;
  'clipper:setEnabled': (enabled: boolean) => ClipperState;
  'clipper:regenerateSecret': () => ClipperState;

  // Export
  'export:csv': (csv: string) => void;

  // Shell
  'shell:revealFile': (relativePath?: string) => void;
  'shell:openInDefault': (relativePath: string) => void;
  'shell:openInTerminal': (relativePath?: string) => void;
  'shell:openExternal': (url: string) => void;

  // Bookmarks
  'bookmarks:load': () => BookmarkNode[];
  'bookmarks:save': (tree: BookmarkNode[]) => void;

  // Tab session
  'tabs:save': (session: LayoutSession) => void;
  'tabs:load': () => LayoutSession | TabSession | null;

  // Saved queries
  'queries:list': () => SavedQuery[];
  'queries:save': (scope: string, name: string, description: string, query: string, language: 'sparql' | 'sql', group?: string | null) => SavedQuery;
  'queries:delete': (filePath: string) => void;
  'queries:rename': (filePath: string, newName: string) => string;
  'queries:move': (filePath: string, newScope: 'project' | 'global') => string;
  'queries:setGroup': (filePath: string, group: string | null) => void;
  'queries:setOrder': (entries: Array<{ filePath: string; order: number | null }>) => void;

  // Search
  'search:query': (query: string) => SearchResult[];

  // Links
  'links:outgoing': (relativePath: string) => OutgoingLink[];
  'links:backlinks': (relativePath: string) => Backlink[];
  'links:bundle': (relativePath: string) => { outgoing: OutgoingLink[]; backlinks: Backlink[] };
  'links:citationsForNote': (relativePath: string, content?: string) => CitationGroup[];
  'links:externalInbound': (paths: string[]) => SafeDeleteBlocker[];
  'links:neighborhood': (relativePath: string, opts?: NeighborhoodOptions) => NeighborhoodResult;
  'links:expandNode': (relativePath: string) => NeighborhoodHop;

  // Embeddings (semantic search)
  'embeddings:related': (relativePath: string, limit?: number) => RelatedNotesResult;
  'embeddings:searchText': (query: string, opts?: { limit?: number; kinds?: readonly ('note' | 'source' | 'excerpt')[]; excludePath?: string }) => RelatedNotesResult;

  // Graph
  'graph:query': (sparql: string) => { results: unknown[]; columns: string[]; error?: string };
  'graph:groundCheck': (claimText: string) => { node: string; label: string; type: string }[];
  'graph:export': () => void;
  'graph:sourceDetail': (sourceId: string) => SourceDetail | null;
  'graph:excerptSource': (excerptId: string) => { sourceId: string } | null;
  'graph:schemaForCompletion': () =>
    | { prefixes: Array<{ prefix: string; iri: string }>; predicates: Array<{ iri: string; prefixed?: string }>; classes: Array<{ iri: string; prefixed?: string }> }
    | null;
  'graph:aliasMap': () => Record<string, string>;
  'graph:aliasEntries': () => Array<{ alias: string; relativePath: string }>;
  'graph:frontmatterKeys': () => string[];

  // Inspections (graph health checks)
  'inspections:list': () => { id: string; type: string; severity: string; nodeUri: string; nodeLabel: string; message: string; suggestedAction?: string }[];
  'inspections:run': () => { id: string; type: string; severity: string; nodeUri: string; nodeLabel: string; message: string; suggestedAction?: string }[];

  // Tables (DuckDB)
  'tables:query': (sql: string) =>
    | { ok: true; columns: string[]; rows: Record<string, unknown>[] }
    | { ok: false; error: string };
  'tables:list': () => Array<{
    name: string;
    relativePath: string;
    columns: string[];
    rowCount: number;
    source: 'csv' | 'note';
    caption?: string;
    tableIndex?: number;
  }>;

  // App / build metadata
  'app:getInfo': () => { name: string; version: string; commit: string; buildDate: string; electron: string; chrome: string; node: string };
  'app:getShortcuts': () => Array<{ menu: string; items: Array<{ label: string; keys: string }> }>;

  // External-file drag-drop import
  'files:dropImport': (targetFolder: string, localPaths: string[]) => {
    copied: Array<{ localPath: string; relativePath: string }>;
    ingestedPdfs: Array<{ localPath: string; sourceId: string; duplicate: boolean; title: string }>;
    rejected: Array<{ localPath: string; reason: string }>;
  };

  // Publication (export + git publish)
  'publish:listExporters': () => Array<{
    id: string;
    label: string;
    acceptedKinds: Array<'single-note' | 'folder' | 'project' | 'tree' | 'source'>;
    group: { id: string; label: string; category: 'document' | 'publication' | 'citation'; order: number };
    variantLabel?: string | undefined;
    variantOrder: number;
  }>;
  'publish:resolvePlan': (
    input: { kind: 'single-note' | 'folder' | 'project' | 'tree' | 'source'; relativePath?: string; maxDepth?: number },
    opts?: {
      exporterId?: string;
      linkPolicy?: 'drop' | 'inline-title' | 'follow-to-file';
      citationStyle?: string;
      citationLocale?: string;
      forceInclude?: string[];
      forceExclude?: string[];
    },
  ) => {
    exporterId: string;
    exporterLabel: string;
    inputs: Array<{ relativePath: string; kind: 'note' | 'source' | 'excerpt'; title: string; overridden: boolean }>;
    excluded: Array<{ relativePath: string; reason: string }>;
    citations: {
      styleId: string;
      localeId: string;
      availableStyles: Array<{ id: string; label: string }>;
      availableLocales: Array<{ id: string; label: string }>;
      bySource: Array<{ sourceId: string; title: string; refCount: number }>;
      missing: Array<{ id: string; kind: 'cite' | 'quote'; refCount: number }>;
    };
  };
  'publish:runExport': (args: {
    exporterId: string;
    input: { kind: 'single-note' | 'folder' | 'project' | 'tree' | 'source'; relativePath?: string; maxDepth?: number };
    outputDir?: string;
    linkPolicy?: 'drop' | 'inline-title' | 'follow-to-file';
    citationStyle?: string;
    citationLocale?: string;
    forceInclude?: string[];
    forceExclude?: string[];
  }) => { filesWritten: number; summary: string; outputDir: string; writtenPaths: string[] } | null;
  'publish:listTargets': () => PublishTarget[];
  'publish:upsertTarget': (target: PublishTarget) => PublishTarget[];
  'publish:removeTarget': (id: string) => PublishTarget[];
  'publish:toGit': (targetId: string, opts?: { dryRun?: boolean }) =>
    | { ok: true; result: {
        targetId: string;
        dryRun: boolean;
        branch: string;
        branchCreated: boolean;
        changes: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>;
        committed: boolean;
        pushed: boolean;
        sha?: string;
        commitMessage?: string;
      } }
    | { ok: false; error: string };

  // Compute (notebook cells)
  'compute:runCell': (language: string, code: string, notePath?: string) => CellResult;
  'compute:languages': () => string[];
  'compute:restartPythonKernel': () => void;
  'compute:interruptPython': () =>
    | { ok: true }
    | { ok: false; reason: 'no-kernel' | 'unsupported-platform' | 'signal-failed' };
  'compute:getPythonSettings': () => { pythonPath: string };
  'compute:setPythonSettings': (settings: { pythonPath: string }) => void;
  'compute:probePython': (candidate?: string) => { ok: boolean; path: string; version?: string; error?: string };
  'compute:browsePython': () => string | null;
  'compute:getPythonTrust': () => boolean;
  'compute:setPythonTrust': (trusted: boolean) => void;
  'compute:saveCellOutput': (input: {
    sourcePath: string;
    cellLanguage: string;
    cellCode: string;
    output: CellOutput;
    destPath?: string;
    title?: string;
    pin?: boolean;
    forceOverwrite?: boolean;
  }) =>
    | { status: 'written'; derivedPath: string; cellId: string; injectedId: boolean; pinned: boolean }
    | { status: 'needs-confirm'; derivedPath: string; cellId: string; existingContent: string; pendingContent: string };
}

/** A configured "Publish → git remote" destination (#254). Mirror of the
 *  main-side `PublishTarget` (project-config) + renderer `PublishTarget`. */
export interface PublishTarget {
  id: string;
  label: string;
  exporter: string;
  gitRemote: string;
  gitBranch: string;
  subdir?: string;
  commitMessageTemplate?: string;
}
