import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import * as notebaseFs from '../notebase/fs';
import { isIndexable } from '../notebase/indexable-files';
import * as graph from '../graph/index';
import * as search from '../search/index';
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

export async function reindexFile(rootPath: string, relativePath: string): Promise<void> {
  if (!isIndexable(relativePath)) return;
  const content = await notebaseFs.readFile(rootPath, relativePath);
  const ctx = projectContext(rootPath);
  await graph.indexNote(ctx, relativePath, content);
  if (relativePath.endsWith('.md')) {
    search.indexNote(ctx, relativePath, content);
  }
}

export function removeFromIndexes(rootPath: string, relativePath: string): void {
  if (!isIndexable(relativePath)) return;
  const ctx = projectContext(rootPath);
  search.removeNote(ctx, relativePath);
  graph.removeNote(ctx, relativePath);
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
