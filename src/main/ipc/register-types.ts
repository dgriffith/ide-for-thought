/**
 * Typed-objects registry IPC (#1062). Exposes the current project's type
 * catalog to the renderer as serializable `TypeInfo` (mirrors
 * `api.skills.list()`), so pickers/forms never touch raw definitions or the
 * template bodies. Loads fresh per call so a user type dropped into
 * `.minerva/types/` shows up without a full reindex.
 */
import { Channels } from '../../shared/channels';
import { loadTypeCatalog } from '../types/loader';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { toTypeInfo, type TypeCatalogInfo, type NoteTypedProperties } from '../../shared/objects/type-def';
import { handle } from './typed-ipc';
import { withRootPathOr } from './helpers';

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
}
