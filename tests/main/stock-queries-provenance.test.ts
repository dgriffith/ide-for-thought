/**
 * The provenance stock queries (#1161 — Versioning Job 2, "start with stock
 * queries"): "Provenance history for note" and "Recently decided proposals",
 * both queries over the approval-gate records that already exist rather than
 * a new versioning subsystem. Runs the shipped queries through the same
 * Comunica engine the app uses, against a small graph of Proposal nodes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { QueryEngine } from '@comunica/query-sparql-rdfjs';
import { Store, DataFactory as DF } from 'n3';
import { STOCK_QUERIES } from '../../src/shared/stock-queries';

const nn = (v: string) => DF.namedNode(v);
const lit = (v: string, datatype?: string) => (datatype ? DF.literal(v, DF.namedNode(datatype)) : DF.literal(v));
const q = (s: ReturnType<typeof nn>, p: ReturnType<typeof nn>, o: ReturnType<typeof nn> | ReturnType<typeof lit>) => DF.quad(s, p, o);
const M = (l: string) => nn(`https://minerva.dev/ontology#${l}`);
const T = (l: string) => nn(`https://minerva.dev/ontology/thought#${l}`);
const RDF_TYPE = nn('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime';

const queryByName = (name: string): string => {
  const s = STOCK_QUERIES.find((x) => x.name === name);
  if (!s) throw new Error(`stock query not found: ${name}`);
  return s.query;
};

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

/** claim.md gets two proposals: an approved note-rewrite, then a later
 *  rejected one. other.md gets an unrelated pending proposal, so it's
 *  excluded from both "affects claim.md" and "recently decided" queries. */
function store(): Store {
  const s = new Store();
  const claim = nn('https://ex/claim');
  s.addQuad(q(claim, RDF_TYPE, M('Note')));
  s.addQuad(q(claim, M('relativePath'), lit('claim.md')));

  const p1 = nn('https://ex/p1');
  s.addQuad(q(p1, RDF_TYPE, T('Proposal')));
  s.addQuad(q(p1, T('affectsNode'), claim));
  s.addQuad(q(p1, T('operationType'), lit('note_rewrite')));
  s.addQuad(q(p1, T('proposedBy'), lit('llm:claude-sonnet-5')));
  s.addQuad(q(p1, T('proposedAt'), lit('2026-01-01T00:00:00Z', XSD_DATETIME)));
  s.addQuad(q(p1, T('statusChangedAt'), lit('2026-01-01T01:00:00Z', XSD_DATETIME)));
  s.addQuad(q(p1, T('proposalStatus'), T('approved')));
  s.addQuad(q(p1, T('proposalNote'), lit('sharpen the claim')));

  const p2 = nn('https://ex/p2');
  s.addQuad(q(p2, RDF_TYPE, T('Proposal')));
  s.addQuad(q(p2, T('affectsNode'), claim));
  s.addQuad(q(p2, T('operationType'), lit('note_rewrite')));
  s.addQuad(q(p2, T('proposedBy'), lit('llm:claude-sonnet-5')));
  s.addQuad(q(p2, T('proposedAt'), lit('2026-02-01T00:00:00Z', XSD_DATETIME)));
  s.addQuad(q(p2, T('statusChangedAt'), lit('2026-02-01T01:00:00Z', XSD_DATETIME)));
  s.addQuad(q(p2, T('proposalStatus'), T('rejected')));
  s.addQuad(q(p2, T('proposalNote'), lit('walk it back')));

  // Unrelated note + a still-pending proposal — must not appear in either
  // query (pending has no statusChangedAt; it doesn't affect claim.md).
  const other = nn('https://ex/other');
  s.addQuad(q(other, RDF_TYPE, M('Note')));
  s.addQuad(q(other, M('relativePath'), lit('other.md')));
  const p3 = nn('https://ex/p3');
  s.addQuad(q(p3, RDF_TYPE, T('Proposal')));
  s.addQuad(q(p3, T('affectsNode'), other));
  s.addQuad(q(p3, T('operationType'), lit('new_claim')));
  s.addQuad(q(p3, T('proposedBy'), lit('llm:claude-sonnet-5')));
  s.addQuad(q(p3, T('proposedAt'), lit('2026-03-01T00:00:00Z', XSD_DATETIME)));
  s.addQuad(q(p3, T('proposalStatus'), T('pending')));

  return s;
}

describe('provenance stock queries (#1161)', () => {
  let data: Store;
  beforeAll(() => { data = store(); });

  it('"Provenance history for note" returns only proposals affecting the target, oldest first', async () => {
    const query = queryByName('Provenance history for note').replace('YOUR_NOTE.md', 'claim.md');
    const rows = await run(query, data);
    expect(rows.map((r) => r.note)).toEqual(['sharpen the claim', 'walk it back']);
    expect(rows.map((r) => r.status)).toEqual(['approved', 'rejected']);
    expect(rows[0]!.statusChangedAt).toBe('2026-01-01T01:00:00Z');
  });

  it('"Provenance history for note" finds nothing for an unrelated path', async () => {
    const query = queryByName('Provenance history for note').replace('YOUR_NOTE.md', 'no-such-note.md');
    expect(await run(query, data)).toEqual([]);
  });

  it('"Recently decided proposals" excludes pending, orders most-recently-decided first', async () => {
    const rows = await run(queryByName('Recently decided proposals'), data);
    expect(rows.map((r) => r.note)).toEqual(['walk it back', 'sharpen the claim']);
    expect(rows.map((r) => r.status)).toEqual(['rejected', 'approved']);
    expect(rows.map((r) => r.affectsPath)).toEqual(['claim.md', 'claim.md']);
  });
});
