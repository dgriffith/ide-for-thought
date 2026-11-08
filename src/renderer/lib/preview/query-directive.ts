/**
 * The `:::query-TYPE … :::` directive, parsed one way for both the preview's
 * markdown plugin and the export renderer (#2512): the body splits on a
 * `\n---\n` into `key: value` config lines above and the query below (no
 * separator → the whole body is the query), and renders as a `.query-block`
 * placeholder that `executeQueryBlock` fills. Pulled out of
 * `markdown-config.ts`, which used to do this inline.
 */
import { escapeAttr, escapeHtml } from './text';

export interface QueryDirective {
  query: string;
  config: Record<string, string>;
}

/** Split a directive body (the text between its opening and closing lines). */
export function splitQueryDirective(body: string): QueryDirective {
  const sepIdx = body.indexOf('\n---\n');
  const config: Record<string, string> = {};
  if (sepIdx < 0) return { query: body, config };
  for (const line of body.slice(0, sepIdx).trim().split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key && value) config[key] = value;
    }
  }
  return { query: body.slice(sepIdx + 5).trim(), config };
}

/** The placeholder `executeQueryBlock` fills — the preview's exact markup. */
export function queryBlockPlaceholderHtml(type: string, query: string, config: Record<string, unknown>): string {
  const configJson = Object.keys(config).length > 0 ? escapeAttr(JSON.stringify(config)) : '';
  return `<div class="query-block" data-type="${escapeAttr(type)}" data-query="${escapeAttr(query)}"${configJson ? ` data-config="${configJson}"` : ''}><span class="query-loading">Loading...</span></div>`;
}

/**
 * A `:::query-list` / `:::query-table` as a query view (#2947): an object-view
 * placeholder the object-view hydrator mounts, sized to its rows
 * (`object-view-fit`) rather than an embed's fixed box, under the directive's
 * title as the heading a query list always drew — an embed has no header.
 */
export function queryViewDirectiveHtml(spec: Record<string, unknown>): string {
  const title = typeof spec.title === 'string' ? `<h4 class="query-title">${escapeHtml(spec.title)}</h4>` : '';
  const json = JSON.stringify(spec).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div class="query-view-directive">${title}<div class="object-view-block object-view-fit" data-object-view-pending="1">${json}</div></div>`;
}

/**
 * A whole directive's text (opening line, body, closing `:::`), as the export
 * pipeline extracts it, back into its parts — or null if it isn't one.
 */
export function parseQueryDirectiveSource(source: string): ({ type: string } & QueryDirective) | null {
  const lines = source.replace(/\n$/, '').split('\n');
  const open = /^\s*:::query-(\w+)\s*$/.exec(lines[0] ?? '');
  if (!open || lines.length < 2 || lines[lines.length - 1]!.trim() !== ':::') return null;
  return { type: open[1]!, ...splitQueryDirective(lines.slice(1, -1).join('\n').trim()) };
}
