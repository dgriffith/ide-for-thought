/**
 * Executes the verification stock queries (#414–#417 follow-up) through the
 * same SPARQL engine the app uses (Comunica over an N3 store) against a small
 * claim graph, so a syntax slip or a wrong predicate is caught here rather than
 * in the Query Panel.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { QueryEngine } from '@comunica/query-sparql-rdfjs';
import { Store, DataFactory as DF } from 'n3';
import { STOCK_QUERIES } from '../../src/shared/stock-queries';

const namedNode = (v: string) => DF.namedNode(v);
const literal = (v: string, dt?: ReturnType<typeof DF.namedNode>) => DF.literal(v, dt);
const quad = (s: ReturnType<typeof DF.namedNode>, p: ReturnType<typeof DF.namedNode>, o: ReturnType<typeof DF.namedNode> | ReturnType<typeof DF.literal>) => DF.quad(s, p, o);
const T = (l: string) => namedNode(`https://minerva.dev/ontology/thought#${l}`);
const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const XSD_DATE = namedNode('http://www.w3.org/2001/XMLSchema#date');

const queryByName = (name: string): string => {
  const q = STOCK_QUERIES.find((s) => s.name === name);
  if (!q) throw new Error(`stock query not found: ${name}`);
  return q.query;
};

function store(): Store {
  const s = new Store();
  const c1 = namedNode('https://ex/claim/old'); // checked long ago, contested
  const c2 = namedNode('https://ex/claim/recent'); // checked recently, decayed
  const c3 = namedNode('https://ex/claim/plain'); // a claim with no verdict
  s.addQuad(quad(c1, RDF_TYPE, T('Claim')));
  s.addQuad(quad(c1, T('label'), literal('Coffee cures scurvy')));
  s.addQuad(quad(c1, T('verificationStatus'), literal('contested')));
  s.addQuad(quad(c1, T('asOfDate'), literal('2019-03-01', XSD_DATE)));
  s.addQuad(quad(c2, RDF_TYPE, T('Claim')));
  s.addQuad(quad(c2, T('label'), literal('The capital is Bonn')));
  s.addQuad(quad(c2, T('currencyStatus'), literal('decayed')));
  s.addQuad(quad(c2, T('asOfDate'), literal('2024-09-01', XSD_DATE)));
  s.addQuad(quad(c3, RDF_TYPE, T('Claim')));
  s.addQuad(quad(c3, T('label'), literal('Plain unaudited claim')));
  return s;
}

async function run(query: string, src: Store): Promise<Record<string, string>[]> {
  const engine = new QueryEngine();
  const stream = await engine.queryBindings(query, { sources: [src] });
  const bindings = await stream.toArray();
  return bindings.map((b) => {
    const row: Record<string, string> = {};
    for (const [k, v] of b) row[k.value] = v.value;
    return row;
  });
}

describe('verification stock queries', () => {
  let data: Store;
  beforeAll(() => { data = store(); });

  it('"due for a currency re-check" returns only claims checked before the cutoff', async () => {
    const rows = await run(queryByName('Claims: due for a currency re-check (decay sweep)'), data);
    // Cutoff in the shipped query is 2021-06-01: c1 (2019) qualifies, c2 (2024) does not.
    expect(rows.map((r) => r.label)).toEqual(['Coffee cures scurvy']);
    expect(rows[0].asOf).toContain('2019-03-01');
  });

  it('"verification verdicts" lists every claim carrying a verdict, excludes unaudited ones', async () => {
    const rows = await run(queryByName('Claims: verification verdicts'), data);
    const labels = rows.map((r) => r.label).sort();
    expect(labels).toEqual(['Coffee cures scurvy', 'The capital is Bonn']);
    expect(rows.find((r) => r.label === 'Coffee cures scurvy')?.verification).toBe('contested');
    expect(rows.find((r) => r.label === 'The capital is Bonn')?.currency).toBe('decayed');
  });
});
