/**
 * Runtime payload validators for the typed IPC boundary (#983).
 *
 * The `ChannelMap` (`./ipc-contract`) pins channel signatures at *compile* time,
 * but `ipcRenderer.invoke` returns `unknown` — a main-process shape bug (or a
 * handler returning the wrong thing) would flow into the renderer untyped and
 * silently corrupt state. These guards re-check each channel's return shape at
 * *runtime* in the `invoke()` wrapper.
 *
 * The map is compile-time-linked to the ChannelMap: each guard's `v is …` must
 * match that channel's return type, so a contract change forces the guard to
 * follow. Channels returning `void` have no guard (nothing to check). Array
 * checks are intentionally SHALLOW — a main-side shape bug is uniform across
 * elements, so checking the first catches it without an O(n) walk on every call.
 *
 * SCOPE DECISION (#1635): coverage is *targeted*, not exhaustive. The ChannelMap
 * already pins every channel's shape at compile time on both the handler and
 * preload sides, so a runtime guard is only worth its cost on payloads where a
 * silent main-side shape bug would corrupt durable/renderer state hard to trace
 * back. Add a guard when a channel (a) returns a structured object/array the
 * renderer trusts into state, AND (b) rides a path where a wrong shape wouldn't
 * fail loudly on its own. Skip `void`, primitives already covered by TS at the
 * boundary, and low-blast-radius reads. Started notebase-only (#983); now also
 * covers the trust path (proposals) and the SPARQL result surface (graph:query),
 * the two highest-value structured returns beyond notebase.
 */
import type { ChannelMap } from './ipc-contract';
import type {
  NotebaseMeta,
  NoteFile,
  SearchInNotesFileResult,
  ReplaceInNotesResult,
} from './types';
import type { Proposal } from './proposals';

type ResultOf<K extends keyof ChannelMap> = Awaited<ReturnType<ChannelMap[K]>>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

/** Shallow array guard: empty, or the first element matches `guard`. */
function shallowArrayOf<T>(guard: (x: unknown) => x is T): (v: unknown) => v is T[] {
  return (v): v is T[] => Array.isArray(v) && (v.length === 0 || guard(v[0]));
}

function isNotebaseMeta(v: unknown): v is NotebaseMeta {
  return isObj(v) && isString(v.rootPath) && isString(v.name);
}
const isMetaOrNull = (v: unknown): v is NotebaseMeta | null => v === null || isNotebaseMeta(v);

function isNoteFile(v: unknown): v is NoteFile {
  return isObj(v) && isString(v.name) && isString(v.relativePath) && isBool(v.isDirectory);
}
function isRewrittenPaths(v: unknown): v is { rewrittenPaths: string[] } {
  return isObj(v) && isStringArray(v.rewrittenPaths);
}
function isSearchFileResult(v: unknown): v is SearchInNotesFileResult {
  return isObj(v) && isString(v.relativePath) && Array.isArray(v.matches);
}
function isReplaceResult(v: unknown): v is ReplaceInNotesResult {
  return isObj(v) && isStringArray(v.changedPaths) && isNumber(v.replacedCount);
}
// Trust path (#1635): a Proposal the renderer files into the review UI. Shallow
// — uri + status discriminate a corrupt/empty payload from a real proposal.
function isProposal(v: unknown): v is Proposal {
  return isObj(v) && isString(v.uri) && isString(v.status);
}
const isProposalOrNull = (v: unknown): v is Proposal | null => v === null || isProposal(v);
// SPARQL result surface (#1635): the query panel renders `results`/`columns`;
// `error` is an optional in-band field, so only the two required arrays are
// checked.
function isQueryResult(v: unknown): v is { results: unknown[]; columns: string[]; error?: string } {
  return isObj(v) && Array.isArray(v.results) && isStringArray(v.columns);
}

export const CHANNEL_VALIDATORS: {
  [K in keyof ChannelMap]?: (v: unknown) => v is ResultOf<K>;
} = {
  'notebase:open': isMetaOrNull,
  'notebase:openPath': isNotebaseMeta,
  'notebase:newProject': isMetaOrNull,
  'notebase:openInNewWindow': isMetaOrNull,
  'notebase:newProjectInNewWindow': isMetaOrNull,
  'notebase:openPathInNewWindow': isNotebaseMeta,
  'notebase:close': (v): v is null => v === null,
  'notebase:listFiles': shallowArrayOf(isNoteFile),
  'notebase:readFile': isString,
  'notebase:readBinary': (v): v is Uint8Array => v instanceof Uint8Array,
  'notebase:fileExists': isBool,
  'notebase:mergePreview': (v): v is ResultOf<'notebase:mergePreview'> =>
    isObj(v) && isNumber(v.linkOccurrences) && isNumber(v.affectedFiles),
  'notebase:merge': (v): v is ResultOf<'notebase:merge'> =>
    isObj(v) &&
    isString(v.targetPath) &&
    isNumber(v.mergeOffset) &&
    isNumber(v.mergeLine) &&
    isNumber(v.rewrittenLinks) &&
    isStringArray(v.rewrittenPaths) &&
    isString(v.deletedSource),
  'notebase:searchInNotes': shallowArrayOf(isSearchFileResult),
  'notebase:replaceInNotes': isReplaceResult,
  'notebase:renameAnchor': isRewrittenPaths,
  'notebase:renameSource': isRewrittenPaths,
  'notebase:renameExcerpt': isRewrittenPaths,
  'notebase:getOnboardingDismissed': isBool,

  // Trust path (#1635): proposals the renderer files into the review UI.
  'proposal:list': shallowArrayOf(isProposal),
  'proposal:detail': isProposalOrNull,

  // Graph SPARQL result surface (#1635).
  'graph:query': isQueryResult,

  // Channels returning `void` (recent:clear, write*, create*, delete*, rename,
  // copy, setOnboardingDismissed) have nothing to validate.
};
