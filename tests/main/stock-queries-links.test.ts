/**
 * The link stock queries (Backlinks / Orphan / Most-linked) must count not just
 * the generic minerva:linksTo but every typed link declared a sub-property of
 * it (references / supports / rebuts / …). Runs the shipped queries through the
 * same Comunica engine the app uses, against a small graph of typed links plus
 * the ontology's subPropertyOf declarations (which the app loads into the store
 * via addOntologyToStore).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { QueryEngine } from '@comunica/query-sparql-rdfjs';
import { Store, DataFactory as DF } from 'n3';
import { STOCK_QUERIES } from '../../src/shared/stock-queries';

const nn = (v: string) => DF.namedNode(v);
const lit = (v: string) => DF.literal(v);
const q = (s: ReturnType<typeof nn>, p: ReturnType<typeof nn>, o: ReturnType<typeof nn> | ReturnType<typeof lit>) => DF.quad(s, p, o);
const M = (l: string) => nn(`https://minerva.dev/ontology#${l}`);
const DC = (l: string) => nn(`http://purl.org/dc/terms/${l}`);
const RDF_TYPE = nn('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const SUBPROP = nn('http://www.w3.org/2000/01/rdf-schema#subPropertyOf');

const queryByName = (name: string): string => {
  const s = STOCK_QUERIES.find((x) => x.name === name);
  if (!s) throw new Error(`stock query not found: ${name}`);
  return s.query;
};

/** a → b (references), a → c (supports), b → c (rebuts); d is isolated. */
function store(): Store {
  const s = new Store();
  // The ontology subPropertyOf triples the app loads via addOntologyToStore.
  for (const p of ['references', 'supports', 'rebuts']) {
    s.addQuad(q(M(p), SUBPROP, M('linksTo')));
  }
  const note = (uri: string, title: string, path: string) => {
    const n = nn(uri);
    s.addQuad(q(n, RDF_TYPE, M('Note')));
    s.addQuad(q(n, DC('title'), lit(title)));
    s.addQuad(q(n, M('relativePath'), lit(path)));
    return n;
  };
  const a = note('https://ex/a', 'A', 'a.md');
  const b = note('https://ex/b', 'B', 'b.md');
  const c = note('https://ex/c', 'C', 'c.md');
  note('https://ex/d', 'D', 'd.md'); // orphan: no links either way
  s.addQuad(q(a, M('references'), b));
  s.addQuad(q(a, M('supports'), c));
  s.addQuad(q(b, M('rebuts'), c));
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

describe('link stock queries follow subPropertyOf', () => {
  let data: Store;
  beforeAll(() => { data = store(); });

  it('"Backlinks to note" finds typed links (supports + rebuts) to c.md', async () => {
    const query = queryByName('Backlinks to note').replace('YOUR_NOTE.md', 'c.md');
    const rows = await run(query, data);
    expect(rows.map((r) => r.title).sort()).toEqual(['A', 'B']); // A via supports, B via rebuts
  });

  it('"Orphan notes" excludes notes that only have typed links, returns only the truly isolated', async () => {
    const rows = await run(queryByName('Orphan notes'), data);
    const titles = rows.map((r) => r.title);
    expect(titles).toEqual(['D']);
    expect(titles).not.toContain('A'); // A has outgoing typed links
    expect(titles).not.toContain('C'); // C has incoming typed links
  });

  it('"Most-linked notes" counts typed incoming links', async () => {
    const rows = await run(queryByName('Most-linked notes'), data);
    // C: 2 incoming (supports from A, rebuts from B); B: 1 (references from A).
    expect(rows[0].title).toBe('C');
    expect(rows[0].incomingLinks).toBe('2');
    const b = rows.find((r) => r.title === 'B');
    expect(b?.incomingLinks).toBe('1');
  });
});
