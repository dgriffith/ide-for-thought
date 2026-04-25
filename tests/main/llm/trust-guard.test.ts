/**
 * Trust-principle wiring tests (#331).
 *
 * Three things this exercises:
 *  1. The LLM-context guard fires console.warn when an LLM-originated path
 *     mutates the graph without going through the approval engine.
 *  2. The approval engine's writes (proposeWrite / approveProposal) do
 *     NOT trip the guard, because they wrap their parseIntoStore calls
 *     in trustedContext.
 *  3. crystallize's resulting Proposal carries thought:affectsNode for
 *     every component subject in its turtleDiff — so the
 *     "Trust: Unreviewed LLM writes" stock query stays clean after a
 *     normal crystallize → approve flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  enterLLMContext,
  exitLLMContext,
  enterTrustedContext,
  exitTrustedContext,
  parseIntoStore,
  queryGraph,
} from '../../../src/main/graph/index';
import {
  proposeWrite,
  approveProposal,
  resetPolicy,
  setPolicy,
  getProposal,
} from '../../../src/main/llm/approval';
import { extractSubjectIris } from '../../../src/main/llm/crystallize';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-trust-guard-test-'));
}

describe('LLM write guard (#331)', () => {
  let root: string;
  let ctx: ProjectContext;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('outside LLM context: mutators are silent', async () => {
    await indexNote(ctx, 'a.md', '# Alpha\n');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('in LLM context: a direct indexNote (bypass) triggers a warn', async () => {
    enterLLMContext();
    try {
      await indexNote(ctx, 'a.md', '# Alpha\n');
    } finally {
      exitLLMContext();
    }
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.some((m) => m.includes('[trust-guard]') && m.includes('indexNote'))).toBe(true);
  });

  it('in LLM context: approval-engine writes do NOT trigger a warn', async () => {
    // Use a tier that applies the diff immediately — any path that does so
    // exercises the approval engine's parseIntoStore call.
    enterLLMContext();
    try {
      await proposeWrite(ctx, {
        operationType: 'tag_addition',
        turtleDiff: '<https://ex/a> a <https://ex/T> .',
        note: 'autonomous tier — applied directly',
        proposedBy: 'unit-test',
      });
    } finally {
      exitLLMContext();
    }
    // Important: NO trust-guard warning. (Other warnings, e.g. from rdflib,
    // could in principle leak through; assert specifically on the prefix.)
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.some((m) => m.includes('[trust-guard]'))).toBe(false);
  });

  it('approveProposal of a pending proposal: no trust-guard warn', async () => {
    enterLLMContext();
    let proposalUri: string;
    try {
      const p = await proposeWrite(ctx, {
        operationType: 'new_claim',
        turtleDiff: '<https://ex/x> a <https://ex/Claim> .',
        note: 'pending',
        proposedBy: 'unit-test',
      });
      proposalUri = p!.uri;
    } finally {
      exitLLMContext();
    }
    // Approval can happen out-of-LLM-context (the user clicks approve), but
    // the assertion we want is "even *if* it ran in LLM context, it stays
    // quiet". So enter again and approve.
    enterLLMContext();
    try {
      const ok = await approveProposal(ctx, proposalUri);
      expect(ok).toBe(true);
    } finally {
      exitLLMContext();
    }
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.some((m) => m.includes('[trust-guard]'))).toBe(false);
  });

  it('manually-nested trustedContext suppresses the guard', () => {
    enterLLMContext();
    enterTrustedContext();
    try {
      parseIntoStore(ctx, '<https://ex/y> a <https://ex/T> .');
    } finally {
      exitTrustedContext();
      exitLLMContext();
    }
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.some((m) => m.includes('[trust-guard]'))).toBe(false);
  });
});

describe('crystallize provenance (#331)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('extractSubjectIris pulls every absolute-IRI subject from a Turtle blob', () => {
    const ttl = `
      @prefix thought: <https://minerva.dev/ontology/thought#> .

      <https://minerva.dev/c/claim-1>
        a thought:Claim ;
        thought:label "Subjects matter." .

      <https://minerva.dev/c/grounds-1>
        a thought:Grounds ;
        thought:supports <https://minerva.dev/c/claim-1> .
    `;
    const subs = extractSubjectIris(ttl);
    expect(subs.sort()).toEqual([
      'https://minerva.dev/c/claim-1',
      'https://minerva.dev/c/grounds-1',
    ]);
  });

  it('a proposal carries thought:affectsNode for every URI in affectsNodeUris', async () => {
    const aUri = 'https://minerva.dev/c/alpha';
    const bUri = 'https://minerva.dev/c/beta';
    setPolicy('component_creation', 'requires_approval');
    const p = await proposeWrite(ctx, {
      operationType: 'component_creation',
      turtleDiff: `<${aUri}> a <https://ex/T> .\n<${bUri}> a <https://ex/T> .`,
      note: 'two components',
      proposedBy: 'unit-test',
      affectsNodeUris: [aUri, bUri],
    });
    expect(p).not.toBeNull();

    const back = await getProposal(ctx, p!.uri);
    expect(back).not.toBeNull();
    expect(back!.affectsNodeUris.sort()).toEqual([aUri, bUri]);

    // And the SPARQL view used by the integrity query: each URI is reachable
    // from the proposal via thought:affectsNode.
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?n WHERE { <${p!.uri}> thought:affectsNode ?n . }
    `);
    const found = (r.results as Array<{ n: string }>).map((row) => row.n).sort();
    expect(found).toEqual([aUri, bUri]);
  });

  it('the "Unreviewed LLM writes" integrity query stays clean after approve', async () => {
    setPolicy('component_creation', 'requires_approval');
    const componentUri = 'https://minerva.dev/c/c1';
    // Mimic a crystallize-shaped proposal: LLM-attributed component +
    // matching affectsNodeUris.
    const turtleDiff = `
      @prefix thought: <https://minerva.dev/ontology/thought#> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      <${componentUri}> rdf:type thought:Claim ;
        thought:label "test" ;
        thought:extractedBy "llm:crystallization" .
    `;
    const p = await proposeWrite(ctx, {
      operationType: 'component_creation',
      turtleDiff,
      note: 'test',
      proposedBy: 'unit-test',
      affectsNodeUris: [componentUri],
    });
    expect(p).not.toBeNull();
    expect(await approveProposal(ctx, p!.uri)).toBe(true);

    // Same shape as the stock query "Trust: Unreviewed LLM writes":
    // an LLM-attributed component without an approved proposal pointing
    // at it via thought:affectsNode.
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT ?component WHERE {
        ?component rdf:type/rdfs:subClassOf* thought:Component .
        ?component thought:extractedBy ?extractedBy .
        FILTER(CONTAINS(LCASE(?extractedBy), "llm"))
        FILTER NOT EXISTS {
          ?proposal rdf:type thought:Proposal .
          ?proposal thought:affectsNode ?component .
          ?proposal thought:proposalStatus thought:approved .
        }
      }
    `);
    expect((r.results as unknown[]).length).toBe(0);
  });
});
