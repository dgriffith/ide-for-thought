import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-csv-index-test-'));
}

describe('CSV file indexing (issue #199)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('emits the file as both a minerva:Note and a csvw:Table', async () => {
    await indexNote('data/metrics.csv', 'name,count\nalice,3\nbob,5\n');

    const { results } = await queryGraph(`
      SELECT ?path ?type WHERE {
        ?t minerva:relativePath "data/metrics.csv" ;
           minerva:relativePath ?path ;
           a ?type .
      }
    `);
    const types = (results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('https://minerva.dev/ontology#Note');
    expect(types).toContain('http://www.w3.org/ns/csvw#Table');
  });

  it('records csvw:inFile with the relative path as a literal', async () => {
    await indexNote('data/m.csv', 'a,b\n1,2\n');
    const { results } = await queryGraph(`
      SELECT ?p WHERE {
        ?t minerva:relativePath "data/m.csv" ;
           csvw:inFile ?p .
      }
    `);
    expect((results as Array<{ p: string }>)[0].p).toBe('data/m.csv');
  });

  it('emits one csvw:Column per header with its name + zero-based index', async () => {
    await indexNote('data/m.csv', 'name,count,tag\nalice,3,red\n');
    const { results } = await queryGraph(`
      SELECT ?name ?idx WHERE {
        ?t minerva:relativePath "data/m.csv" ;
           csvw:column ?c .
        ?c csvw:name ?name ;
           csvw:columnIndex ?idx .
      } ORDER BY ?idx
    `);
    const rows = results as Array<{ name: string; idx: string }>;
    expect(rows).toEqual([
      { name: 'name', idx: '0' },
      { name: 'count', idx: '1' },
      { name: 'tag', idx: '2' },
    ]);
  });

  it('emits one csvw:Row per data row with cells keyed to columns', async () => {
    await indexNote('data/m.csv', 'name,count\nalice,3\nbob,5\n');
    const { results } = await queryGraph(`
      SELECT ?name ?count WHERE {
        ?t minerva:relativePath "data/m.csv" ;
           csvw:row ?r .
        ?r csvw:cell ?cellName, ?cellCount .
        ?cellName  csvw:column ?colName  . ?colName  csvw:name "name"  . ?cellName  rdf:value ?name  .
        ?cellCount csvw:column ?colCount . ?colCount csvw:name "count" . ?cellCount rdf:value ?count .
      } ORDER BY ?name
    `);
    expect(results).toEqual([
      { name: 'alice', count: '3' },
      { name: 'bob', count: '5' },
    ]);
  });

  it('re-indexing a CSV replaces the old triples (no stale rows)', async () => {
    await indexNote('data/m.csv', 'name,count\nalice,3\nbob,5\n');
    await indexNote('data/m.csv', 'name,count\ncarol,7\n');

    const { results } = await queryGraph(`
      SELECT ?name WHERE {
        ?t minerva:relativePath "data/m.csv" ;
           csvw:row ?r .
        ?r csvw:cell ?c .
        ?c csvw:column ?col . ?col csvw:name "name" . ?c rdf:value ?name .
      }
    `);
    const names = (results as Array<{ name: string }>).map((r) => r.name);
    expect(names).toEqual(['carol']);
  });

  it('uses the filename stem as dc:title', async () => {
    await indexNote('data/metrics.csv', 'a,b\n1,2\n');
    const { results } = await queryGraph(`
      SELECT ?title WHERE {
        ?t minerva:relativePath "data/metrics.csv" ;
           dc:title ?title .
      }
    `);
    expect((results as Array<{ title: string }>)[0].title).toBe('metrics');
  });
});
