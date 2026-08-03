import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import type { TabSession, LayoutSession, BookmarkNode } from '../../shared/types';
import { rootPathFromEvent, withRootPathOr, readJsonFileOr } from './helpers';
import { handle } from './typed-ipc';

export function registerBookmarks(): void {
  // Bookmarks. A missing bookmarks.json means "none yet" → []; a corrupt one
  // throws through readJsonFileOr rather than silently reading back as empty
  // (#1631), so the user isn't quietly shown zero bookmarks over lost data.
  handle(Channels.BOOKMARKS_LOAD, withRootPathOr<[], BookmarkNode[] | Promise<BookmarkNode[]>>([], (rootPath) =>
    readJsonFileOr<BookmarkNode[]>(path.join(rootPath, '.minerva', 'bookmarks.json'), [])));

  handle(Channels.BOOKMARKS_SAVE, withRootPathOr(undefined, async (rootPath, tree: BookmarkNode[]) => {
    const bmPath = path.join(rootPath, '.minerva', 'bookmarks.json');
    await fs.mkdir(path.dirname(bmPath), { recursive: true });
    await fs.writeFile(bmPath, JSON.stringify(tree, null, 2), 'utf-8');
  }));

  // Tab session persistence. The payload is opaque JSON to the main process —
  // it round-trips the renderer's session shape (now the multi-group
  // LayoutSession, #816) without inspecting it; the renderer validates and
  // migrates legacy shapes on load.
  handle(Channels.TABS_SAVE, withRootPathOr(undefined, async (rootPath, session: LayoutSession | TabSession) => {
    const tabsPath = path.join(rootPath, '.minerva', 'tabs.json');
    await fs.mkdir(path.dirname(tabsPath), { recursive: true });
    await fs.writeFile(tabsPath, JSON.stringify(session, null, 2), 'utf-8');
  }));

  // `null` = nothing to restore (no project open, or no tabs.json yet); the
  // renderer starts a fresh session either way. A corrupt tabs.json throws
  // instead of collapsing into that same null (#1631) — a parse error was
  // previously indistinguishable from a first run, silently dropping the
  // saved session.
  handle(Channels.TABS_LOAD, async (e): Promise<LayoutSession | TabSession | null> => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    return readJsonFileOr<LayoutSession | TabSession | null>(
      path.join(rootPath, '.minerva', 'tabs.json'),
      null,
    );
  });
}
