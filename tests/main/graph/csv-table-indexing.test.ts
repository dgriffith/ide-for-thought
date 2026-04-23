import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexCsvTable, unindexCsvTable, unindexAllCsvTables, queryGraph } from '../../../src/main/graph/index';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-csv-table-test-'));
}

describe('indexCsvTable — DuckDB table shape in the graph', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('emits the table as csvw:Table and owl:Class', async () => {
    indexCsvTable({
      tableName: 'experiments',
      relativePath: 'data/experiments.csv',
      columns: [
        { name: 'id', duckdbType: 'INTEGER', index: 0 },
        { name: 'name', duckdbType: 'VARCHAR', index: 1 },
      ],
    });
    const { results } = await queryGraph(`
      SELECT ?type WHERE {
        ?t minerva:tableName "experiments" ;
           a ?type .
      }
    `);
    const types = (results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('http://www.w3.org/ns/csvw#Table');
    expect(types).toContain('http://www.w3.org/2002/07/owl#Class');
  });

  it('exposes each column as csvw:Column + owl:DatatypeProperty with domain and xsd range', async () => {
    indexCsvTable({
      tableName: 'experiments',
      relativePath: 'data/experiments.csv',
      columns: [
        { name: 'id', duckdbType: 'INTEGER', index: 0 },
        { name: 'value', duckdbType: 'DOUBLE', index: 1 },
      ],
    });
    const { results } = await queryGraph(`
      SELECT ?name ?range ?domain WHERE {
        ?t minerva:tableName "experiments" ;
           csvw:tableSchema ?s .
        ?s csvw:column ?c .
        ?c a owl:DatatypeProperty ;
           csvw:name ?name ;
           rdfs:range ?range ;
           rdfs:domain ?domain .
      } ORDER BY ?name
    `);
    const rows = results as Array<{ name: string; range: string; domain: string }>;
    expect(rows.length).toBe(2);
    const id = rows.find((r) => r.name === 'id')!;
    const value = rows.find((r) => r.name === 'value')!;
    expect(id.range).toBe('http://www.w3.org/2001/XMLSchema#integer');
    expect(value.range).toBe('http://www.w3.org/2001/XMLSchema#double');
    // domain points at the table subject
    expect(id.domain).toBe(value.domain);
    expect(id.domain).toContain('/table/experiments');
  });

  it('maps TIMESTAMP and BOOLEAN columns to xsd:dateTime and xsd:boolean', async () => {
    indexCsvTable({
      tableName: 'events',
      relativePath: 'events.csv',
      columns: [
        { name: 'at', duckdbType: 'TIMESTAMP', index: 0 },
        { name: 'ok', duckdbType: 'BOOLEAN', index: 1 },
      ],
    });
    const { results } = await queryGraph(`
      SELECT ?name ?range WHERE {
        ?t minerva:tableName "events" ;
           csvw:tableSchema ?s .
        ?s csvw:column ?c .
        ?c csvw:name ?name ; rdfs:range ?range .
      } ORDER BY ?name
    `);
    const rows = results as Array<{ name: string; range: string }>;
    const at = rows.find((r) => r.name === 'at')!;
    const ok = rows.find((r) => r.name === 'ok')!;
    expect(at.range).toBe('http://www.w3.org/2001/XMLSchema#dateTime');
    expect(ok.range).toBe('http://www.w3.org/2001/XMLSchema#boolean');
  });

  it('re-indexing the same table replaces the old triples (no stale columns)', async () => {
    indexCsvTable({
      tableName: 't',
      relativePath: 't.csv',
      columns: [
        { name: 'a', duckdbType: 'INTEGER', index: 0 },
        { name: 'b', duckdbType: 'INTEGER', index: 1 },
      ],
    });
    indexCsvTable({
      tableName: 't',
      relativePath: 't.csv',
      columns: [
        { name: 'c', duckdbType: 'VARCHAR', index: 0 },
      ],
    });
    const { results } = await queryGraph(`
      SELECT ?name WHERE {
        ?t minerva:tableName "t" ;
           csvw:tableSchema ?s .
        ?s csvw:column ?c .
        ?c csvw:name ?name .
      }
    `);
    const names = (results as Array<{ name: string }>).map((r) => r.name);
    expect(names).toEqual(['c']);
  });

  it('unindexCsvTable drops every triple for that table', async () => {
    indexCsvTable({
      tableName: 't',
      relativePath: 't.csv',
      columns: [{ name: 'a', duckdbType: 'VARCHAR', index: 0 }],
    });
    unindexCsvTable('t');
    const { results } = await queryGraph(`
      SELECT ?s WHERE { ?s minerva:tableName "t" . }
    `);
    expect(results).toEqual([]);
  });

  it('unindexAllCsvTables drops only CSV-registered tables, not markdown csvw:Tables', async () => {
    indexCsvTable({
      tableName: 'x',
      relativePath: 'x.csv',
      columns: [{ name: 'a', duckdbType: 'VARCHAR', index: 0 }],
    });
    indexCsvTable({
      tableName: 'y',
      relativePath: 'y.csv',
      columns: [{ name: 'a', duckdbType: 'VARCHAR', index: 0 }],
    });
    unindexAllCsvTables();
    const { results } = await queryGraph(`
      SELECT ?s WHERE { ?s minerva:tableName ?n . }
    `);
    expect(results).toEqual([]);
  });

  it('links the SQL-table view back to the CSV file via minerva:fromFile', async () => {
    indexCsvTable({
      tableName: 'experiments',
      relativePath: 'data/experiments.csv',
      columns: [{ name: 'id', duckdbType: 'INTEGER', index: 0 }],
    });
    const { results } = await queryGraph(`
      SELECT ?file WHERE {
        ?t minerva:tableName "experiments" ;
           minerva:fromFile ?file .
      }
    `);
    const rows = results as Array<{ file: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].file).toContain('/note/data/experiments.csv');
  });
});
