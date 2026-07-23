import { dialog } from 'electron';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import * as tables from '../sources/tables';
import type { QueryResult, TableInfo } from '../sources/tables';
import * as healthChecks from '../graph/health-checks';
import type { Inspection } from '../graph/health-checks';
import { withRootPath, withRootPathOr } from './helpers';

export function registerGraph(): void {
  // Graph
  handle(Channels.GRAPH_QUERY, withRootPath((rootPath, sparql: string) =>
    graph.queryGraph(projectContext(rootPath), sparql)));

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
