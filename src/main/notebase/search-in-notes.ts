/**
 * Grep-style project-wide search + replace for the notebase (#306/#307).
 *
 * Walks every indexable file under the project root (same ignore rules
 * as the sidebar — `.git`, `node_modules`, `.minerva`, `.obsidian`,
 * dotfiles), scans each line for the pattern, returns one match entry
 * per hit. Replace reuses the same walk so selected-match offsets stay
 * consistent with what the UI saw at preview time.
 *
 * ── Why this is not backed by the MiniSearch index (#2220) ──────────────────
 *
 * The obvious-looking fix for the per-keystroke cost — "reuse the index
 * `SEARCH_QUERY` already has" — does not work, and it is worth writing down so
 * it isn't proposed again. MiniSearch holds a *token* index over `.md` files
 * only, and stores no bodies. Three separate things break:
 *
 *   - It can't match a mid-token substring. Measured against the real engine
 *     config: indexing "the epsilon constant", `search("epsilon")` hits and
 *     `search("psilo")` / `search("silon")` return nothing. Find-in-Notes is a
 *     substring/regex tool — every partially-typed query is a mid-token
 *     substring, which is to say: every keystroke but the last.
 *   - It can't express a regex, a case-sensitive match, or a pattern that is
 *     mostly punctuation. `search("- [ ]")` returns nothing; `search("EPSILON")`
 *     matches a lowercase note.
 *   - It covers `.md` alone (`search/index.ts`'s walk), while this covers every
 *     `NOTE_EXTENSIONS` file — `.ttl`, `.csv`, `.py` included.
 *
 * And because it stores no bodies, even a successful hit still costs a read to
 * get line/column offsets. So it could only ever be a candidate *pre-filter*,
 * and one that silently drops real matches — a wrong answer, not a slow one.
 * What actually made the per-keystroke cost go away is three cheaper things:
 * an mtime-validated body cache (`note-content-cache.ts`), an optional match
 * cap that stops the scan early, and an abort signal so a superseded query
 * stops doing work.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { isIndexable } from '../../shared/indexable-files';
import { isIgnoredEntry } from '../../shared/ignored-dirs';
import { readNoteCached } from './note-content-cache';

export interface SearchMatch {
  /** 1-based line number (CodeMirror's convention). */
  line: number;
  /** 0-based column offsets into the matched line. */
  startCol: number;
  endCol: number;
  /** The full matched line (no trimming). UI highlights [startCol, endCol). */
  lineText: string;
}

export interface SearchFileResult {
  relativePath: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  pattern: string;
  caseSensitive: boolean;
  regex: boolean;
  /**
   * Stop scanning once this many matches have been collected (#2220). Omitted
   * means "no cap", which is what the two non-interactive callers
   * (`llm/tools/grep-notes.ts`, `cli/engine.ts`) want: they cap their own
   * OUTPUT at 50-200 lines but report the true total, and a scan cap would
   * turn that number into a guess. The interactive dialog passes a cap,
   * because a one-character query is an unbounded query — on a 2,000-note
   * corpus `"e"` matched 1,022,200 times and serialized to a 150 MB IPC
   * payload, for one keystroke.
   */
  maxMatches?: number;
}

export interface SearchScanResult {
  files: SearchFileResult[];
  /** Matches actually collected across `files`. Exact when `truncated` is
   *  false; equal to `maxMatches` when it is true. */
  totalMatches: number;
  /** True when the scan stopped at `maxMatches` — more matches exist on disk,
   *  and the caller is holding a prefix of them in path order. */
  truncated: boolean;
}

/**
 * Thrown by {@link searchInNotes} when its `AbortSignal` fires, i.e. a newer
 * query for the same window has superseded this one (#2220). Deliberately not
 * a value: a half-finished scan is not a result, and the #1631 convention says
 * a call that cannot complete throws. The IPC registrar converts it into the
 * one expected, non-exceptional outcome the UI branches on
 * (`{ ok: false, reason: 'superseded' }`); nothing else should catch it.
 */
export class SearchSupersededError extends Error {
  constructor() {
    super('Search superseded by a newer query');
    this.name = 'SearchSupersededError';
  }
}

/** Narrow an unknown rejection to {@link SearchSupersededError}. Uses the
 *  `name` rather than `instanceof` so it survives the class being reached
 *  through two module instances (vitest module mocking, the CLI bundle). */
export function isSearchSuperseded(err: unknown): boolean {
  return err instanceof Error && err.name === 'SearchSupersededError';
}

export interface ReplaceSelection {
  relativePath: string;
  line: number;
  startCol: number;
  endCol: number;
}

/**
 * Build a global regex from the search options. Plain (non-regex) patterns
 * get their special characters escaped so users don't have to think about
 * regex syntax in substring mode.
 */
function buildRegex(opts: SearchOptions): RegExp | null {
  if (!opts.pattern) return null;
  const flags = opts.caseSensitive ? 'g' : 'gi';
  try {
    const body = opts.regex ? opts.pattern : escapeForRegex(opts.pattern);
    return new RegExp(body, flags);
  } catch {
    // User-typed regex that doesn't compile; treat as "no matches"
    // rather than throwing — the UI handles the empty result.
    return null;
  }
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function* walk(rootPath: string, currentRel = ''): AsyncGenerator<string> {
  const dirAbs = path.join(rootPath, currentRel);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  // Sorted so traversal order is deterministic (#2220). `readdir` order is
  // filesystem-defined, which was invisible while every scan returned every
  // match and sorted at the end — but a capped scan keeps a *prefix*, and a
  // prefix of an arbitrary order is an arbitrary set. With this, re-running the
  // same capped query returns the same matches instead of a different sample,
  // and the cyclic-scan admission policy in `note-content-cache.ts` keeps a
  // stable resident set rather than a rotating one.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (isIgnoredEntry(entry.name)) continue;
    const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* walk(rootPath, rel);
    } else if (entry.isFile() && isIndexable(rel)) {
      yield rel;
    }
  }
}

/**
 * Find every occurrence of the pattern across every indexable file.
 * Matches on a single line only — we don't support multi-line regex
 * spans, so every match has a single `line` number.
 *
 * `signal`, when supplied, aborts the scan between files: the promise rejects
 * with {@link SearchSupersededError} and no partial result escapes. Checking
 * per file rather than per line is deliberate — one file's scan is sub-
 * millisecond, and a per-line check would cost more than it saves.
 */
export async function searchInNotes(
  rootPath: string,
  opts: SearchOptions,
  signal?: AbortSignal,
): Promise<SearchScanResult> {
  const re = buildRegex(opts);
  if (!re) return { files: [], totalMatches: 0, truncated: false };
  const cap = opts.maxMatches != null && opts.maxMatches > 0 ? opts.maxMatches : Infinity;
  // Collect one match PAST the cap so `truncated` is a fact rather than a
  // guess. Stopping at exactly `cap` leaves the boundary case ambiguous — a
  // corpus with precisely `cap` matches would be reported as "there are more",
  // and the UI would tell the user to narrow a search that is already
  // complete. The overflow match is discarded below; it costs one extra
  // match object, never an extra file read.
  const limit = cap === Infinity ? Infinity : cap + 1;
  const out: SearchFileResult[] = [];
  let collected = 0;
  for await (const rel of walk(rootPath)) {
    if (signal?.aborted) throw new SearchSupersededError();
    // The body comes from the mtime-validated cache, so a repeat scan over an
    // unchanged corpus costs a `stat` per file instead of a `readFile`. The
    // *walk* above is never cached, so a note created since the last keystroke
    // is found on this one (see `note-content-cache.ts`).
    const content = await readNoteCached(rootPath, path.join(rootPath, rel));
    if (content === null) continue;
    const matches = matchesForContent(content, re, limit - collected);
    if (matches.length > 0) {
      out.push({ relativePath: rel, matches });
      collected += matches.length;
    }
    if (collected >= limit) break;
  }

  const truncated = collected > cap;
  if (truncated) {
    // Drop the probe match. `break` fires the instant the limit is reached, so
    // it is the last match of the last file pushed.
    const last = out[out.length - 1]!;
    last.matches.pop();
    if (last.matches.length === 0) out.pop();
    collected--;
  }

  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files: out, totalMatches: collected, truncated };
}

/**
 * Collect at most `remaining` matches from one file's text.
 *
 * The budget is enforced HERE, not by the caller trimming afterwards, so a
 * single pathological file (a minified blob, a `.csv` of a million rows) can't
 * build a million-element array before anyone gets to cap it — which is what
 * made a one-character query cost 150 MB of IPC payload (#2220). Trimming after
 * the fact returns the same list and is not the same function: the difference
 * is the peak, which no assertion about the RESULT can see. That is why this is
 * exported and unit-tested directly rather than only through `searchInNotes`.
 */
export function matchesForContent(content: string, re: RegExp, remaining: number): SearchMatch[] {
  if (remaining <= 0) return [];
  const lines = content.split('\n');
  const matches: SearchMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) !== null) {
      matches.push({
        line: i + 1,
        startCol: m.index,
        endCol: m.index + m[0].length,
        lineText,
      });
      if (matches.length >= remaining) return matches;
      // Zero-width matches (e.g. regex `^`) would loop forever — nudge.
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return matches;
}

export interface ReplaceResult {
  changedPaths: string[];
  /** Total count of match-edits applied across all files. */
  replacedCount: number;
}

/**
 * Apply replacements for the given selections. Groups by file, re-reads
 * each from disk (so we see current on-disk content, not a cached
 * snapshot from search time), re-runs the pattern, and applies the
 * replacement for every match whose (line, startCol, endCol) is in the
 * selection set for that file. Unselected matches are left alone.
 *
 * Writes happen one file at a time; partial failures leave the rest of
 * the files untouched. Returns the list of paths actually rewritten so
 * callers can broadcast NOTEBASE_REWRITTEN.
 */
export async function replaceInNotes(
  rootPath: string,
  opts: SearchOptions & { replacement: string; selections: ReplaceSelection[] },
): Promise<ReplaceResult> {
  const re = buildRegex(opts);
  if (!re || opts.selections.length === 0) {
    return { changedPaths: [], replacedCount: 0 };
  }

  // Group selections by file, then by line, for cheap lookup during rewrite.
  const byFile = new Map<string, Map<number, Set<string>>>();
  for (const s of opts.selections) {
    let perFile = byFile.get(s.relativePath);
    if (!perFile) { perFile = new Map(); byFile.set(s.relativePath, perFile); }
    let perLine = perFile.get(s.line);
    if (!perLine) { perLine = new Set(); perFile.set(s.line, perLine); }
    // Key = "startCol:endCol" so multiple matches on the same line stay
    // individually addressable.
    perLine.add(`${s.startCol}:${s.endCol}`);
  }

  const changedPaths: string[] = [];
  let replacedCount = 0;

  for (const [rel, perFile] of byFile) {
    const abs = path.join(rootPath, rel);
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf-8');
    } catch {
      continue;
    }
    const rewritten = rewriteFileContent(content, re, opts.replacement, perFile);
    if (rewritten.changed) {
      try {
        await fs.writeFile(abs, rewritten.text, 'utf-8');
        changedPaths.push(rel);
        replacedCount += rewritten.replacedCount;
      } catch {
        /* skip files we can't write; caller can surface via count delta */
      }
    }
  }

  return { changedPaths, replacedCount };
}

function rewriteFileContent(
  content: string,
  re: RegExp,
  replacement: string,
  perLineSelections: Map<number, Set<string>>,
): { text: string; changed: boolean; replacedCount: number } {
  const lines = content.split('\n');
  let changed = false;
  let replacedCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const sel = perLineSelections.get(lineNumber);
    if (!sel) continue;
    const originalLine = lines[i]!;
    // Scan the line in order; when a match's span is in our selection
    // set, substitute the replacement and adjust for length change so
    // later matches on the same line still land at their original cols.
    re.lastIndex = 0;
    let out = '';
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(originalLine)) !== null) {
      const key = `${m.index}:${m.index + m[0].length}`;
      if (sel.has(key)) {
        out += originalLine.slice(cursor, m.index) + replacement;
        cursor = m.index + m[0].length;
        replacedCount++;
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (cursor > 0) {
      out += originalLine.slice(cursor);
      lines[i] = out;
      changed = true;
    }
  }
  return { text: lines.join('\n'), changed, replacedCount };
}
