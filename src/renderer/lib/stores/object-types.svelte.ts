/**
 * Object-types store (#1584). Owns the `api.types.save`/`delete` mutations + the
 * catalog list, so the Type Manager panel never calls them directly (renderer
 * data-flow rule #1086). Every mutation re-lists, and re-lists refresh the
 * reactive view the panel + pickers read.
 */
import { api } from '../ipc/client';
import type { TypeInfo, TypeLoadError } from '../../../shared/objects/type-def';

type SaveInput = Parameters<typeof api.types.save>[0];

let types = $state<TypeInfo[]>([]);
let errors = $state<TypeLoadError[]>([]);
let loaded = $state(false);

async function refresh(): Promise<void> {
  const catalog = await api.types.list();
  types = catalog.types;
  errors = catalog.errors;
  loaded = true;
}

async function save(input: SaveInput): Promise<{ id: string; filePath: string }> {
  const result = await api.types.save(input);
  await refresh();
  return result;
}

async function remove(id: string): Promise<void> {
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
  refresh,
  save,
  remove,
  removeSafely,
  rename,
};
