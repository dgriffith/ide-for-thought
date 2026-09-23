// Query-block / chart rendering for the note preview, split out of
// Preview.svelte (#1087). After render, `.query-block` placeholders are walked
// and executed here: SPARQL/SQL presets, plus the read-only live blocks —
// backlinks (#1137) and semantic-related (#1128). Results render as a list,
// table, or a chart canvas. Pure list/table HTML builders sit alongside the
// chart path, which registers a handle the caller destroys before re-render.

import { api } from '../ipc/client';
import { renderChart, type ChartConfig, type ChartHandle, type ChartSeries } from '../charts';
import { normalizeSqlRows } from '../editor/sql-result';
import { escapeHtml, escapeAttr } from './text';
import { getLinkBundle } from '../sidebar-link-bundle';
import type { SearchResult, RelatedNote } from '../../../shared/types';
import {
  selectBacklinks,
  buildBacklinksHtml,
  semanticKinds,
  selectSemanticNotes,
  buildSemanticHtml,
  selectSearchResults,
  buildSearchHtml,
} from './live-blocks';
import { logger } from '../../../shared/logger';

export interface QueryBlockDeps {
  /** Project-relative path of the note being previewed; used by the read-only
   *  live blocks (backlinks "who links to THIS note", semantic "related to
   *  THIS note") and to exclude self from an embedding search. */
  notePath: string | null | undefined;
  /** Graph revision — re-fetches backlinks on index changes (#1137). */
  revision: number;
  /** (language::query) → cached results; survives re-renders (reset on note switch). */
  queryCache: Map<string, { results: unknown[]; error?: string }>;
  /** Standard SPARQL prefixes prepended to each query. */
  queryPrefixes: string;
  /** Live chart handles. Timeseries blocks push here; the caller destroys them
   *  before the next render pass. Mutated in place. */
  activeCharts: ChartHandle[];
}


/**
 * Cache key for a LIVE block — one whose answer depends on the graph rather
 * than only on the query text (#2210 §3c).
 *
 * The backlinks block already had this property: `getLinkBundle(notePath,
 * revision)` is memoized on the revision, so the preview's 120ms render tick
 * re-reads a cached bundle instead of re-querying. The `search` and `semantic`
 * branches did not — they `return`ed above the `queryCache` lookup entirely,
 * so every render tick re-issued their IPC call. For `semantic` with a
 * free-text body that means re-running the embedding model over the query
 * string, eight times a second, for a string that has not changed.
 *
 * `revision` is in the key rather than being a reason to clear, so a graph
 * change still refreshes these blocks (#1137/#1128) while a keystroke does
 * not. Everything the IPC call itself depends on has to be in the key too —
 * for `semantic` that is the kinds filter and the note path, both of which are
 * arguments to the call, not post-hoc filtering.
 */
function liveKey(kind: string, revision: number, ...parts: (string | null | undefined)[]): string {
  return `live::${kind}::${revision}::${parts.map((p) => p ?? '').join('::')}`;
}

/**
 * Drop live entries from previous revisions.
 *
 * Without this the cache grows without bound: each save bumps the revision, so
 * a note edited through a long session would accumulate one entry per block
 * per save and never release any of them. Non-live keys (SPARQL/SQL, which are
 * keyed on the query text alone) are deliberately untouched — they are already
 * bounded by the number of distinct queries in the note.
 */
function pruneStaleLiveEntries(deps: QueryBlockDeps): void {
  const current = `::${deps.revision}::`;
  for (const key of deps.queryCache.keys()) {
    if (key.startsWith('live::') && !key.includes(current)) deps.queryCache.delete(key);
  }
}

export async function executeQueryBlock(deps: QueryBlockDeps, el: HTMLElement): Promise<void> {
  const query = el.dataset.query;
  const type = el.dataset.type;

  let config: Record<string, string> = {};
  try {
    config = JSON.parse(el.dataset.config ?? '{}') as Record<string, string>;
  } catch { /* ignore */ }

  // Backlinks block (#1137): no query body — "who links to THIS note". Sits
  // ahead of the `!query` guard. Direct IPC (deduped, title-enriched, typed
  // rows), not a SPARQL preset. Read-only; nothing is written.
  if (type === 'backlinks') {
    if (!deps.notePath) { el.innerHTML = buildBacklinksHtml([], config); return; }
    try {
      const bundle = await getLinkBundle(deps.notePath, deps.revision);
      el.innerHTML = buildBacklinksHtml(selectBacklinks(bundle.backlinks, config), config);
    } catch (e) {
      logger('query').warn('failed:', e);
      el.innerHTML = buildBacklinksHtml([], config);
    }
    return;
  }

  // Full-text search block (#...): keyword search over the persisted MiniSearch
  // index (api.search.query — the same index the search_notes agent tool uses),
  // rendered as ranked note links. Read-only.
  if (type === 'search') {
    const q = (query ?? '').trim();
    if (!q) { el.innerHTML = buildSearchHtml([], config); return; }
    // The RAW results are cached, not the selected-and-rendered HTML: the
    // selection reads `config`, which is not an input to `api.search.query`,
    // so keeping it outside the cache lets a config edit re-select without
    // re-querying the index.
    const key = liveKey('search', deps.revision, q);
    const hit = deps.queryCache.get(key);
    if (hit) {
      el.innerHTML = buildSearchHtml(
        selectSearchResults(hit.results as SearchResult[], config, deps.notePath), config);
      return;
    }
    pruneStaleLiveEntries(deps);
    el.innerHTML = '<span class="query-loading">Loading...</span>';
    try {
      const results = await api.search.query(q);
      deps.queryCache.set(key, { results });
      el.innerHTML = buildSearchHtml(selectSearchResults(results, config, deps.notePath), config);
    } catch (e) {
      logger('query').warn('failed:', e);
      // A failure is NOT cached — the next tick retries. Caching it would
      // freeze a transient IPC error into the block until the next save.
      el.innerHTML = buildSearchHtml([], config);
    }
    return;
  }

  // Semantic block (#1128): rank the corpus by similarity. With a free-text
  // body, embed that query; with an empty body, fall back to "related to THIS
  // note" (the sidebar's stored-vector path). Read-only.
  if (type === 'semantic') {
    const q = (query ?? '').trim();
    // `kinds` and the note path are ARGUMENTS to the IPC call, so both belong
    // in the key; the rest of `config` only filters the result afterwards and
    // deliberately does not.
    const kinds = semanticKinds(config);
    const key = liveKey('semantic', deps.revision, q, kinds.join(','), deps.notePath);
    const hit = deps.queryCache.get(key);
    if (hit) {
      el.innerHTML = buildSemanticHtml(
        selectSemanticNotes(hit.results as RelatedNote[], config), config);
      return;
    }
    pruneStaleLiveEntries(deps);
    el.innerHTML = '<span class="query-loading">Loading...</span>';
    try {
      const result = q
        ? await api.embeddings.searchText(q, {
            limit: 25,
            kinds,
            ...(deps.notePath ? { excludePath: deps.notePath } : {}),
          })
        : deps.notePath
          ? await api.embeddings.related(deps.notePath, 25)
          : { enabled: false, notes: [] };
      // `enabled: false` (embeddings switched off) and "no matches" render
      // identically, so an empty array is a faithful cache of both.
      const raw = result.enabled ? result.notes : [];
      deps.queryCache.set(key, { results: raw });
      el.innerHTML = buildSemanticHtml(selectSemanticNotes(raw, config), config);
    } catch (e) {
      // A silent empty state hid the common cause here — a preload addition
      // (api.embeddings.searchText) needs a full app restart, not just Cmd-R.
      // Surface it so it's diagnosable.
      logger('query').warn('failed:', e);
      el.innerHTML = buildSemanticHtml([], config);
    }
    return;
  }

  if (!query) return;

  const language = config.language === 'sql' ? 'sql' : 'sparql';
  // Cache key pairs (language, query) so a SQL query and a SPARQL query that
  // happen to share the same string don't collide.
  const cacheKey = `${language}::${query}`;

  const cached = deps.queryCache.get(cacheKey);
  if (cached) {
    renderQueryResults(deps, el, type ?? 'list', config, cached.results, cached.error);
    return;
  }

  el.innerHTML = '<span class="query-loading">Loading...</span>';

  try {
    let results: Record<string, string>[];
    if (language === 'sql') {
      const response = await api.tables.query(query);
      if (!response.ok) {
        deps.queryCache.set(cacheKey, { results: [], error: response.error });
        renderQueryResults(deps, el, type ?? 'list', config, [], response.error);
        return;
      }
      results = normalizeSqlRows(response.columns, response.rows);
    } else {
      const response = await api.graph.query(deps.queryPrefixes + query);
      results = response.results as Record<string, string>[];
    }
    deps.queryCache.set(cacheKey, { results });
    renderQueryResults(deps, el, type ?? 'list', config, results);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.queryCache.set(cacheKey, { results: [], error });
    renderQueryResults(deps, el, type ?? 'list', config, [], error);
  }
}

function renderQueryResults(deps: QueryBlockDeps, el: HTMLElement, type: string, config: Record<string, string>, results: unknown[], error?: string): void {
  if (error) {
    el.innerHTML = `<p class="query-error">${escapeHtml(error)}</p>`;
    return;
  }

  const title = config.title;
  const titleHtml = title ? `<h4 class="query-title">${escapeHtml(title)}</h4>` : '';

  if (type === 'list') {
    renderAsList(el, config, results, titleHtml);
  } else if (type === 'table') {
    renderAsTable(el, config, results, titleHtml);
  } else if (type === 'timeseries') {
    renderAsTimeseries(deps, el, config, results);
  } else {
    el.innerHTML = `<p class="query-error">Unknown directive type: ${escapeHtml(type)}</p>`;
  }
}

function renderAsList(el: HTMLElement, config: Record<string, string>, results: unknown[], titleHtml: string): void {
  // "link" config key specifies which column contains the navigable path (default: "path")
  const linkCol = config.link ?? 'path';
  const rows = results as Record<string, string>[];

  const items = rows.map((r) => {
    const label = r.title ?? r.name ?? r.label ?? r[linkCol] ?? 'Untitled';
    const path = r[linkCol] ?? '';
    if (path) {
      return `<li><a class="wiki-link" data-target="${escapeAttr(path)}">${escapeHtml(label)}</a></li>`;
    }
    return `<li>${escapeHtml(label)}</li>`;
  });
  el.innerHTML = items.length > 0
    ? `${titleHtml}<ul class="query-result-list">${items.join('')}</ul>`
    : `${titleHtml}<p class="query-empty">No results</p>`;
}

function renderAsTable(el: HTMLElement, config: Record<string, string>, results: unknown[], titleHtml: string): void {
  const rows = results as Record<string, string>[];
  if (rows.length === 0) {
    el.innerHTML = `${titleHtml}<p class="query-empty">No results</p>`;
    return;
  }

  // "link" config key specifies which column contains navigable paths
  const linkCol = config.link ?? '';
  // "columns" config key can restrict/reorder visible columns (comma-separated)
  const allCols = Object.keys(rows[0]!);
  const visibleCols = config.columns
    ? config.columns.split(',').map(c => c.trim()).filter(c => allCols.includes(c))
    : allCols;

  const headers = visibleCols.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows.map(r => {
    const cells = visibleCols.map(c => {
      const val = r[c] ?? '';
      if (c === linkCol || (linkCol === '' && c === 'path')) {
        return `<td><a class="wiki-link" data-target="${escapeAttr(val)}">${escapeHtml(val)}</a></td>`;
      }
      // If this cell looks like a path and there's a link column, make it a link using that path
      if (linkCol && r[linkCol]) {
        // Only make the title/name/label column clickable
        if (c === 'title' || c === 'name' || c === 'label') {
          return `<td><a class="wiki-link" data-target="${escapeAttr(r[linkCol])}">${escapeHtml(val)}</a></td>`;
        }
      }
      return `<td>${escapeHtml(val)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  el.innerHTML = `${titleHtml}<table class="query-result-table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderAsTimeseries(deps: QueryBlockDeps, el: HTMLElement, config: Record<string, string>, results: unknown[]): void {
  const rows = results as Record<string, string>[];
  if (rows.length === 0) {
    const title = config.title;
    el.innerHTML = title
      ? `<h4 class="query-title">${escapeHtml(title)}</h4><p class="query-empty">No results</p>`
      : '<p class="query-empty">No results</p>';
    return;
  }

  const allCols = Object.keys(rows[0]!);
  const xCol = config.x ?? allCols[0] ?? '';
  const yCols = config.y
    ? config.y.split(',').map(c => c.trim())
    : allCols.filter(c => c !== xCol);
  const chartType = (config.type ?? 'line') as 'line' | 'bar' | 'area';
  const height = parseInt(config.height ?? '300', 10);

  const series: ChartSeries[] = yCols.map(col => ({
    label: col,
    data: rows.map(r => ({
      x: r[xCol] ?? '',
      y: parseFloat(r[col] ?? '0') || 0,
    })),
  }));

  const chartConfig: ChartConfig = {
    ...(config.title !== undefined ? { title: config.title } : {}),
    type: chartType,
    height,
    series,
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'query-chart-wrapper';
  wrapper.style.height = `${height}px`;
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  el.innerHTML = '';
  el.appendChild(wrapper);

  const handle = renderChart(canvas, chartConfig);
  deps.activeCharts.push(handle);
}
