/**
 * A view's loaded data (#2943, #2945): the schema and rows its source last
 * gave, whether it's loading, and the error a query source reported. Out of
 * `TypeView` so the rules live in one place:
 *
 * - **Loading… only for a new source.** The same source asked again (a graph
 *   change, a move) refreshes in place, so a board keeps its focus.
 * - **A run superseded by a newer one is dropped**, never shown over it: two
 *   graph changes in quick succession mean two loads, and the first to start
 *   can finish last.
 * - `onLoaded` runs after the rows have rendered — the export snapshot must
 *   not capture "Loading…".
 */
import { tick } from 'svelte';
import type { ViewSource } from './view-source';
import type { TypeInfo, TypeInstanceRow } from '../../../../shared/objects/type-def';

export function createViewLoader(opts: { needCatalog: () => boolean; onLoaded: () => (() => void) | undefined }) {
  let schema = $state<TypeInfo | null>(null);
  let rows = $state<TypeInstanceRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let loadedKey: string | null = null;
  let seq = 0;

  async function load(from: ViewSource): Promise<void> {
    loading = loadedKey !== from.key;
    const mine = ++seq;
    const result = await from.load({ needCatalog: opts.needCatalog() });
    if (mine !== seq) return;
    error = result.error ?? null;
    schema = result.schema;
    rows = result.rows;
    loadedKey = from.key;
    loading = false;
    const done = opts.onLoaded();
    if (done) { await tick(); done(); }
  }

  return {
    get schema() { return schema; },
    get rows() { return rows; },
    get loading() { return loading; },
    get error() { return error; },
    load,
  };
}
