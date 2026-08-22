/**
 * IPC for local per-note history (#1158): list a note's revisions, read one
 * revision's content, and restore a revision. Capture is automatic (hooked in
 * `notebase/fs.ts:writeFile`), so there's no "save a revision" channel.
 */
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import { withRootPath, hooks } from './helpers';
import { writeAndReindex } from '../notebase/write-pipeline';
import { formatDateTime } from '../../shared/format-datetime';
import * as history from '../history';

export function registerHistory(): void {
  handle(Channels.HISTORY_LIST, withRootPath((rootPath, relativePath: string) =>
    history.listRevisions(rootPath, relativePath)));

  handle(Channels.HISTORY_GET_REVISION, withRootPath((rootPath, relativePath: string, ts: number) =>
    history.getRevisionContent(rootPath, relativePath, ts)));

  handle(Channels.HISTORY_RESTORE, withRootPath(async (rootPath, relativePath: string, ts: number) => {
    const content = await history.getRevisionContent(rootPath, relativePath, ts);
    if (content === null) {
      throw new Error(`history: revision ${ts} of "${relativePath}" not found`);
    }
    // Restore = write the old content back as a NEW save (non-destructive; the
    // restore itself becomes a fresh `restore`-tagged revision). Not
    // broadcast-suppressed, so the open editor reloads via NOTEBASE_REWRITTEN.
    // The cause names WHICH version came back, so a timeline with several
    // restores in it stays readable.
    await history.runWithHistorySource(
      { origin: 'restore', cause: `Restored from ${formatDateTime(ts)}` },
      () => writeAndReindex(rootPath, relativePath, content, hooks),
    );
  }));
}
