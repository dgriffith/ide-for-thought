import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph, indexNote, removeNote, indexSource, removeSource,
  indexExcerpt, removeExcerpt, indexCsvTable, unindexCsvTable,
  unindexAllCsvTables, parseIntoStore, queryGraph,
} from '../../../src/main/graph/index';

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-n3cache-'));
}

describe('queryGraph N3 store cache (#334)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTemp();
    await initGraph(root);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  // The cache itself is internal and not directly exposed. We test it
  // indirectly: every mutator must make the next query reflect the
  // mutation. If invalidation is missed for any mutator, queries return
  // a stale snapshot.

  it('indexNote → query reflects the note', async () => {
    await indexNote('a.md', '# Alpha\n');
    const r1 = await queryGraph(`SELECT ?t WHERE { ?n minerva:relativePath "a.md" ; dc:title ?t . }`);
    expect((r1.results as Array<{ t: string }>)[0].t).toBe('Alpha');
  });

  it('two queries in a row reuse the same cache (no error)', async () => {
    await indexNote('a.md', '# Alpha\n');
    const r1 = await queryGraph(`SELECT ?t WHERE { ?n minerva:relativePath "a.md" ; dc:title ?t . }`);
    const r2 = await queryGraph(`SELECT ?t WHERE { ?n minerva:relativePath "a.md" ; dc:title ?t . }`);
    expect(r1.results).toEqual(r2.results);
  });

  it('indexNote after a query reflects the new note (cache invalidated)', async () => {
    await indexNote('a.md', '# Alpha\n');
    await queryGraph(`SELECT ?t WHERE { ?n minerva:relativePath "a.md" ; dc:title ?t . }`);
    await indexNote('b.md', '# Beta\n');
    const r = await queryGraph(`SELECT ?t WHERE { ?n minerva:relativePath "b.md" ; dc:title ?t . }`);
    expect((r.results as Array<{ t: string }>)[0].t).toBe('Beta');
  });

  it('removeNote after a query removes from results', async () => {
    await indexNote('a.md', '# Alpha\n');
    await queryGraph(`SELECT ?t WHERE { ?n minerva:relativePath "a.md" ; dc:title ?t . }`);
    removeNote('a.md');
    const r = await queryGraph(`SELECT ?t WHERE { ?n minerva:relativePath "a.md" ; dc:title ?t . }`);
    expect(r.results).toEqual([]);
  });

  it('indexSource after a query reflects the source', async () => {
    await queryGraph('SELECT ?s WHERE { ?s a minerva:Note }'); // warm the cache
    indexSource('foo', 'this: a thought:Source ; dc:title "T" .\n');
    const r = await queryGraph(`SELECT ?id WHERE { ?s minerva:sourceId ?id . }`);
    const ids = (r.results as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain('foo');
  });

  it('removeSource invalidates the cache', async () => {
    indexSource('foo', 'this: a thought:Source ; dc:title "T" .\n');
    await queryGraph(`SELECT ?id WHERE { ?s minerva:sourceId ?id . }`);
    removeSource('foo');
    const r = await queryGraph(`SELECT ?id WHERE { ?s minerva:sourceId ?id . }`);
    expect(r.results).toEqual([]);
  });

  it('indexExcerpt invalidates the cache', async () => {
    indexSource('foo', 'this: a thought:Source ; dc:title "T" .\n');
    await queryGraph(`SELECT ?id WHERE { ?s minerva:sourceId ?id . }`);
    indexExcerpt('ex-1', 'this: a thought:Excerpt ; thought:fromSource sources:foo .\n');
    const r = await queryGraph(`SELECT ?eid WHERE { ?e minerva:excerptId ?eid . }`);
    const ids = (r.results as Array<{ eid: string }>).map((x) => x.eid);
    expect(ids).toContain('ex-1');
  });

  it('removeExcerpt invalidates the cache', async () => {
    indexExcerpt('ex-1', 'this: a thought:Excerpt .\n');
    await queryGraph(`SELECT ?eid WHERE { ?e minerva:excerptId ?eid . }`);
    removeExcerpt('ex-1');
    const r = await queryGraph(`SELECT ?eid WHERE { ?e minerva:excerptId ?eid . }`);
    expect(r.results).toEqual([]);
  });

  it('indexCsvTable invalidates the cache', async () => {
    await queryGraph('SELECT ?s WHERE { ?s a csvw:Table }'); // warm
    indexCsvTable({
      tableName: 't',
      relativePath: 't.csv',
      columns: [{ name: 'a', duckdbType: 'VARCHAR', index: 0 }],
    });
    const r = await queryGraph(`SELECT ?n WHERE { ?t minerva:tableName ?n . }`);
    const names = (r.results as Array<{ n: string }>).map((x) => x.n);
    expect(names).toContain('t');
  });

  it('unindexCsvTable invalidates the cache', async () => {
    indexCsvTable({
      tableName: 't',
      relativePath: 't.csv',
      columns: [{ name: 'a', duckdbType: 'VARCHAR', index: 0 }],
    });
    await queryGraph(`SELECT ?n WHERE { ?t minerva:tableName ?n . }`);
    unindexCsvTable('t');
    const r = await queryGraph(`SELECT ?n WHERE { ?t minerva:tableName ?n . }`);
    expect(r.results).toEqual([]);
  });

  it('unindexAllCsvTables invalidates the cache', async () => {
    indexCsvTable({ tableName: 'x', relativePath: 'x.csv', columns: [] });
    indexCsvTable({ tableName: 'y', relativePath: 'y.csv', columns: [] });
    await queryGraph(`SELECT ?n WHERE { ?t minerva:tableName ?n . }`);
    unindexAllCsvTables();
    const r = await queryGraph(`SELECT ?n WHERE { ?t minerva:tableName ?n . }`);
    expect(r.results).toEqual([]);
  });

  it('parseIntoStore invalidates the cache', async () => {
    await queryGraph('SELECT ?s WHERE { ?s a thought:Proposal }'); // warm
    parseIntoStore(`@prefix thought: <https://minerva.dev/ontology/thought#> .
@prefix ex: <https://example.com/> .
ex:p1 a thought:Proposal ; thought:hasStatus thought:pending .`);
    const r = await queryGraph(`SELECT ?p WHERE { ?p a thought:Proposal . }`);
    expect(r.results.length).toBeGreaterThan(0);
  });
});
