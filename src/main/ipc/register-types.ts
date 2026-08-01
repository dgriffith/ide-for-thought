/**
 * Typed-objects registry IPC (#1062). Exposes the current project's type
 * catalog to the renderer as serializable `TypeInfo` (mirrors
 * `api.skills.list()`), so pickers/forms never touch raw definitions or the
 * template bodies. Loads fresh per call so a user type dropped into
 * `.minerva/types/` shows up without a full reindex.
 */
import { Channels } from '../../shared/channels';
import { loadTypeCatalog } from '../types/loader';
import { toTypeInfo, type TypeCatalogInfo } from '../../shared/objects/type-def';
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
}
