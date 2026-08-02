/**
 * Non-markdown note file-type indexers (#1624 — split by format out of
 * indexers.ts). Each takes the note's already-resolved `subject`/`graph` from
 * `indexNote` and emits its per-type triples:
 *   - `.py`  → a `minerva:PythonModule` (rdfs:subClassOf minerva:Note);
 *   - `.ttl` → note metadata + the file parsed as Turtle into its named graph;
 *   - `.csv` → note metadata + a CSVW `Table` with a column schema (#199).
 */
import * as $rdf from 'rdflib';
import path from 'node:path';
import {
  RDF, MINERVA, DC, CSVW, XSD,
  folderUri, projectUri, dateLit,
  type GraphState,
} from '../state';
import { parseCsv } from '../../../shared/csv-parse';
import { fileMtimeIso, injectPrefixes, ensureFolder } from '../index-helpers';

/** Common note metadata (type / title / filename / path / mtime / folder /
 *  project) for a non-markdown file whose title derives from `basename(ext)`. */
function addFileNoteMetadata(
  state: GraphState,
  relativePath: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
  ext: string,
): void {
  const { store } = state;
  store.add(subject, RDF('type'), MINERVA('Note'), graph);
  store.add(subject, DC('title'), $rdf.lit(path.basename(relativePath, ext)), graph);
  store.add(subject, MINERVA('filename'), $rdf.lit(path.basename(relativePath)), graph);
  store.add(subject, MINERVA('relativePath'), $rdf.lit(relativePath), graph);
  store.add(subject, DC('modified'), dateLit(fileMtimeIso(state, relativePath)), graph);
  const dir = path.dirname(relativePath);
  if (dir && dir !== '.') {
    store.add(subject, MINERVA('inFolder'), folderUri(state, dir), graph);
    ensureFolder(state, dir);
  }
  store.add(projectUri(state), MINERVA('containsNote'), subject, graph);
}

/**
 * Index a `.py` file as a `minerva:PythonModule` — metadata only. What a module
 * exposes is answered by running it (the kernel is the source of truth), not by
 * AST parsing. `minerva:PythonModule rdfs:subClassOf minerva:Note`, so "list
 * every note" queries pick these up too.
 */
export function indexPythonFile(
  state: GraphState,
  relativePath: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  addFileNoteMetadata(state, relativePath, subject, graph, '.py');
  state.store.add(subject, RDF('type'), MINERVA('PythonModule'), graph);
}

export function indexTurtleFile(
  state: GraphState,
  relativePath: string,
  content: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  addFileNoteMetadata(state, relativePath, subject, graph, '.ttl');

  // Parse the entire file as Turtle into the note's named graph.
  try {
    const prefixed = injectPrefixes(state, content, subject.value);
    $rdf.parse(prefixed, state.store, graph.value, 'text/turtle');
  } catch (e) {
    console.error(`[minerva] Failed to parse turtle file ${relativePath}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Index a standalone `.csv` file (#199). Note-metadata setup, then the file's
 * subject IS the Table (`rdf:type csvw:Table`), with `csvw:inFile <relativePath>`
 * for symmetry with the markdown-table indexer's `csvw:inNote`.
 */
export function indexCsvFile(
  state: GraphState,
  relativePath: string,
  content: string,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
): void {
  const { store } = state;
  addFileNoteMetadata(state, relativePath, subject, graph, '.csv');

  // CSVW: the file IS the Table. One file → one table.
  store.add(subject, RDF('type'), CSVW('Table'), graph);
  store.add(subject, CSVW('inFile'), $rdf.lit(relativePath), graph);

  const parsed = parseCsv(content);
  if (parsed.headers.length === 0) return;

  // Columns only — the table's schema (header name + zero-based index). We do
  // NOT emit per-cell `csvw:Cell`/`csvw:Row` triples (#337): a 10k×100 CSV made
  // ~4M triples and nothing queried cell *values* over the graph — that's the
  // DuckDB/SQL path's job (`indexCsvTable`, joinable via `minerva:fromFile`).
  for (let ci = 0; ci < parsed.headers.length; ci++) {
    const colName = parsed.headers[ci]!;
    const colUri = $rdf.sym(`${subject.value}/column/${encodeURIComponent(colName)}`);
    store.add(colUri, RDF('type'), CSVW('Column'), graph);
    store.add(colUri, CSVW('name'), $rdf.lit(colName), graph);
    store.add(colUri, CSVW('columnIndex'), $rdf.lit(String(ci), undefined, XSD('integer')), graph);
    store.add(subject, CSVW('column'), colUri, graph);
  }
}
