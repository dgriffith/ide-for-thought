/**
 * Typed-objects registry IPC (#1062). Exposes the current project's type
 * catalog to the renderer as serializable `TypeInfo` (mirrors
 * `api.skills.list()`), so pickers/forms never touch raw definitions or the
 * template bodies. Loads fresh per call so a user type dropped into
 * `.minerva/types/` shows up without a full reindex.
 *
 * **Not `GraphState.typeCatalog`, deliberately (#2225).** The graph holds a
 * catalog and this handler doesn't read it, which looks like an oversight and
 * was filed as one. It is load-bearing, for two reasons:
 *
 *  1. **Nothing invalidates it.** `state.typeCatalog` is written by exactly two
 *     things — `indexAllNotes` (full rebuild) and `reloadTypeCatalog` (the
 *     TYPES_SAVE / TYPES_DELETE / rename / LLM-apply paths). The `.minerva`
 *     watcher (`notebase/watcher.ts`) is scoped to `sources` and `excerpts`,
 *     so a type file edited in an external editor, restored from a backup or
 *     arriving via `git pull` produces no event at all. Reading the cache would
 *     serve project-open-time state until something unrelated forced a reload.
 *     `tests/main/graph/note-type-map.test.ts` has the shape already ("the
 *     catalog was loaded before this type existed").
 *  2. **It is empty for part of project open.** `initGraph` seeds
 *     `EMPTY_TYPE_CATALOG` and only the later `indexAllNotes` fills it, so a
 *     list that raced project init would return `{ types: [] }` — a plausible-
 *     looking empty catalog rather than an error, which is the worst failure
 *     shape for a picker.
 *
 * The cost the issue was actually chasing is the *parse*, and that is memoized
 * inside `types/loader.ts` now (content-keyed, so it cannot go stale). The walk
 * stays.
 */
import { Channels } from '../../shared/channels';
import { loadTypeCatalog } from '../types/loader';
import { saveType, deleteType, type SaveTypeInput } from '../types/write';
import { deleteTypeSafely, renameType } from '../types/migrate';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { toTypeInfo, type TypeCatalogInfo, type NoteTypedProperties, type TypeInstancesResult } from '../../shared/objects/type-def';
import { handle } from './typed-ipc';
import { withRootPath, withRootPathOr } from './helpers';

export function registerTypes(): void {
  handle(
    Channels.TYPES_LIST,
    withRootPathOr<[], TypeCatalogInfo | Promise<TypeCatalogInfo>>({ types: [], errors: [] }, async (rootPath) => {
      const catalog = await loadTypeCatalog(rootPath);
      return { types: catalog.types.map(toTypeInfo), errors: catalog.errors };
    }),
  );

  // A note's declared properties + current values, for the property form (#1066)
  // and type-keyed renderers (#1071). Projects over the already-indexed graph.
  handle(
    Channels.TYPES_NOTE_PROPERTIES,
    withRootPathOr<[string], NoteTypedProperties | Promise<NoteTypedProperties>>(
      { type: null, properties: [] },
      (rootPath, relativePath: string) => graph.getNoteTypedProperties(projectContext(rootPath), relativePath),
    ),
  );

  // Every instance of a type + its declared-property values, for the list/table/
  // gallery multi-view (#1070). A pure read over the already-indexed graph.
  handle(
    Channels.TYPES_INSTANCES,
    withRootPathOr<[string], TypeInstancesResult | Promise<TypeInstancesResult>>(
      { type: null, instances: [] },
      (rootPath, typeId: string) => graph.getTypeInstances(projectContext(rootPath), typeId),
    ),
  );

  // Which notes are typed, for the type icons on note rows. `{}` on no project
  // is a legitimate "nothing is typed yet" answer, not a failure signal.
  handle(
    Channels.TYPES_NOTE_TYPE_MAP,
    withRootPathOr<[], Record<string, string> | Promise<Record<string, string>>>(
      {},
      (rootPath) => graph.getNoteTypeMap(projectContext(rootPath)),
    ),
  );

  // Save a new user object type derived from a note ("Save Note as Object Type").
  // Writes `.minerva/types/<id>.md`, then reloads the graph's type catalog so the
  // new type is immediately usable for promotion + indexing.
  handle(Channels.TYPES_SAVE, withRootPath(async (rootPath, input: SaveTypeInput) => {
    const result = await saveType(rootPath, input);
    await graph.reloadTypeCatalog(projectContext(rootPath));
    return result;
  }));

  handle(Channels.TYPES_DELETE, withRootPath(async (rootPath, id: string) => {
    await deleteType(rootPath, id);
    await graph.reloadTypeCatalog(projectContext(rootPath));
  }));

  // Rename/delete safety (#1588) — migrate or clear a type's instances so no note
  // is left silently pointing at a type that no longer exists.
  handle(Channels.TYPES_DELETE_SAFELY, withRootPath((rootPath, id: string, clearInstances: boolean) =>
    deleteTypeSafely(rootPath, id, clearInstances)));

  handle(Channels.TYPES_RENAME, withRootPath((rootPath, oldId: string, newLabel: string) =>
    renameType(rootPath, oldId, newLabel)));
}
