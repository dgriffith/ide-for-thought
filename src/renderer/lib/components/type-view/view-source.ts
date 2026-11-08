/**
 * Where a view's notes come from (#2943, epic #2936): the one thing that
 * differs between a type's view and a query's. A source produces a **schema**
 * — a `TypeInfo`: label, icon, colour, card fields and the columns as
 * `PropertyDef`s — and **rows**, `TypeInstanceRow`s; `TypeView` and every
 * layout read only those. A `revision` bump (the host's graph signal) asks
 * the source again.
 *
 * - **A type source** (`typeSource`) is today's view, exactly: the type and
 *   its instances from `api.types.instances`, with the type catalog loaded
 *   first when a Type filter needs it. It has a `typeId`, and with it the
 *   controls only a type has — the Type filter and subtype choices, moves
 *   (a board's, a calendar's), Save / Copy as markdown.
 * - **A rows source** (`rowsSource`) hands back a schema and rows it was
 *   given: a test's, and a query's once #2944's results arrive (#2945). No
 *   `typeId`, so none of the type's own controls; the layouts judge it by
 *   its columns, as they judge a type by its properties.
 */
import { api } from '../../ipc/client';
import { objectTypesStore } from '../../stores/object-types.svelte';
import type { TypeInfo, TypeInstanceRow } from '../../../../shared/objects/type-def';

export interface ViewSourceData {
  /** Null when the source has nothing to show (a type id that matches no type). */
  schema: TypeInfo | null;
  rows: TypeInstanceRow[];
}

export interface ViewSource {
  /** Identity: a new key is a new view (it shows Loading…); the same key refreshes in place. */
  readonly key: string;
  /** The type behind the view, for a type source; null for any other. */
  readonly typeId: string | null;
  /** The schema and rows. `needCatalog`: a Type filter will match against the type catalog. */
  load(opts: { needCatalog: boolean }): Promise<ViewSourceData>;
}

/** A type's view: the type and its instances (see the header). */
export function typeSource(typeId: string): ViewSource {
  return {
    key: `type:${typeId}`,
    typeId,
    async load({ needCatalog }) {
      // A Type filter (#2716) is matched against the catalog — an export must not snapshot before it's known.
      if (needCatalog && !objectTypesStore.loaded) await objectTypesStore.refresh();
      const result = await api.types.instances(typeId);
      return { schema: result.type, rows: result.instances };
    },
  };
}

/** A view of a schema and rows given whole: a test's, a query's (see the header). */
export function rowsSource(key: string, data: ViewSourceData | (() => Promise<ViewSourceData>)): ViewSource {
  return {
    key,
    typeId: null,
    load: () => (typeof data === 'function' ? data() : Promise.resolve(data)),
  };
}
