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
 *   given: a test's. No `typeId`, so none of the type's own controls; the
 *   layouts judge it by its columns, as they judge a type by its properties.
 * - **A query source** (`querySource`, #2945) runs a query through main
 *   (`api.queryViews.rows`, #2944: SPARQL read-only, SQL through the note
 *   guard) — inline, or a saved query by file name — and its schema is made
 *   from the inferred columns, titled by the query file or "Query view". A
 *   query that fails, or a file that isn't there, is `error`, which the view
 *   shows in its place. Every row comes back, rows that name no note
 *   included (`shared/views/view-rows.ts`, #2946); a card layout merges them
 *   by note. A run that a newer one superseded is dropped by the view,
 *   never shown over it.
 */
import { api } from '../../ipc/client';
import { objectTypesStore } from '../../stores/object-types.svelte';
import type { TypeInfo, TypeInstanceRow } from '../../../../shared/objects/type-def';
import { toViewRows } from '../../../../shared/views/view-rows';
import { queryFileLanguage, queryViewTitle, type QuerySourceSpec } from '../../../../shared/views/view-source-spec';

export interface ViewSourceData {
  /** Null when the source has nothing to show (a type id that matches no type). */
  schema: TypeInfo | null;
  rows: TypeInstanceRow[];
  /** Why there's nothing to show (a query that failed), for the view to say in place. */
  error?: string;
}

export interface ViewSource {
  /** Identity: a new key is a new view (it shows Loading…); the same key refreshes in place. */
  readonly key: string;
  /** The type behind the view, for a type source; null for any other. */
  readonly typeId: string | null;
  /** A query source's spec (#2945), so Save / Copy as markdown can write it; absent otherwise. */
  readonly query?: QuerySourceSpec;
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

/** The text of a saved query named by its file name: the thoughtbase's own first, then this machine's and plugins'. */
async function savedQueryText(name: string): Promise<{ query: string; language: 'sparql' | 'sql' } | null> {
  const all = await api.queries.list();
  const base = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;
  const order = ['project', 'global', 'plugin'] as const;
  const match = [...all].sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope)).find((q) => base(q.filePath) === name);
  return match ? { query: match.query, language: match.language } : null;
}

/** A query view's source (see the header); `key` is its `viewKeyFor`. */
export function querySource(spec: QuerySourceSpec, key: string): ViewSource {
  return {
    key,
    typeId: null,
    query: spec,
    async load() {
      let query: string;
      let language: 'sparql' | 'sql';
      if (spec.kind === 'queryFile') {
        const saved = await savedQueryText(spec.queryFile);
        if (!saved) return { schema: null, rows: [], error: `No saved query named ${spec.queryFile}.` };
        query = saved.query;
        language = saved.language ?? queryFileLanguage(spec.queryFile);
      } else {
        query = spec.query;
        language = spec.language;
      }
      const result = await api.queryViews.rows(query, language, { note: spec.note, columns: spec.columnTypes });
      if (!result.ok) return { schema: null, rows: [], error: result.error };
      const schema: TypeInfo = { id: key, label: queryViewTitle(spec), classLocalName: '', icon: '⌕', source: 'user', properties: result.schema.columns };
      return { schema, rows: toViewRows(result.rows) };
    },
  };
}
