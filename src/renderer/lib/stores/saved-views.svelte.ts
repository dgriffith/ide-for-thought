/**
 * Saved-views store (#1072). Owns the `api.views.*` mutations + list state so
 * components never call them directly (renderer data-flow rule #1086): the
 * ObjectsPanel reads `forType()`, the Save-view flow calls `save()`, and the
 * manage dialog calls `rename`/`remove`/`reorder`. Every mutation re-lists so
 * the reactive view is always fresh.
 */
import { api } from '../ipc/client';
import type { SavedView, SavedViewInput, ViewScope } from '../../../shared/types';

let views = $state<SavedView[]>([]);
let loaded = $state(false);

async function refresh(): Promise<void> {
  views = await api.views.list();
  loaded = true;
}

async function save(scope: ViewScope, input: SavedViewInput): Promise<SavedView> {
  const saved = await api.views.save(scope, input);
  await refresh();
  return saved;
}

async function remove(filePath: string): Promise<void> {
  await api.views.delete(filePath);
  await refresh();
}

async function rename(filePath: string, newName: string): Promise<void> {
  await api.views.rename(filePath, newName);
  await refresh();
}

async function reorder(entries: Array<{ filePath: string; order: number | null }>): Promise<void> {
  await api.views.setOrder(entries);
  await refresh();
}

export const savedViewsStore = {
  get views(): SavedView[] {
    return views;
  },
  get loaded(): boolean {
    return loaded;
  },
  /** The saved views for one type, in stored order. */
  forType(typeId: string): SavedView[] {
    return views.filter((v) => v.typeId === typeId);
  },
  refresh,
  save,
  remove,
  rename,
  reorder,
};
