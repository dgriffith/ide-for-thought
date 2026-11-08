/**
 * `:::query-list` and `:::query-table` as query views (#2947, epic #2936).
 * The directive syntax stays valid forever and no note is rewritten: the
 * preview and the export read a directive into the object-view spec it means
 * (`directiveViewSpec`) and draw that, so a query list gains sorting, hover
 * previews, the note menu, selection and the view export. "Convert to view"
 * writes the same spec out as an `object-view` fence (`directiveAsFence`),
 * for whoever wants the long form.
 *
 * The directive's settings map one to one:
 * - `list` / `table` → `layout`;
 * - `language` → `language` (`sql`, else SPARQL);
 * - `title` → the view's title;
 * - `link` → `note`, the column naming each row's note (absent: the first
 *   column whose values all name notes — a list's old default, `path`, does);
 * - `columns` → the visible columns.
 *
 * Only `list` and `table`: `:::query-timeseries` is a chart and stays one,
 * and `search` / `semantic` / `backlinks` aren't SPARQL or SQL.
 */

/** The directive kinds that are query views. */
const VIEW_KINDS = new Set(['list', 'table']);

/** The object-view spec a `:::query-<type>` directive means, or null when it isn't a list or table. */
export function directiveViewSpec(type: string, query: string, config: Record<string, unknown>): Record<string, unknown> | null {
  if (!VIEW_KINDS.has(type) || query.trim() === '') return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const spec: Record<string, unknown> = { query: query.trim(), language: str(config.language) === 'sql' ? 'sql' : 'sparql', layout: type };
  const title = str(config.title);
  const link = str(config.link);
  const columns = str(config.columns);
  if (title) spec.title = title;
  if (link) spec.note = link;
  if (columns) spec.columns = columns.split(',').map((c) => c.trim()).filter((c) => c !== '');
  return spec;
}

/** The `object-view` fence a directive converts to ("Convert to view"), or null when it doesn't. */
export function directiveAsFence(type: string, query: string, config: Record<string, unknown>): string | null {
  const spec = directiveViewSpec(type, query, config);
  return spec ? `\`\`\`object-view\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n` : null;
}
