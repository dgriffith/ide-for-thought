import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import * as search from '../search/index';
import { formatContent, type FormatSettings } from '../../shared/formatter/engine';
import type { FormatFileResult } from '../../shared/formatter/types';
import { slugify } from '../../shared/slug';
import { renameAnchor } from '../notebase/rename-anchor';
// Side-effect import: populates the rule registry on the main-process side.
// The renderer has its own import in SettingsDialog for the UI listing.
import '../../shared/formatter/rules/index';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.minerva', '.obsidian']);

export interface FormatRunSummary {
  changedPaths: string[];
  cascadedPaths: string[];
  totalScanned: number;
}

/**
 * Format a single note's content string. When `relativePath` is supplied, the
 * filename is injected into the `file-name-heading` rule's config so that rule
 * has something to sync against. No filesystem writes; no link cascade.
 */
export function formatNoteContent(
  content: string,
  settings: FormatSettings,
  relativePath?: string,
): string {
  const settingsWithCtx = relativePath
    ? injectFileContext(settings, relativePath)
    : settings;
  return formatContent(content, settingsWithCtx);
}

/** Format a single `.md` file on disk + route the write through the standard broadcast pipeline. */
export async function formatFile(
  rootPath: string,
  relativePath: string,
  settings: FormatSettings,
): Promise<FormatFileResult> {
  const before = await notebaseFs.readFile(rootPath, relativePath);
  const settingsWithCtx = injectFileContext(settings, relativePath);
  const after = formatContent(before, settingsWithCtx);
  if (after === before) {
    return { relativePath, changed: false, before, after, cascadedPaths: [] };
  }
  const cascadedPaths = await cascadeHeadingRenames(rootPath, relativePath, before, after);
  await writeThrough(rootPath, relativePath, after);
  return { relativePath, changed: true, before, after, cascadedPaths };
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
  const cascadedPaths = new Set<string>();
  for (const rel of paths) {
    try {
      const result = await formatFile(rootPath, rel, settings);
      if (result.changed) changedPaths.push(rel);
      for (const p of result.cascadedPaths) cascadedPaths.add(p);
    } catch { /* unreadable note — skip */ }
  }
  // Drop any cascaded paths that were themselves formatted — they're already
  // in changedPaths and the broadcast layer shouldn't list them twice.
  for (const p of changedPaths) cascadedPaths.delete(p);
  return {
    changedPaths,
    cascadedPaths: [...cascadedPaths],
    totalScanned: paths.length,
  };
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
  await graph.indexNote(projectContext(rootPath), relativePath, content);
  search.indexNote(relativePath, content);
  // Caller is responsible for the batched persist + NOTEBASE_REWRITTEN
  // broadcast — doing it per-file in a folder run would thrash the
  // editor's open-tab refresh path.
}

/**
 * When a heading's text rewrite changes its slug, the in-file anchor changes
 * too, and any `[[file#old-slug]]` link in the thoughtbase points at a dead
 * anchor unless we chase it. Diff the ordered list of heading slugs before
 * vs after; for each mismatched pair, call `renameAnchor` to rewrite incoming
 * links. Returns the set of other notes that were rewritten so the caller
 * can broadcast their paths.
 *
 * If the heading count changed (rule removed or added a heading) we can't
 * safely attribute renames by position, so we bail on the cascade.
 */
async function cascadeHeadingRenames(
  rootPath: string,
  relativePath: string,
  before: string,
  after: string,
): Promise<string[]> {
  const oldH = extractHeadingSlugsInOrder(before);
  const newH = extractHeadingSlugsInOrder(after);
  if (oldH.length !== newH.length || oldH.length === 0) return [];
  const rewritten = new Set<string>();
  for (let i = 0; i < oldH.length; i++) {
    const oldSlug = oldH[i];
    const newSlug = newH[i];
    if (oldSlug === newSlug || newSlug.length === 0) continue;
    try {
      const result = await renameAnchor(rootPath, relativePath, oldSlug, newSlug);
      for (const p of result.rewrittenPaths) rewritten.add(p);
    } catch (err) {
      console.error(
        `[formatter] heading-rename cascade failed (${relativePath} ${oldSlug} → ${newSlug}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return [...rewritten];
}

function extractHeadingSlugsInOrder(content: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (m) out.push(slugify(m[2].trim()));
  }
  return out;
}

function injectFileContext(settings: FormatSettings, relativePath: string): FormatSettings {
  const filename = path.basename(relativePath, path.extname(relativePath));
  const existingConfig =
    (settings.configs?.['file-name-heading'] as Record<string, unknown> | undefined) ?? {};
  return {
    ...settings,
    configs: {
      ...settings.configs,
      'file-name-heading': { ...existingConfig, filename },
    },
  };
}
