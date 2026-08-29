import { describe, it, expect, beforeEach } from 'vitest';
import { indexNote, queryGraph } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('CSV file indexing (issue #199)', () => {
  const project = useGraphProject('minerva-csv-index-test-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = project.ctx;
  });

  it('emits the file as both a minerva:Note and a csvw:Table', async () => {
    await indexNote(ctx, 'data/metrics.csv', 'name,count\nalice,3\nbob,5\n');

    const { results } = await queryGraph(ctx, `
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
    await indexNote(ctx, 'data/m.csv', 'a,b\n1,2\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?p WHERE {
        ?t minerva:relativePath "data/m.csv" ;
           csvw:inFile ?p .
      }
    `);
    expect((results as Array<{ p: string }>)[0].p).toBe('data/m.csv');
  });

  it('emits one csvw:Column per header with its name + zero-based index', async () => {
    await indexNote(ctx, 'data/m.csv', 'name,count,tag\nalice,3,red\n');
    const { results } = await queryGraph(ctx, `
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

  it('does NOT emit per-cell csvw:Row / csvw:Cell triples (#337 — cell data is the SQL/DuckDB path)', async () => {
    // The old behaviour wrote one csvw:Cell per value (~4M triples on a big
    // CSV). #337 dropped that; only the Table + column schema remain.
    await indexNote(ctx, 'data/m.csv', 'name,count\nalice,3\nbob,5\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?x WHERE {
        { ?t minerva:relativePath "data/m.csv" ; csvw:row ?x }
        UNION
        { ?x a csvw:Cell }
      }
    `);
    expect(results).toEqual([]);
  });

  it('re-indexing a CSV replaces the old schema (no stale columns)', async () => {
    await indexNote(ctx, 'data/m.csv', 'name,count\nalice,3\nbob,5\n');
    await indexNote(ctx, 'data/m.csv', 'label,score,extra\ncarol,7,x\n');

    const { results } = await queryGraph(ctx, `
      SELECT ?name WHERE {
        ?t minerva:relativePath "data/m.csv" ;
           csvw:column ?c .
        ?c csvw:name ?name .
      } ORDER BY ?name
    `);
    const names = (results as Array<{ name: string }>).map((r) => r.name);
    expect(names).toEqual(['extra', 'label', 'score']); // old name/count columns gone
  });

  it('graph footprint is independent of row count (#337 perf intent)', async () => {
    // The whole point of #337: indexing a 3-row and a 3000-row CSV with the
    // same columns must produce the same number of graph triples. Re-adding
    // per-cell emission would make big.csv balloon and fail this.
    const csv = (n: number) =>
      'a,b\n' + Array.from({ length: n }, (_, i) => `r${i},${i}`).join('\n') + '\n';
    await indexNote(ctx, 'small.csv', csv(3));
    await indexNote(ctx, 'big.csv', csv(3000));

    const tripleCount = async (p: string) => {
      const { results } = await queryGraph(ctx, `
        SELECT (COUNT(*) AS ?n) WHERE {
          ?t minerva:relativePath "${p}" .
          GRAPH ?t { ?s ?pred ?o }
        }
      `);
      return Number((results as Array<{ n: string }>)[0].n);
    };
    expect(await tripleCount('big.csv')).toBe(await tripleCount('small.csv'));
  });

  it('uses the filename stem as dc:title', async () => {
    await indexNote(ctx, 'data/metrics.csv', 'a,b\n1,2\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?title WHERE {
        ?t minerva:relativePath "data/metrics.csv" ;
           dc:title ?title .
      }
    `);
    expect((results as Array<{ title: string }>)[0].title).toBe('metrics');
  });
});
