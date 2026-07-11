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
import {
  selectBacklinks,
  buildBacklinksHtml,
  semanticKinds,
  selectSemanticNotes,
  buildSemanticHtml,
} from './live-blocks';

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
      console.warn('[query-backlinks] failed:', e);
      el.innerHTML = buildBacklinksHtml([], config);
    }
    return;
  }

  // Semantic block (#1128): rank the corpus by similarity. With a free-text
  // body, embed that query; with an empty body, fall back to "related to THIS
  // note" (the sidebar's stored-vector path). Read-only.
  if (type === 'semantic') {
    const q = (query ?? '').trim();
    el.innerHTML = '<span class="query-loading">Loading...</span>';
    try {
      const result = q
        ? await api.embeddings.searchText(q, {
            limit: 25,
            kinds: semanticKinds(config),
            ...(deps.notePath ? { excludePath: deps.notePath } : {}),
          })
        : deps.notePath
          ? await api.embeddings.related(deps.notePath, 25)
          : { enabled: false, notes: [] };
      const notes = result.enabled ? selectSemanticNotes(result.notes, config) : [];
      el.innerHTML = buildSemanticHtml(notes, config);
    } catch (e) {
      // A silent empty state hid the common cause here — a preload addition
      // (api.embeddings.searchText) needs a full app restart, not just Cmd-R.
      // Surface it so it's diagnosable.
      console.warn('[query-semantic] failed:', e);
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
