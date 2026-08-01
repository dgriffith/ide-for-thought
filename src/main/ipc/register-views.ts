/**
 * Saved-views IPC (#1072) — CRUD + reorder over the typed-object multi-view
 * presets, mirroring register-queries.ts. Project scope needs the event's root
 * path; the store no-ops gracefully when none is open.
 */
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import * as savedViews from '../saved-views';
import type { SavedViewInput } from '../../shared/types';
import { rootPathFromEvent } from './helpers';

export function registerViews(): void {
  handle(Channels.VIEWS_LIST, (e) => savedViews.listSavedViews(rootPathFromEvent(e)));

  handle(Channels.VIEWS_SAVE, (e, scope: 'project' | 'global', input: SavedViewInput) =>
    savedViews.saveView(rootPathFromEvent(e), scope, input));

  handle(Channels.VIEWS_DELETE, (_e, filePath: string) => savedViews.deleteView(filePath));

  handle(Channels.VIEWS_RENAME, (_e, filePath: string, newName: string) =>
    savedViews.renameView(filePath, newName));

  handle(Channels.VIEWS_SET_ORDER, (_e, entries: Array<{ filePath: string; order: number | null }>) =>
    savedViews.setViewOrder(entries));
}
