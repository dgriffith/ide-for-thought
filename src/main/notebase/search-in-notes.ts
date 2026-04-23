/**
 * Grep-style project-wide search + replace for the notebase (#306/#307).
 *
 * Walks every indexable file under the project root (same ignore rules
 * as the sidebar — `.git`, `node_modules`, `.minerva`, `.obsidian`,
 * dotfiles), scans each line for the pattern, returns one match entry
 * per hit. Replace reuses the same walk so selected-match offsets stay
 * consistent with what the UI saw at preview time.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { isIndexable } from './indexable-files';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.minerva', '.obsidian']);

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
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
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
 */
export async function searchInNotes(
  rootPath: string,
  opts: SearchOptions,
): Promise<SearchFileResult[]> {
  const re = buildRegex(opts);
  if (!re) return [];
  const out: SearchFileResult[] = [];
  for await (const rel of walk(rootPath)) {
    let content: string;
    try {
      content = await fs.readFile(path.join(rootPath, rel), 'utf-8');
    } catch {
      continue;
    }
    const matches = matchesForContent(content, re);
    if (matches.length > 0) out.push({ relativePath: rel, matches });
  }
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

function matchesForContent(content: string, re: RegExp): SearchMatch[] {
  const lines = content.split('\n');
  const matches: SearchMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) !== null) {
      matches.push({
        line: i + 1,
        startCol: m.index,
        endCol: m.index + m[0].length,
        lineText,
      });
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
    const originalLine = lines[i];
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
