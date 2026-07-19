import { describe, it, expect, beforeEach } from 'vitest';
import {
  indexMarkdownTable,
  unindexMarkdownTable,
  unindexAllNoteTables,
  indexCsvTable,
  unindexAllCsvTables,
  indexNote,
  queryGraph,
} from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('indexMarkdownTable — graph parity overlay (#1360)', () => {
  const project = useGraphProject('minerva-md-table-test-');
  let ctx: ProjectContext;
  beforeEach(() => { ctx = project.ctx; });

  function indexBarzoom() {
    indexMarkdownTable(ctx, {
      tableName: 'barzoom',
      notePath: 'notes/report.md',
      tableIndex: 0,
      caption: 'Barzoom',
      columns: [
        { name: 'foo', duckdbType: 'INTEGER', index: 0 },
        { name: 'bar', duckdbType: 'VARCHAR', index: 1 },
      ],
    });
  }

  it('emits csvw:Table + owl:Class labelled by the caption', async () => {
    indexBarzoom();
    const { results } = await queryGraph(ctx, `
      SELECT ?type ?label WHERE {
        ?t minerva:tableName "barzoom" ;
           rdfs:label ?label ;
           a ?type .
      }
    `);
    const rows = results as Array<{ type: string; label: string }>;
    expect(rows.map((r) => r.type)).toContain('http://www.w3.org/ns/csvw#Table');
    expect(rows.map((r) => r.type)).toContain('http://www.w3.org/2002/07/owl#Class');
    expect(rows[0]!.label).toBe('Barzoom');
  });

  it('joins back to the source note and the in-note table node', async () => {
    indexBarzoom();
    const { results } = await queryGraph(ctx, `
      SELECT ?note ?tbl WHERE {
        ?t minerva:tableName "barzoom" ;
           minerva:fromNote ?note ;
           minerva:fromTable ?tbl .
      }
    `);
    const rows = results as Array<{ note: string; tbl: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toContain('notes/report'); // noteUri strips the .md
    expect(rows[0]!.tbl).toContain('/table/0');
  });

  it('types each column as owl:DatatypeProperty with an xsd range', async () => {
    indexBarzoom();
    const { results } = await queryGraph(ctx, `
      SELECT ?name ?range WHERE {
        ?t minerva:tableName "barzoom" ;
           csvw:tableSchema ?s .
        ?s csvw:column ?c .
        ?c a owl:DatatypeProperty ; csvw:name ?name ; rdfs:range ?range .
      } ORDER BY ?name
    `);
    const rows = results as Array<{ name: string; range: string }>;
    const foo = rows.find((r) => r.name === 'foo')!;
    expect(foo.range).toBe('http://www.w3.org/2001/XMLSchema#integer');
  });

  it('the CSV rescan wipe leaves markdown overlays intact (and vice versa)', async () => {
    indexBarzoom();
    indexCsvTable(ctx, {
      tableName: 'sales',
      relativePath: 'sales.csv',
      columns: [{ name: 'x', duckdbType: 'INTEGER', index: 0 }],
    });

    // Wiping CSV overlays must not touch the markdown one.
    unindexAllCsvTables(ctx);
    let r = await queryGraph(ctx, `SELECT ?t WHERE { ?t minerva:tableName "barzoom" }`);
    expect(r.results).toHaveLength(1);
    r = await queryGraph(ctx, `SELECT ?t WHERE { ?t minerva:tableName "sales" }`);
    expect(r.results).toHaveLength(0);

    // And wiping note overlays must not touch a CSV one.
    indexCsvTable(ctx, {
      tableName: 'sales',
      relativePath: 'sales.csv',
      columns: [{ name: 'x', duckdbType: 'INTEGER', index: 0 }],
    });
    unindexAllNoteTables(ctx);
    r = await queryGraph(ctx, `SELECT ?t WHERE { ?t minerva:tableName "barzoom" }`);
    expect(r.results).toHaveLength(0);
    r = await queryGraph(ctx, `SELECT ?t WHERE { ?t minerva:tableName "sales" }`);
    expect(r.results).toHaveLength(1);
  });

  it('unindexMarkdownTable removes a single overlay', async () => {
    indexBarzoom();
    unindexMarkdownTable(ctx, 'barzoom');
    const r = await queryGraph(ctx, `SELECT ?t WHERE { ?t minerva:tableName "barzoom" }`);
    expect(r.results).toHaveLength(0);
  });

  it('labels the in-note CSVW node with the caption (via indexNote)', async () => {
    await indexNote(ctx, 'notes/report.md', 'Table: Barzoom\n| Foo | Bar |\n|-----|-----|\n| 1 | 2 |');
    const { results } = await queryGraph(ctx, `
      SELECT ?label WHERE {
        ?t a csvw:Table ; csvw:inNote ?n ; rdfs:label ?label .
      }
    `);
    expect((results as Array<{ label: string }>).map((r) => r.label)).toContain('Barzoom');
  });
});
