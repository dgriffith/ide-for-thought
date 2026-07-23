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
} from './types';
import type { ClipperState } from './clipper-pairing';

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
}
