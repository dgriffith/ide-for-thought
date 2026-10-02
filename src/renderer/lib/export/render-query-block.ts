/**
 * Render a `:::query-*` block for an export (#2512, epic #2508) with the
 * preview's own code path: the directive parsed by the preview's parser
 * (`splitQueryDirective`), its placeholder built by the preview's builder,
 * filled by the preview's `executeQueryBlock` — the same SPARQL prefixes, the
 * same guarded SQL route (`api.tables.queryNote`, registered relations only,
 * #2448), the same list / table / chart / backlinks / search / semantic
 * builders — then snapshotted in the light theme.
 *
 * Two export-only differences, both about the medium rather than the result:
 * a chart draws its final frame at once (no animation to catch mid-way) in a
 * light palette, and it's kept as an image of what it drew.
 */
import { executeQueryBlock, type QueryBlockDeps } from '../preview/query-blocks';
import { parseQueryDirectiveSource, queryBlockPlaceholderHtml } from '../preview/query-directive';
import { QUERY_PREFIXES } from '../preview/query-prefixes';
import { snapshotLiveBlock } from './live-block-snapshot';
import { EXPORT_BLOCK_WIDTH_PX } from './render-object-view';
import type { ChartHandle } from '../charts';

/** Light text/grid for a chart on a white page. */
const EXPORT_CHART_PALETTE = { text: '#2b2a28', tick: '#5f5c56', grid: '#00000014' };

export async function renderQueryBlockForExport(source: string, notePath: string): Promise<string> {
  const directive = parseQueryDirectiveSource(source);
  if (!directive) throw new Error('not a query block');

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_BLOCK_WIDTH_PX}px;pointer-events:none;`;
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  // The preview's container class, so its query-block styles apply.
  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.innerHTML = queryBlockPlaceholderHtml(directive.type, directive.query, directive.config);
  themed.appendChild(preview);
  host.appendChild(themed);
  document.body.appendChild(host);

  const charts: ChartHandle[] = [];
  try {
    const deps: QueryBlockDeps = {
      notePath,
      revision: 0,
      queryCache: new Map(),
      queryPrefixes: QUERY_PREFIXES,
      activeCharts: charts,
      chartOptions: { animate: false, palette: EXPORT_CHART_PALETTE },
    };
    await executeQueryBlock(deps, preview.querySelector<HTMLElement>('.query-block')!);
    return snapshotLiveBlock(themed);
  } finally {
    for (const c of charts) c.destroy();
    host.remove();
  }
}
