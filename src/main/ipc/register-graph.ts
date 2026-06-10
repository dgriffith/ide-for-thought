import { ipcMain, dialog } from 'electron';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import * as tables from '../sources/tables';
import * as healthChecks from '../graph/health-checks';
import { rootPathFromEvent } from './helpers';

export function registerGraph(): void {
  // Graph
  ipcMain.handle(Channels.GRAPH_QUERY, async (e, sparql: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return graph.queryGraph(projectContext(rootPath), sparql);
  });

  // Tables (DuckDB)
  ipcMain.handle(Channels.TABLES_QUERY, async (e, sql: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { ok: false, error: 'No project open' };
    return tables.runQuery(projectContext(rootPath), sql);
  });

  ipcMain.handle(Channels.TABLES_LIST, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return tables.listTables(projectContext(rootPath));
  });

  ipcMain.handle(Channels.GRAPH_SCHEMA_FOR_COMPLETION, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    return graph.schemaForCompletion(projectContext(rootPath));
  });

  ipcMain.handle(Channels.GRAPH_SOURCE_DETAIL, (e, sourceId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    return graph.getSourceDetail(projectContext(rootPath), sourceId);
  });

  ipcMain.handle(Channels.GRAPH_EXCERPT_SOURCE, (e, excerptId: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    return graph.getExcerptSource(projectContext(rootPath), excerptId);
  });

  ipcMain.handle(Channels.GRAPH_ALIAS_MAP, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return {};
    return graph.getAliasMap(projectContext(rootPath));
  });

  ipcMain.handle(Channels.GRAPH_ALIAS_ENTRIES, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.getAliasEntries(projectContext(rootPath));
  });

  ipcMain.handle(Channels.GRAPH_FRONTMATTER_KEYS, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.getAllFrontmatterKeys(projectContext(rootPath));
  });

  // Inspections
  ipcMain.handle(Channels.INSPECTIONS_LIST, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return healthChecks.getInspections(projectContext(rootPath));
  });
  ipcMain.handle(Channels.INSPECTIONS_RUN, (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return healthChecks.runAllChecks(projectContext(rootPath));
  });

  // Grounding check — fuzzy match a claim against graph labels
  ipcMain.handle(Channels.GRAPH_GROUND_CHECK, async (e, claimText: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
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
    return results.results;
  });

  // Graph management
  ipcMain.handle(Channels.GRAPH_EXPORT, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
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
  });
}
