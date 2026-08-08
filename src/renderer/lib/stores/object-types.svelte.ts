/**
 * Object-types store (#1584). Owns the `api.types.save`/`delete` mutations + the
 * catalog list, so the Type Manager panel never calls them directly (renderer
 * data-flow rule #1086). Every mutation re-lists, and re-lists refresh the
 * reactive view the panel + pickers read.
 *
 * It also caches the bulk `relativePath → typeId` map behind `typeForNote()`,
 * so every note list (sidebar tree, tabs, quick-open, backlinks) can badge a row
 * with its type icon off one projection instead of an N-call fan-out. Catalog
 * and map are fetched together, so a type whose icon is edited in the Type
 * Manager repaints every row on the same `refresh()`.
 */
import { api } from '../ipc/client';
import type { TypeInfo, TypeLoadError } from '../../../shared/objects/type-def';

type SaveInput = Parameters<typeof api.types.save>[0];

let types = $state<TypeInfo[]>([]);
let errors = $state<TypeLoadError[]>([]);
let loaded = $state(false);
/** relativePath → TypeInfo, for O(1) per-row lookup while rendering a list. */
let noteTypes = $state<Record<string, TypeInfo>>({});

async function refresh(): Promise<void> {
  const [catalog, map] = await Promise.all([api.types.list(), api.types.noteTypeMap()]);
  types = catalog.types;
  errors = catalog.errors;
  const byId = new Map(catalog.types.map((t) => [t.id, t]));
  const next: Record<string, TypeInfo> = {};
  for (const [path, typeId] of Object.entries(map)) {
    // A stale `type:` pointing at a deleted type simply goes un-badged.
    const def = byId.get(typeId);
    if (def) next[path] = def;
  }
  noteTypes = next;
  loaded = true;
}

/** The type of the note at `relativePath`, or null if it isn't typed. */
function typeForNote(relativePath: string | null | undefined): TypeInfo | null {
  if (!relativePath) return null;
  return noteTypes[relativePath] ?? null;
}

async function save(input: SaveInput): Promise<{ id: string; filePath: string }> {
  // Snapshot at the IPC boundary. Callers legitimately build the input from
  // values read out of `types` — which is deeply-reactive `$state`, so nested
  // arrays/objects come back as Svelte Proxies, and Electron's structured
  // clone refuses to serialize a Proxy ("could not be cloned"). The Type
  // Manager's Duplicate did exactly that and failed before reaching main.
  // Doing it here rather than per-caller means the next caller can't reopen it.
  const result = await api.types.save($state.snapshot(input));
  await refresh();
  return result;
}

async function remove(id: string): Promise<void> {
  await api.types.delete(id);
  await refresh();
}

/**
 * Drop a locally-customized stock type's in-tree file so the bundled
 * definition takes over again. Mechanically the same call as `remove` — the
 * override IS the file — but named for the intent, because the outcome is
 * opposite: the type survives, it just stops being customized. Never use
 * `removeSafely` here; clearing `type:` off instances would be wrong when the
 * type is about to still exist.
 */
async function revertToStock(id: string): Promise<void> {
  await api.types.delete(id);
  await refresh();
}

async function removeSafely(id: string, clearInstances: boolean): Promise<{ cleared: string[]; failed: { path: string; error: string }[] }> {
  const result = await api.types.deleteSafely(id, clearInstances);
  await refresh();
  return result;
}

async function rename(oldId: string, newLabel: string): Promise<{ newId: string; migrated: string[]; failed: { path: string; error: string }[] }> {
  const result = await api.types.rename(oldId, newLabel);
  await refresh();
  return result;
}

export const objectTypesStore = {
  get types(): TypeInfo[] { return types; },
  get errors(): TypeLoadError[] { return errors; },
  get loaded(): boolean { return loaded; },
  typeForNote,
  refresh,
  save,
  remove,
  revertToStock,
  removeSafely,
  rename,
};
