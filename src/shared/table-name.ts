/**
 * Sanitize an arbitrary string into a DuckDB-safe SQL table identifier.
 *
 * Shared by the CSV pipeline (`deriveTableName`, which strips the `.csv`
 * extension first) and the markdown-table caption path (#1356), so a
 * `Table: <caption>` line and a `foo.csv` filename derive names by the same
 * rules and can be checked for collisions in one namespace.
 *
 * Rules (case-preserving, matching the original `deriveTableName` core):
 * - Separator-ish characters (`/ \ . - whitespace`) collapse to a single `_`.
 * - Any other non-`[A-Za-z0-9_]` character drops out.
 * - Runs of `_` collapse; leading/trailing `_` are trimmed.
 * - An empty result falls back to `table`.
 * - A digit-leading identifier gets a `t_` prefix (SQL idents can't start with a digit).
 *
 * `Q3 Sales` → `Q3_Sales`; `2024-experiment` → `t_2024_experiment`.
 */
export function slugifyTableName(raw: string): string {
  let name = raw
    .replace(/[/\\.\-\s]+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) name = 'table';
  if (/^[0-9]/.test(name)) name = 't_' + name;
  return name;
}
