/**
 * Table indexing (#1624 — split by format out of indexers.ts). Two related
 * surfaces:
 *   - `indexTable` — the in-note CSVW view of a markdown table (rows + cells),
 *     called by `indexNote`;
 *   - the DuckDB overlay indexers (`indexCsvTable` / `indexMarkdownTable` and
 *     their un-index cleaners) — the typed, named, OWL-class view SPARQL
 *     consumers get for registered CSV files and captioned markdown tables.
 */
import * as $rdf from 'rdflib';
import type { ProjectContext } from '../../project-context-types';
import type { ParsedTable } from '../parser';
import {
  getState, invalidate,
  RDF, RDFS, CSVW, XSD, OWL, MINERVA,
  noteUri, tableUri,
  type GraphState,
} from '../state';
import { checkLLMWriteGuard } from '../write-guard';

/** In-note CSVW triples for one markdown table (rows + cells). The overlay with
 *  typed columns lives on a separate node (`indexMarkdownTable`). */
export function indexTable(
  state: GraphState,
  table: ParsedTable,
  tableIndex: number,
  noteNode: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  const { store } = state;

  const tableNode = $rdf.sym(`${noteNode.value}/table/${tableIndex}`);
  store.add(tableNode, RDF('type'), CSVW('Table'), graph);
  store.add(tableNode, CSVW('inNote'), noteNode, graph);
  // A captioned table (#1360) labels its in-note node with the human caption.
  // The SQL name + typed schema live on the separate DuckDB overlay node
  // (indexMarkdownTable), which links back here via minerva:fromTable — so the
  // in-note node deliberately does NOT carry minerva:tableName (that would make
  // two nodes answer to one name). Uncaptioned tables are unchanged.
  if (table.caption) store.add(tableNode, RDFS('label'), $rdf.lit(table.caption), graph);

  // Columns
  const colNodes: $rdf.NamedNode[] = [];
  for (let ci = 0; ci < table.headers.length; ci++) {
    const colName = table.headers[ci]!;
    const colUri = $rdf.sym(`${tableNode.value}/column/${encodeURIComponent(colName)}`);
    colNodes.push(colUri);
    store.add(colUri, RDF('type'), CSVW('Column'), graph);
    store.add(colUri, CSVW('name'), $rdf.lit(colName), graph);
    store.add(colUri, CSVW('columnIndex'), $rdf.lit(String(ci), undefined, XSD('integer')), graph);
    store.add(tableNode, CSVW('column'), colUri, graph);
  }

  // Rows and cells
  for (let ri = 0; ri < table.rows.length; ri++) {
    const rowUri = $rdf.sym(`${tableNode.value}/row/${ri}`);
    store.add(rowUri, RDF('type'), CSVW('Row'), graph);
    store.add(rowUri, CSVW('rowIndex'), $rdf.lit(String(ri), undefined, XSD('integer')), graph);
    store.add(tableNode, CSVW('row'), rowUri, graph);

    for (let ci = 0; ci < table.headers.length; ci++) {
      const value = table.rows[ri]![ci] ?? '';
      const cellUri = $rdf.sym(`${rowUri.value}/cell/${encodeURIComponent(table.headers[ci]!)}`);
      store.add(cellUri, RDF('type'), CSVW('Cell'), graph);
      store.add(cellUri, CSVW('column'), colNodes[ci], graph);
      store.add(cellUri, RDF('value'), $rdf.lit(value), graph);
      store.add(rowUri, CSVW('cell'), cellUri, graph);
    }
  }
}

// ── CSV-as-DuckDB table indexing ────────────────────────────────────────────

/**
 * Shape of a registered CSV table column, passed in from the DuckDB side.
 * `duckdbType` comes from `information_schema.columns` (VARCHAR, INTEGER,
 * DOUBLE, TIMESTAMP, …). We map it to an xsd datatype so SPARQL consumers
 * can reason about ranges.
 */
export interface CsvTableColumn {
  name: string;
  duckdbType: string;
  index: number;
}

export interface CsvTableShape {
  tableName: string;
  relativePath: string;
  columns: CsvTableColumn[];
}

/**
 * Crude DuckDB type → XSD datatype mapping. DuckDB's type vocabulary is
 * richer than xsd's — e.g. HUGEINT, UUID, INTERVAL — so we keep the map
 * conservative and fall back to xsd:string when nothing else fits. The
 * goal is "a SPARQL consumer can filter by range", not "round-trip every
 * DuckDB value losslessly".
 */
function xsdForDuckDbType(duckdbType: string) {
  const t = duckdbType.toUpperCase();
  if (t === 'BOOLEAN') return XSD('boolean');
  if (t === 'DATE') return XSD('date');
  if (t === 'TIME') return XSD('time');
  if (t.startsWith('TIMESTAMP')) return XSD('dateTime');
  if (t === 'FLOAT' || t === 'REAL') return XSD('float');
  if (t === 'DOUBLE') return XSD('double');
  if (t.startsWith('DECIMAL') || t === 'NUMERIC') return XSD('decimal');
  if (t === 'TINYINT' || t === 'SMALLINT' || t === 'INTEGER' || t === 'BIGINT' || t === 'HUGEINT') {
    return XSD('integer');
  }
  if (t === 'UTINYINT' || t === 'USMALLINT' || t === 'UINTEGER' || t === 'UBIGINT') {
    return XSD('nonNegativeInteger');
  }
  // VARCHAR / TEXT / BLOB / UUID / INTERVAL / LIST / STRUCT / … all fall
  // through to string. Users who need finer typing can refine via a
  // companion note's frontmatter in a later pass.
  return XSD('string');
}

/**
 * Write CSVW + OWL triples describing a registered CSV table. The named
 * graph equals the table URI so re-indexing is a clean wipe-and-replace,
 * same pattern as notes.
 *
 * - `csvw:Table` + `owl:Class` on the table (rows are its instances).
 * - `csvw:Schema` with ordered `csvw:column` references.
 * - Each column is both a `csvw:Column` (index, name, datatype) and an
 *   `owl:DatatypeProperty` (rdfs:domain = table, rdfs:range = xsd type)
 *   so SPARQL queries can reason about columns-as-predicates.
 */
export function indexCsvTable(ctx: ProjectContext, shape: CsvTableShape): void {
  checkLLMWriteGuard('indexCsvTable');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const { store } = state;
  const table = tableUri(state, shape.tableName);
  const graph = table;
  const schema = $rdf.sym(`${table.value}/schema`);

  // Clean slate for this table's triples.
  store.removeMatches(undefined, undefined, undefined, graph);

  store.add(table, RDF('type'), CSVW('Table'), graph);
  store.add(table, RDF('type'), OWL('Class'), graph);
  store.add(table, RDFS('label'), $rdf.lit(shape.tableName), graph);
  store.add(table, CSVW('url'), $rdf.lit(shape.relativePath), graph);
  store.add(table, CSVW('tableSchema'), schema, graph);
  store.add(table, MINERVA('tableName'), $rdf.lit(shape.tableName), graph);
  store.add(table, MINERVA('relativePath'), $rdf.lit(shape.relativePath), graph);
  // Join-back link to the CSV file's own note-URI, so SPARQL can pivot
  // between the file-level view (row data, written by indexCsvFile)
  // and this SQL-centric view (named table, typed columns, OWL class).
  store.add(table, MINERVA('fromFile'), noteUri(state, shape.relativePath), graph);

  store.add(schema, RDF('type'), CSVW('Schema'), graph);

  for (const col of shape.columns) {
    const colUri = $rdf.sym(`${table.value}/column/${encodeURIComponent(col.name)}`);
    const xsdType = xsdForDuckDbType(col.duckdbType);
    store.add(schema, CSVW('column'), colUri, graph);
    store.add(colUri, RDF('type'), CSVW('Column'), graph);
    store.add(colUri, RDF('type'), OWL('DatatypeProperty'), graph);
    store.add(colUri, CSVW('name'), $rdf.lit(col.name), graph);
    store.add(colUri, CSVW('columnIndex'), $rdf.lit(String(col.index), undefined, XSD('integer')), graph);
    store.add(colUri, CSVW('datatype'), xsdType, graph);
    store.add(colUri, RDFS('label'), $rdf.lit(col.name), graph);
    store.add(colUri, RDFS('domain'), table, graph);
    store.add(colUri, RDFS('range'), xsdType, graph);
  }
}

/** Remove all triples for a CSV table (entire named graph). */
export function unindexCsvTable(ctx: ProjectContext, tableName: string): void {
  checkLLMWriteGuard('unindexCsvTable');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const graph = tableUri(state, tableName);
  state.store.removeMatches(undefined, undefined, undefined, graph);
}

/**
 * Drop every CSV-registered table's triples. Used at the start of a
 * full rescan so triples for CSVs deleted while the app was closed
 * don't persist. Identifies them via `minerva:fromFile` — a predicate
 * unique to CSV overlays. Markdown-table overlays carry `minerva:fromNote`
 * instead (indexMarkdownTable) and the in-note csvw:Table nodes carry
 * neither, so both are left untouched.
 */
export function unindexAllCsvTables(ctx: ProjectContext): void {
  checkLLMWriteGuard('unindexAllCsvTables');
  removeTableGraphsBy(ctx, MINERVA('fromFile'));
}

// ── Markdown-table DuckDB overlay (#1360) ───────────────────────────────────

/**
 * Shape of a captioned markdown table registered into DuckDB, passed in from
 * the tables module (which owns the DuckDB-inferred column types). Mirrors
 * `CsvTableShape` but keyed to the source note + its in-note table index.
 */
export interface MarkdownTableShape {
  tableName: string;
  notePath: string;
  tableIndex: number;
  caption: string;
  columns: CsvTableColumn[];
}

/**
 * Write the CSVW + OWL schema overlay for a captioned markdown table, the
 * graph-parity twin of `indexCsvTable` (#1360). The in-note `indexTable`
 * node keeps the untyped rows/cells; this overlay adds the typed, named,
 * OWL-class view SPARQL consumers get for CSVs. The named graph equals the
 * table URI, so re-indexing is a clean wipe-and-replace.
 *
 * Join-back mirrors the CSV `minerva:fromFile` bridge: `minerva:fromNote`
 * points at the source note and `minerva:fromTable` at the in-note CSVW node,
 * so overlay ↔ rows ↔ note all connect. Since a markdown table can't share a
 * name with a CSV (collision detection blocks it), their table URIs never clash.
 */
export function indexMarkdownTable(ctx: ProjectContext, shape: MarkdownTableShape): void {
  checkLLMWriteGuard('indexMarkdownTable');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const { store } = state;
  const tableNode = tableUri(state, shape.tableName);
  const graph = tableNode;
  const schema = $rdf.sym(`${tableNode.value}/schema`);
  const note = noteUri(state, shape.notePath);
  const inNoteTable = $rdf.sym(`${note.value}/table/${shape.tableIndex}`);

  store.removeMatches(undefined, undefined, undefined, graph);

  store.add(tableNode, RDF('type'), CSVW('Table'), graph);
  store.add(tableNode, RDF('type'), OWL('Class'), graph);
  store.add(tableNode, RDFS('label'), $rdf.lit(shape.caption), graph);
  store.add(tableNode, CSVW('tableSchema'), schema, graph);
  store.add(tableNode, MINERVA('tableName'), $rdf.lit(shape.tableName), graph);
  store.add(tableNode, MINERVA('relativePath'), $rdf.lit(shape.notePath), graph);
  store.add(tableNode, MINERVA('fromNote'), note, graph);
  store.add(tableNode, MINERVA('fromTable'), inNoteTable, graph);

  store.add(schema, RDF('type'), CSVW('Schema'), graph);
  for (const col of shape.columns) {
    const colUri = $rdf.sym(`${tableNode.value}/column/${encodeURIComponent(col.name)}`);
    const xsdType = xsdForDuckDbType(col.duckdbType);
    store.add(schema, CSVW('column'), colUri, graph);
    store.add(colUri, RDF('type'), CSVW('Column'), graph);
    store.add(colUri, RDF('type'), OWL('DatatypeProperty'), graph);
    store.add(colUri, CSVW('name'), $rdf.lit(col.name), graph);
    store.add(colUri, CSVW('columnIndex'), $rdf.lit(String(col.index), undefined, XSD('integer')), graph);
    store.add(colUri, CSVW('datatype'), xsdType, graph);
    store.add(colUri, RDFS('label'), $rdf.lit(col.name), graph);
    store.add(colUri, RDFS('domain'), tableNode, graph);
    store.add(colUri, RDFS('range'), xsdType, graph);
  }
}

/** Remove a markdown table's overlay triples (entire named graph). */
export function unindexMarkdownTable(ctx: ProjectContext, tableName: string): void {
  checkLLMWriteGuard('unindexMarkdownTable');
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  state.store.removeMatches(undefined, undefined, undefined, tableUri(state, tableName));
}

/**
 * Drop every markdown-table overlay's triples. Identifies them via
 * `minerva:fromNote` (unique to markdown overlays). Called at the start of a
 * full note-table rescan so overlays for notes deleted while the app was
 * closed don't persist.
 */
export function unindexAllNoteTables(ctx: ProjectContext): void {
  checkLLMWriteGuard('unindexAllNoteTables');
  removeTableGraphsBy(ctx, MINERVA('fromNote'));
}

/**
 * Wipe the named graph of every subject bearing `marker`. Shared by the CSV
 * and markdown full-rescan cleaners. Snapshots subjects first — rdflib's
 * statementsMatching returns a live view, so removing while iterating would
 * drop subsequent matches.
 */
function removeTableGraphsBy(ctx: ProjectContext, marker: ReturnType<typeof MINERVA>): void {
  const state = getState(ctx);
  if (!state) return;
  invalidate(state);
  const { store } = state;
  const subjects: $rdf.NamedNode[] = [];
  const seen = new Set<string>();
  for (const st of store.statementsMatching(undefined, marker, undefined)) {
    if (seen.has(st.subject.value)) continue;
    seen.add(st.subject.value);
    subjects.push(st.subject as $rdf.NamedNode);
  }
  for (const s of subjects) {
    store.removeMatches(undefined, undefined, undefined, s);
  }
}
