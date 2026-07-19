/**
 * Pure logic for the right-sidebar Tables panel. Split out of the component so
 * the SQL-reference parsing and the referenced/defined partition are unit
 * testable without a render.
 *
 * The panel shows two sections:
 *  - **Referenced** — tables the note's SQL fences read (`FROM`/`JOIN`/`INTO`),
 *    parsed from the note body. May include tables defined elsewhere (another
 *    note, a `.csv`) or names that aren't registered at all.
 *  - **Defined in this note** — DuckDB tables materialized from *this* note's
 *    captioned markdown tables (#1356–#1360), i.e. registered tables whose
 *    `source === 'note'` and `relativePath` is the active note.
 *
 * A table a note both defines and queries appears in BOTH sections — they
 * answer different questions ("what this note creates" vs. "what it reads"), so
 * Referenced faithfully mirrors the note's SQL rather than hiding a `FROM`
 * target just because the note also defines it.
 */
import type { TableInfo } from '../../ipc/client';

// Pull SQL fences out first so we don't false-positive on "FROM" in prose.
// Matches ```sql plus the query-directive fences that carry `language: sql`.
const SQL_FENCE_RE = /```(?:sql|query(?:-table|-list)?)\b[^\n]*\n([\s\S]*?)```/gi;
// Very small grammar: a table name after FROM / JOIN / INTO, optionally
// schema-qualified. Over-reports on complex SQL (CTE aliases, derived tables);
// the existence filter in the panel sorts out the noise.
const TABLE_REF_RE = /\b(?:FROM|JOIN|INTO)\s+("[^"]+"|`[^`]+`|[a-zA-Z_][\w.]*)/gi;

/** Distinct bare table names referenced by the note's SQL fences, sorted. */
export function extractReferencedTableNames(content: string): string[] {
  const seen = new Set<string>();
  let fence: RegExpExecArray | null;
  SQL_FENCE_RE.lastIndex = 0;
  while ((fence = SQL_FENCE_RE.exec(content)) !== null) {
    const body = fence[1]!;
    TABLE_REF_RE.lastIndex = 0;
    let ref: RegExpExecArray | null;
    while ((ref = TABLE_REF_RE.exec(body)) !== null) {
      const raw = ref[1]!;
      const unquoted = raw.replace(/^["`]|["`]$/g, '');
      // Strip schema prefix for display + matching — DuckDB registers CSVs and
      // note tables as bare names in the default schema.
      const bare = unquoted.split('.').pop()!;
      if (bare) seen.add(bare);
    }
  }
  return [...seen].sort();
}

/** A referenced-table row: its bare name plus the registered info if the name
 *  resolves to a live DuckDB table (undefined ⇒ shown as "not registered"). */
export interface ReferencedTable {
  name: string;
  info: TableInfo | undefined;
}

export interface PartitionedTables {
  /** Tables this note defines, ordered by their position in the note. */
  defined: TableInfo[];
  /** Tables this note queries, excluding the ones it defines itself. */
  referenced: ReferencedTable[];
}

function matches(text: string, q: string): boolean {
  return q === '' || text.toLowerCase().includes(q);
}

/**
 * Partition the note's tables into the two panel sections, applying the search
 * filter to both. `registered` is the live DuckDB table list (`api.tables.list`).
 */
export function partitionTables(
  content: string,
  registered: TableInfo[],
  activeFilePath: string | null,
  search: string,
): PartitionedTables {
  const q = search.trim().toLowerCase();
  const byName = new Map(registered.map((t) => [t.name, t]));

  const defined = registered
    .filter((t) => t.source === 'note' && activeFilePath != null && t.relativePath === activeFilePath)
    .sort((a, b) => (a.tableIndex ?? 0) - (b.tableIndex ?? 0) || a.name.localeCompare(b.name))
    .filter((t) => matches(t.name, q) || matches(t.caption ?? '', q));

  // Referenced mirrors the note's SQL exactly — a table the note also defines
  // still appears here (and again under Defined); the two sections answer
  // different questions, so the overlap is meaningful, not a duplicate.
  const referenced = extractReferencedTableNames(content)
    .filter((name) => matches(name, q))
    .map((name) => ({ name, info: byName.get(name) }));

  return { defined, referenced };
}
