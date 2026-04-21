import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import * as search from '../search/index';
import { formatContent, type FormatSettings } from '../../shared/formatter/engine';
import type { FormatFileResult } from '../../shared/formatter/types';
// Side-effect import: populates the rule registry on the main-process side.
// The renderer has its own import in SettingsDialog for the UI listing.
import '../../shared/formatter/rules/index';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.minerva', '.obsidian']);

export interface FormatRunSummary {
  changedPaths: string[];
  totalScanned: number;
}

/**
 * Format a single note's content string. Pure — caller decides whether to
 * write the result back. Used by the "format current note" palette command,
 * which wants to diff against the editor buffer without touching disk.
 */
export function formatNoteContent(content: string, settings: FormatSettings): string {
  return formatContent(content, settings);
}

/** Format a single `.md` file on disk + route the write through the standard broadcast pipeline. */
export async function formatFile(
  rootPath: string,
  relativePath: string,
  settings: FormatSettings,
): Promise<FormatFileResult> {
  const before = await notebaseFs.readFile(rootPath, relativePath);
  const after = formatContent(before, settings);
  if (after === before) {
    return { relativePath, changed: false, before, after };
  }
  await writeThrough(rootPath, relativePath, after);
  return { relativePath, changed: true, before, after };
}

/**
 * Format every `.md` under `relDir` (inclusive, recursive). When `relDir`
 * is empty, walks the whole thoughtbase.
 */
export async function formatFolder(
  rootPath: string,
  relDir: string,
  settings: FormatSettings,
): Promise<FormatRunSummary> {
  const paths: string[] = [];
  await walk(rootPath, relDir, paths);
  return runBatch(rootPath, paths, settings);
}

async function runBatch(
  rootPath: string,
  paths: string[],
  settings: FormatSettings,
): Promise<FormatRunSummary> {
  const changedPaths: string[] = [];
  for (const rel of paths) {
    try {
      const result = await formatFile(rootPath, rel, settings);
      if (result.changed) changedPaths.push(rel);
    } catch { /* unreadable note — skip */ }
  }
  return { changedPaths, totalScanned: paths.length };
}

async function walk(rootPath: string, relDir: string, out: string[]): Promise<void> {
  const absDir = path.join(rootPath, relDir);
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(rootPath, rel, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
}

async function writeThrough(
  rootPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await notebaseFs.writeFile(rootPath, relativePath, content);
  await graph.indexNote(relativePath, content);
  search.indexNote(relativePath, content);
  // Caller is responsible for the batched persist + NOTEBASE_REWRITTEN
  // broadcast — doing it per-file in a folder run would thrash the
  // editor's open-tab refresh path.
}
