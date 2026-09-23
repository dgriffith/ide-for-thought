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

/**
 * Row cap on the query the panel hands to a new query tab (#2228).
 *
 * The panel used to emit a bare `SELECT * FROM <name>`, which has no ceiling at
 * all: `runQuery` (`sources/tables.ts`) calls `reader.getRowObjectsJS()`, a
 * synchronous full materialization into plain JS objects **on the main process
 * thread**, and the whole array is then structured-cloned to the renderer,
 * which holds a second copy and renders one `<tr>` per row (QueryPanel's result
 * table is not virtualized). Measured here on a 65MB / 1M-row / 6-column CSV:
 *
 *   SELECT * FROM data              1909ms in runQuery, 99.8MB clone payload
 *                                   (+481ms to serialize it), ~180MB retained
 *                                   per process, 6M DOM cells
 *   SELECT * FROM data LIMIT 500      42ms in runQuery, ~0MB payload
 *
 * — a ~45x main-thread saving for a click whose job is "show me this table".
 * 500 rows is a preview that fits the panel's purpose while staying well inside
 * what an unvirtualized table renders comfortably; anyone who wants the whole
 * thing edits one visible word.
 *
 * **On truncation being visible.** Per CLAUDE.md's UI philosophy this ships no
 * banner, toast or interstitial — and it doesn't need one, because the cap is
 * not hidden anywhere: it lands as literal text in the query editor the click
 * opens, one keystroke from being changed or deleted, next to a results header
 * that reads "500 rows" and a panel row whose stat already reads e.g.
 * "1000000 × 6". The user is looking at their own query, so nothing has to tell
 * them it was truncated. This is also the shape QueryPanel's SQL placeholder
 * already teaches (`SELECT *\nFROM my_table\nLIMIT 10`, QueryPanel.svelte:148)
 * — the asymmetry the issue names was that the panel taught LIMIT by example
 * while the button handed out a query without one.
 */
export const TABLE_PREVIEW_ROW_LIMIT = 500;

/**
 * The query a Tables-panel row opens in a new query tab. Multi-line on purpose:
 * it matches QueryPanel's placeholder layout, and it puts `LIMIT` on its own
 * line where it reads as an editable knob rather than a tail nobody scans to.
 */
export function selectStarSql(name: string): string {
  return `SELECT *\nFROM ${name}\nLIMIT ${TABLE_PREVIEW_ROW_LIMIT}`;
}

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
