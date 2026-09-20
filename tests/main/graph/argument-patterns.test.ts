/**
 * The shared argument-shape SPARQL fragments (#2230).
 *
 * `health-checks.test.ts` covers these end-to-end through the checks that use
 * them. This file tests the seam itself, against real graph state, because two
 * modules now build queries out of it (`graph/health-checks.ts` and
 * `ipc/register-graph.ts`'s grounding query) and a regression in any one
 * fragment is a silent wrong answer in both.
 *
 * Each case states the same fact twice — once as hand-authored Turtle, once as
 * a typed note — because "these two representations are the same claim" is the
 * entire premise of the module.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { applyTurtle } from '../../../src/main/llm/proposal-persistence';
import {
  isA,
  labelOf,
  supportedBy,
  unsupported,
  SUPPORT_PREDICATES,
} from '../../../src/main/graph/argument-patterns';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-argument-patterns-');
let root: string;
let ctx: ProjectContext;

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

function writeNote(rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

async function rows(sparql: string): Promise<Record<string, string>[]> {
  const result = await queryGraph(ctx, sparql);
  expect(result.error, result.error ?? '').toBeUndefined();
  return result.results as Record<string, string>[];
}

describe('isA', () => {
  it('matches a claim asserted directly as thought:Claim', async () => {
    await applyTurtle(ctx, `<urn:claim:t> a thought:Claim ; thought:label "Turtle claim" .`);
    const found = await rows(`SELECT ?c WHERE { ${isA('c', 'Claim')} }`);
    expect(found.map((r) => r.c)).toEqual(['urn:claim:t']);
  });

  it('matches a typed note through the types:Claim rdfs:subClassOf edge', async () => {
    writeNote('claims/typed.md', '---\ntitle: Typed claim\ntype: claim\n---\n\nAssertion.\n');
    await indexAllNotes(ctx);
    const found = await rows(`
      SELECT ?path WHERE { ${isA('c', 'Claim')} ?c minerva:relativePath ?path . }
    `);
    expect(found.map((r) => r.path)).toEqual(['claims/typed.md']);
  });

  it('does not match an unrelated component class', async () => {
    await applyTurtle(ctx, `<urn:g:1> a thought:Grounds ; thought:label "Some grounds" .`);
    expect(await rows(`SELECT ?c WHERE { ${isA('c', 'Claim')} }`)).toEqual([]);
  });
});

describe('labelOf', () => {
  it('reads thought:label', async () => {
    await applyTurtle(ctx, `<urn:claim:a> a thought:Claim ; thought:label "From turtle" .`);
    const found = await rows(`SELECT ?cLabel WHERE { ${isA('c', 'Claim')} ${labelOf('c')} }`);
    expect(found.map((r) => r.cLabel)).toEqual(['From turtle']);
  });

  it('falls back to dc:title', async () => {
    writeNote('claims/titled.md', '---\ntitle: From the title\ntype: claim\n---\n\nAssertion.\n');
    await indexAllNotes(ctx);
    const found = await rows(`SELECT ?cLabel WHERE { ${isA('c', 'Claim')} ${labelOf('c')} }`);
    expect(found.map((r) => r.cLabel)).toEqual(['From the title']);
  });

  it('prefers thought:label when a node carries both', async () => {
    await applyTurtle(ctx, `
      <urn:claim:b> a thought:Claim ; thought:label "Preferred" ; dc:title "Fallback" .
    `);
    const found = await rows(`SELECT ?cLabel WHERE { ${isA('c', 'Claim')} ${labelOf('c')} }`);
    expect(found.map((r) => r.cLabel)).toEqual(['Preferred']);
  });

  it('drops a node with neither — nothing to name it in a message', async () => {
    await applyTurtle(ctx, `<urn:claim:c> a thought:Claim .`);
    expect(await rows(`SELECT ?cLabel WHERE { ${isA('c', 'Claim')} ${labelOf('c')} }`)).toEqual([]);
  });
});

describe('supportedBy / unsupported', () => {
  it('names both support predicates', () => {
    // Pinned because `unsupported` emits one clause per entry: adding a third
    // predicate without a matching query-shape check would silently widen
    // every "no support" check in the app.
    expect([...SUPPORT_PREDICATES]).toEqual(['thought:supports', 'minerva:supports']);
  });

  it('supportedBy matches either predicate', async () => {
    await applyTurtle(ctx, `
      <urn:claim:x> a thought:Claim ; thought:label "X" .
      <urn:claim:y> a thought:Claim ; thought:label "Y" .
      <urn:g:a> thought:supports <urn:claim:x> .
      <urn:g:b> minerva:supports <urn:claim:y> .
    `);
    const found = await rows(`SELECT ?c WHERE { ${supportedBy('s', 'c')} }`);
    expect(found.map((r) => r.c).sort()).toEqual(['urn:claim:x', 'urn:claim:y']);
  });

  it('unsupported keeps a claim nothing points at', async () => {
    await applyTurtle(ctx, `<urn:claim:lonely> a thought:Claim ; thought:label "Lonely" .`);
    const found = await rows(`SELECT ?c WHERE { ${isA('c', 'Claim')} ${unsupported('c')} }`);
    expect(found.map((r) => r.c)).toEqual(['urn:claim:lonely']);
  });

  it('unsupported drops a claim supported by either predicate', async () => {
    await applyTurtle(ctx, `
      <urn:claim:byThought> a thought:Claim ; thought:label "T" .
      <urn:claim:byMinerva> a thought:Claim ; thought:label "M" .
      <urn:claim:byNeither> a thought:Claim ; thought:label "N" .
      <urn:g:t> thought:supports <urn:claim:byThought> .
      <urn:g:m> minerva:supports <urn:claim:byMinerva> .
    `);
    const found = await rows(`SELECT ?c WHERE { ${isA('c', 'Claim')} ${unsupported('c')} }`);
    expect(found.map((r) => r.c)).toEqual(['urn:claim:byNeither']);
  });

  it('unsupported narrows to a supporter class when one is given', async () => {
    await applyTurtle(ctx, `
      <urn:claim:g> a thought:Claim ; thought:label "Grounded only" .
      <urn:g:only> a thought:Grounds ; thought:supports <urn:claim:g> .
      <urn:claim:w> a thought:Claim ; thought:label "Warranted" .
      <urn:w:one> a thought:Warrant ; thought:supports <urn:claim:w> .
    `);
    const found = await rows(`
      SELECT ?c WHERE { ${isA('c', 'Claim')} ${unsupported('c', 'Warrant')} }
    `);
    expect(found.map((r) => r.c)).toEqual(['urn:claim:g']);
  });

  it('reports every claim when the store holds no support triples at all', async () => {
    // The regression `unsupported` is written the long way for: a single
    // `FILTER NOT EXISTS { ?s (a|b) ?c }` returns NOTHING here — inverting to
    // "no unsupported claims" on exactly the thoughtbase most likely to have
    // them, a brand new one.
    await applyTurtle(ctx, `
      <urn:claim:n1> a thought:Claim ; thought:label "One" .
      <urn:claim:n2> a thought:Claim ; thought:label "Two" .
    `);
    const found = await rows(`SELECT ?c WHERE { ${isA('c', 'Claim')} ${unsupported('c')} }`);
    expect(found.map((r) => r.c).sort()).toEqual(['urn:claim:n1', 'urn:claim:n2']);
  });
});
