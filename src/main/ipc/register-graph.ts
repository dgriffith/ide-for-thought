import { dialog } from 'electron';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import * as graph from '../graph/index';
import * as search from '../search/index';
import { projectContext } from '../project-context-types';
import * as tables from '../sources/tables';
import type { QueryResult, TableInfo } from '../sources/tables';
import * as healthChecks from '../graph/health-checks';
import type { Inspection } from '../graph/health-checks';
import { patchProjectConfig, readProjectConfig } from '../project-config';
import { checkRebase } from '../graph/rebase-guard';
import { withRootPath, withRootPathOr, withRootPathWin } from './helpers';

export function registerGraph(): void {
  // Graph
  handle(Channels.GRAPH_QUERY, withRootPath((rootPath, sparql: string) =>
    graph.queryGraph(projectContext(rootPath), sparql)));

  // Rebase the graph to a new base IRI (#1443 Part B). No in-place triple
  // rewriting: persist the new base, point the live state at it, then rebuild
  // every index from the files (indexAllNotes) so all IRIs regenerate. Proposals
  // aren't file-derived, so their base-prefixed IRIs + payload turtle are
  // rewritten old→new during the rebuild (indexAllNotes `rebaseFrom`) — no need
  // to refuse while the review queue is non-empty.
  handle(Channels.GRAPH_SET_BASE_URI, withRootPathWin(async (rootPath, win, rawUri: string) => {
    const ctx = projectContext(rootPath);
    const check = checkRebase(rawUri);
    if (!check.ok) return check;
    const oldBase = readProjectConfig(rootPath).baseUri;
    patchProjectConfig(rootPath, { baseUri: check.uri });
    graph.setBaseUri(ctx, check.uri);
    // Same rebuild sequence as "Rebuild All Indexes" (menu.ts) — CSVs after the
    // store reset so their schema triples survive; note tables last (#1358).
    await Promise.all([
      graph.indexAllNotes(ctx, oldBase ? { rebaseFrom: oldBase } : undefined),
      search.indexAllNotes(ctx),
    ]);
    await tables.registerAllCsvs(ctx);
    await tables.registerAllNoteTables(ctx);
    if (win && !win.isDestroyed()) win.webContents.send(Channels.TABLES_CHANGED);
    return { ok: true as const };
  }));

  // Tables (DuckDB)
  handle(Channels.TABLES_QUERY, withRootPathOr<[string], QueryResult | Promise<QueryResult>>({ ok: false, error: 'No project open' }, (rootPath, sql: string) =>
    tables.runQuery(projectContext(rootPath), sql)));

  handle(Channels.TABLES_LIST, withRootPathOr<[], TableInfo[] | Promise<TableInfo[]>>([], (rootPath) =>
    tables.listTables(projectContext(rootPath))));

  handle(Channels.GRAPH_SCHEMA_FOR_COMPLETION, withRootPathOr(null, (rootPath) =>
    graph.schemaForCompletion(projectContext(rootPath))));

  handle(Channels.GRAPH_SOURCE_DETAIL, withRootPathOr(null, (rootPath, sourceId: string) =>
    graph.getSourceDetail(projectContext(rootPath), sourceId)));

  handle(Channels.GRAPH_EXCERPT_SOURCE, withRootPathOr(null, (rootPath, excerptId: string) =>
    graph.getExcerptSource(projectContext(rootPath), excerptId)));

  handle(Channels.GRAPH_ALIAS_MAP, withRootPathOr({}, (rootPath) =>
    graph.getAliasMap(projectContext(rootPath))));

  handle(Channels.GRAPH_ALIAS_ENTRIES, withRootPathOr([], (rootPath) =>
    graph.getAliasEntries(projectContext(rootPath))));

  handle(Channels.GRAPH_FRONTMATTER_KEYS, withRootPathOr([], (rootPath) =>
    graph.getAllFrontmatterKeys(projectContext(rootPath))));

  // Inspections
  handle(Channels.INSPECTIONS_LIST, withRootPathOr([], (rootPath) =>
    healthChecks.getInspections(projectContext(rootPath))));
  handle(Channels.INSPECTIONS_RUN, withRootPathOr<[], Inspection[] | Promise<Inspection[]>>([], (rootPath) =>
    healthChecks.runAllChecks(projectContext(rootPath))));

  // Grounding check — fuzzy match a claim against graph labels
  handle(Channels.GRAPH_GROUND_CHECK, withRootPathOr<[string], { node: string; label: string; type: string }[] | Promise<{ node: string; label: string; type: string }[]>>([], async (rootPath, claimText: string) => {
    const escaped = claimText.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const results = await graph.queryGraph(projectContext(rootPath), `
      PREFIX dc: <http://purl.org/dc/terms/>
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      PREFIX minerva: <https://minerva.dev/ontology#>
      SELECT ?node ?label ?type WHERE {
        { ?node dc:title ?label . ?node a minerva:Note . BIND("note" AS ?type) }
        UNION
        { ?node thought:label ?label . ?node a ?cls . ?cls rdfs:subClassOf thought:Component . BIND("component" AS ?type) }
        FILTER(CONTAINS(LCASE(?label), LCASE("${escaped}")))
      } LIMIT 5
    `);
    // The SELECT projects exactly ?node ?label ?type — narrow the generic
    // row shape to the typed contract the renderer consumes.
    return results.results as { node: string; label: string; type: string }[];
  }));

  // Graph management
  handle(Channels.GRAPH_EXPORT, withRootPathOr(undefined, async (rootPath) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Graph',
      defaultPath: 'graph.ttl',
      filters: [{ name: 'Turtle', extensions: ['ttl'] }],
    });
    if (!result.canceled && result.filePath) {
      await graph.persistGraph(projectContext(rootPath));
      const fs = await import('node:fs/promises');
      const srcPath = path.join(rootPath, '.minerva', 'graph.ttl');
      await fs.copyFile(srcPath, result.filePath);
    }
  }));
}
