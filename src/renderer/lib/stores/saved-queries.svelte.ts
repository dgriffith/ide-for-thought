/**
 * Saved-queries store (#314 / #315, #1674). Owns the `api.queries.*` mutations
 * so the Edit Saved Queries dialog never calls them directly (renderer data-flow
 * rule #1086). Every write on this domain goes through here — `save` joined
 * its siblings in #1870, closing the last gap.
 *
 * The dialog formerly reached these through raw `window.api.queries.*`, which
 * slipped the data-flow eslint rule entirely — its selector matched only the
 * typed `api` identifier, not the `window.api` bridge form. The dialog keeps its
 * own list state and re-reads via `api.queries.list()` (a read, allowed in
 * components) after each mutation, so this store is the single write path.
 */
import { api } from '../ipc/client';
import type { SavedQuery } from '../../../shared/types';

export const savedQueriesStore = {
  /** Save a new query under `name`, in the project or global scope. */
  save(
    scope: SavedQuery['scope'],
    name: string,
    description: string,
    query: string,
    language: SavedQuery['language'],
  ): Promise<SavedQuery> {
    return api.queries.save(scope, name, description, query, language);
  },
  /** Rename a saved query; resolves to its (possibly new) file path. */
  rename(filePath: string, newName: string): Promise<string> {
    return api.queries.rename(filePath, newName);
  },
  /** Delete a saved query. */
  remove(filePath: string): Promise<void> {
    return api.queries.delete(filePath);
  },
  /** Move a saved query between the project and global scopes; resolves to its new path. */
  move(filePath: string, newScope: SavedQuery['scope']): Promise<string> {
    return api.queries.move(filePath, newScope);
  },
  /** Set (or clear, with null) a saved query's group. */
  setGroup(filePath: string, group: string | null): Promise<void> {
    return api.queries.setGroup(filePath, group);
  },
  /** Apply a new `@order` across many queries at once (drag-reorder). */
  setOrder(entries: Array<{ filePath: string; order: number | null }>): Promise<void> {
    return api.queries.setOrder(entries);
  },
};
