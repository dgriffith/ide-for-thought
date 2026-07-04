import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import type { TabSession, LayoutSession } from '../../shared/types';
import { rootPathFromEvent, withRootPathOr } from './helpers';

export function registerBookmarks(): void {
  // Bookmarks
  ipcMain.handle(Channels.BOOKMARKS_LOAD, withRootPathOr<[], unknown[] | Promise<unknown[]>>([], async (rootPath) => {
    try {
      const bmPath = path.join(rootPath, '.minerva', 'bookmarks.json');
      const data = await fs.readFile(bmPath, 'utf-8');
      return JSON.parse(data) as unknown[];
    } catch { return []; }
  }));

  ipcMain.handle(Channels.BOOKMARKS_SAVE, withRootPathOr(undefined, async (rootPath, tree: unknown) => {
    const bmPath = path.join(rootPath, '.minerva', 'bookmarks.json');
    await fs.mkdir(path.dirname(bmPath), { recursive: true });
    await fs.writeFile(bmPath, JSON.stringify(tree, null, 2), 'utf-8');
  }));

  // Tab session persistence. The payload is opaque JSON to the main process —
  // it round-trips the renderer's session shape (now the multi-group
  // LayoutSession, #816) without inspecting it; the renderer validates and
  // migrates legacy shapes on load.
  ipcMain.handle(Channels.TABS_SAVE, withRootPathOr(undefined, async (rootPath, session: LayoutSession | TabSession) => {
    const tabsPath = path.join(rootPath, '.minerva', 'tabs.json');
    await fs.mkdir(path.dirname(tabsPath), { recursive: true });
    await fs.writeFile(tabsPath, JSON.stringify(session, null, 2), 'utf-8');
  }));

  ipcMain.handle(Channels.TABS_LOAD, async (e): Promise<LayoutSession | TabSession | null> => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    try {
      const tabsPath = path.join(rootPath, '.minerva', 'tabs.json');
      const data = await fs.readFile(tabsPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  });
}
