import path from 'node:path';
import { Channels } from '../../shared/channels';
import type { TabSession, LayoutSession, BookmarkNode } from '../../shared/types';
import { rootPathFromEvent, withRootPath, withRootPathOr, readJsonFileOr, writeJsonFileAtomic } from './helpers';
import { handle } from './typed-ipc';

export function registerBookmarks(): void {
  // Bookmarks. A missing bookmarks.json means "none yet" → []; a corrupt one
  // throws through readJsonFileOr rather than silently reading back as empty
  // (#1631), so the user isn't quietly shown zero bookmarks over lost data.
  handle(Channels.BOOKMARKS_LOAD, withRootPathOr<[], BookmarkNode[] | Promise<BookmarkNode[]>>([], (rootPath) =>
    readJsonFileOr<BookmarkNode[]>(path.join(rootPath, '.minerva', 'bookmarks.json'), [])));

  handle(Channels.BOOKMARKS_SAVE, withRootPath(async (rootPath, tree: BookmarkNode[]) => {
    await writeJsonFileAtomic(path.join(rootPath, '.minerva', 'bookmarks.json'), tree);
  }));

  // Tab session persistence. The payload is opaque JSON to the main process —
  // it round-trips the renderer's session shape (now the multi-group
  // LayoutSession, #816) without inspecting it; the renderer validates and
  // migrates legacy shapes on load.
  //
  // Deliberately `withRootPathOr`, not `withRootPath` (#1894 follow-up): unlike
  // BOOKMARKS_SAVE (only reachable via an explicit bookmark action inside an
  // open project), the editor store schedules a tab-session persist
  // reactively off its own state — including the very first, empty layout a
  // brand-new project-less window mounts with. There is no rootPath to write
  // `tabs.json` under in that state, so "no project" and "nothing to persist"
  // are the same answer, not a disguised failure — confirmed the hard way
  // when switching this to `withRootPath` broke the smoke test's "no thrown
  // errors" assertion on a fresh launch.
  handle(Channels.TABS_SAVE, withRootPathOr(undefined, async (rootPath, session: LayoutSession | TabSession) => {
    await writeJsonFileAtomic(path.join(rootPath, '.minerva', 'tabs.json'), session);
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
