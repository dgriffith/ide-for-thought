import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import * as notebaseFs from '../notebase/fs';
import { isIndexable } from '../notebase/indexable-files';
import * as graph from '../graph/index';
import * as search from '../search/index';
import * as vectors from '../embeddings/vector-store';
import { projectContext } from '../project-context-types';
import { getRootPath, markPathHandled, windowsForProject } from '../window-manager';
import type { WritePipelineHooks } from '../notebase/write-pipeline';

export function winFromEvent(e: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(e.sender)!;
}

export function rootPathFromEvent(e: Electron.IpcMainInvokeEvent): string | null {
  const win = winFromEvent(e);
  return getRootPath(win.id);
}

/**
 * Wrap an invoke handler so it runs only with an open project, receiving the
 * resolved `rootPath` as its first argument. Throws "No project open"
 * otherwise — collapsing the guard the throw-style handlers hand-rolled 86×
 * (#990). Use for handlers whose contract is "there must be a project".
 */
export function withRootPath<A extends unknown[], R>(
  fn: (rootPath: string, ...args: A) => R,
): (e: Electron.IpcMainInvokeEvent, ...args: A) => R {
  return (e, ...args) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return fn(rootPath, ...args);
  };
}

/**
 * Like {@link withRootPath}, but returns `fallback` — each handler's own
 * project-less empty value (`[]`, `null`, `false`, `{ ok: false }`, …) —
 * instead of throwing when no project is open (#990).
 */
export function withRootPathOr<A extends unknown[], R>(
  fallback: R,
  fn: (rootPath: string, ...args: A) => R,
): (e: Electron.IpcMainInvokeEvent, ...args: A) => R {
  return (e, ...args) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return fallback;
    return fn(rootPath, ...args);
  };
}

export async function reindexFile(rootPath: string, relativePath: string): Promise<void> {
  if (!isIndexable(relativePath)) return;
  const content = await notebaseFs.readFile(rootPath, relativePath);
  const ctx = projectContext(rootPath);
  await graph.indexNote(ctx, relativePath, content);
  if (relativePath.endsWith('.md')) {
    search.indexNote(ctx, relativePath, content);
    void vectors.indexNote(ctx, relativePath, content); // #835; no-op when disabled
  }
}

export function removeFromIndexes(rootPath: string, relativePath: string): void {
  if (!isIndexable(relativePath)) return;
  const ctx = projectContext(rootPath);
  search.removeNote(ctx, relativePath);
  graph.removeNote(ctx, relativePath);
  void vectors.removeNote(ctx, relativePath); // #835; no-op when disabled
}

export async function listIndexableFiles(rootPath: string, relDir: string): Promise<string[]> {
  const results: string[] = [];
  const absDir = path.join(rootPath, relDir);
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listIndexableFiles(rootPath, rel));
      } else if (isIndexable(entry.name)) {
        results.push(rel);
      }
    }
  } catch { /* directory may not exist */ }
  return results;
}

export async function persistIndexes(rootPath: string): Promise<void> {
  const ctx = projectContext(rootPath);
  // graph.ttl is a cold snapshot (#348). Persist only the search
  // index here; the graph flushes on project release / app-quit.
  void ctx;
  await search.persist(ctx);
}

export function broadcastRewritten(rootPath: string, paths: string[]): void {
  if (paths.length === 0) return;
  for (const targetWin of windowsForProject(rootPath)) {
    targetWin.webContents.send(Channels.NOTEBASE_REWRITTEN, paths);
  }
}

export function broadcastHeadingRename(rootPath: string, candidate: graph.HeadingRenameCandidate): void {
  for (const targetWin of windowsForProject(rootPath)) {
    targetWin.webContents.send(Channels.NOTEBASE_HEADING_RENAME_SUGGESTED, candidate);
  }
}

export const hooks: WritePipelineHooks = {
  markPathHandled,
  broadcastRewritten,
  broadcastHeadingRename,
};
