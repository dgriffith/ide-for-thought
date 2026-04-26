/**
 * Integration coverage for the crystallize orchestrator (#342).
 *
 * The trust-guard tests (#331) exercise proposeWrite directly with a
 * hand-crafted Turtle diff. These tests drive `crystallize()` end-to-end
 * with a mocked LLM response so the wiring — prompt → LLM call → Turtle
 * → proposeWrite → graph proposal → optional approve — is exercised as
 * a single path. That path was previously uncovered (P0 #2 in
 * `reports/quality-review-entire-project-2026-04-24-1.md`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));
vi.mock('../../../src/main/llm/index', () => ({
  complete: completeMock,
}));

import { crystallize } from '../../../src/main/llm/crystallize';
import {
  approveProposal,
  rejectProposal,
  getProposal,
  listProposals,
  resetPolicy,
} from '../../../src/main/llm/approval';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const CLAIM_URI = 'https://minerva.dev/c/claim-water-boils';
const GROUNDS_URI = 'https://minerva.dev/c/grounds-1atm';
const CONV_URI = 'https://minerva.dev/ontology/thought#conversation/conv-test';

const CRYSTALLIZED_TURTLE = `
@prefix thought: <https://minerva.dev/ontology/thought#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

<${CLAIM_URI}> rdf:type thought:Claim ;
  thought:label "Water boils at 100C at 1atm." ;
  thought:extractedBy "llm:crystallization" ;
  thought:hasStatus thought:proposed .

<${GROUNDS_URI}> rdf:type thought:Grounds ;
  thought:label "Standard physics reference." ;
  thought:supports <${CLAIM_URI}> ;
  thought:extractedBy "llm:crystallization" ;
  thought:hasStatus thought:proposed .
`;

describe('crystallize() integration (#342)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-crystallize-int-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
    completeMock.mockReset();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('produces a pending Proposal whose shape matches the contract', async () => {
    completeMock.mockResolvedValueOnce(CRYSTALLIZED_TURTLE);

    const result = await crystallize(ctx, 'Water boils...', CONV_URI, 'llm:test');
    expect(result.componentCount).toBe(2);

    const proposals = await listProposals(ctx, 'pending');
    expect(proposals).toHaveLength(1);
    const p = proposals[0];

    expect(p.status).toBe('pending');
    expect(p.operationType).toBe('component_creation');
    expect(p.proposedBy).toBe('llm:test');
    expect(p.conversationUri).toBe(CONV_URI);
    expect(p.affectsNodeUris.sort()).toEqual([CLAIM_URI, GROUNDS_URI].sort());
    expect(p.turtleDiff).toContain(CLAIM_URI);
  });

  it('approving the proposal applies the component triples to the graph', async () => {
    completeMock.mockResolvedValueOnce(CRYSTALLIZED_TURTLE);
    await crystallize(ctx, 'text', CONV_URI);

    // Pre-approval: components must NOT be in the queryable graph yet.
    const beforeRows = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?label WHERE { <${CLAIM_URI}> thought:label ?label . }
    `);
    expect((beforeRows.results).length).toBe(0);

    const [pending] = await listProposals(ctx, 'pending');
    const ok = await approveProposal(ctx, pending.uri);
    expect(ok).toBe(true);

    // Post-approval: the component is reachable.
    const afterRows = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?label WHERE { <${CLAIM_URI}> thought:label ?label . }
    `);
    expect((afterRows.results as Array<{ label: string }>).map(r => r.label))
      .toContain('Water boils at 100C at 1atm.');

    // And the proposal itself flips to approved (not duplicated — see #332).
    const refreshed = await getProposal(ctx, pending.uri);
    expect(refreshed?.status).toBe('approved');
  });

  it('rejecting (skipping approval) leaves component triples out of the graph', async () => {
    completeMock.mockResolvedValueOnce(CRYSTALLIZED_TURTLE);
    await crystallize(ctx, 'text', CONV_URI);

    const [pending] = await listProposals(ctx, 'pending');
    const ok = await rejectProposal(ctx, pending.uri);
    expect(ok).toBe(true);

    const rows = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?label WHERE { <${CLAIM_URI}> thought:label ?label . }
    `);
    expect((rows.results).length).toBe(0);

    // The integrity query stays clean: no LLM-attributed component is
    // sitting in the graph without an approved proposal pointing at it.
    const orphans = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
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
    expect((orphans.results).length).toBe(0);
  });

  it('skips proposeWrite entirely when the LLM returns nothing', async () => {
    completeMock.mockResolvedValueOnce('   \n  ');

    const result = await crystallize(ctx, 'unhelpful', CONV_URI);
    expect(result.componentCount).toBe(0);
    expect(result.turtle).toBe('');

    const proposals = await listProposals(ctx);
    expect(proposals).toHaveLength(0);
  });

  it('threads the model override into the underlying complete() call', async () => {
    completeMock.mockResolvedValueOnce(CRYSTALLIZED_TURTLE);
    await crystallize(ctx, 'text', CONV_URI, 'llm:test', 'claude-opus-4-7');

    expect(completeMock).toHaveBeenCalledTimes(1);
    const opts = completeMock.mock.calls[0][1];
    expect(opts).toEqual({ model: 'claude-opus-4-7' });
  });
});
