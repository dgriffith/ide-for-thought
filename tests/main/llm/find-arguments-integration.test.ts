/**
 * Integration coverage for the find-arguments orchestrator (#409 / #410).
 *
 * Drives both polarities through the full pipe: graph lookup → LLM call
 * (mocked) → JSON parse → ProposalBundle (note + N Grounds triples) →
 * proposeWrite → optional approve → SPARQL verification of supports /
 * rebuts edges and citation links.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const { completeWithToolsMock, completeMock } = vi.hoisted(() => ({
  completeWithToolsMock: vi.fn(),
  completeMock: vi.fn(),
}));
vi.mock('../../../src/main/llm/index', () => ({
  complete: completeMock,
  completeWithTools: completeWithToolsMock,
}));

import { findArguments } from '../../../src/main/llm/find-arguments';
import {
  approveProposal,
  proposeWrite,
  listProposals,
  resetPolicy,
} from '../../../src/main/llm/approval';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const CLAIM_URI = 'https://minerva.dev/c/claim-target-of-arguments';
const CLAIM_TURTLE = `
<${CLAIM_URI}> a thought:Claim ;
  thought:label "The meeting started at 3pm." ;
  thought:sourceText "We started the meeting at 3pm sharp." ;
  thought:hasStatus thought:proposed .
`;

async function plantClaim(ctx: ProjectContext): Promise<void> {
  const p = await proposeWrite(ctx, {
    operationType: 'tag_addition',
    payloads: [{
      kind: 'graph-triples',
      turtle: CLAIM_TURTLE,
      affectsNodeUris: [CLAIM_URI],
    }],
    note: 'autonomous tier — landed directly',
    proposedBy: 'unit-test-fixture',
  });
  expect(p).toBeNull();
}

const SUPPORTING_RESPONSE = JSON.stringify({
  verdict: 'arguments-found',
  summary: 'Multiple internal records corroborate the 3pm start.',
  arguments: [
    {
      label: 'The calendar invite shows 3pm.',
      structure: 'Invite says 3pm; attendees synced from the invite; therefore the meeting started at 3pm.',
      strength: 'strong',
      citations: [
        { url: 'https://example.com/calendar', snippet: 'invite for 3:00 PM' },
      ],
    },
    {
      label: 'The slack #general post-meeting message is timestamped 3:48pm.',
      structure: 'Post-meeting note arrived 3:48pm; meetings of this type run ~45min; therefore start ~3pm.',
      strength: 'moderate',
      citations: [
        { url: 'https://slack.example.com/archive/abc', snippet: 'thanks all, ttyl' },
      ],
    },
  ],
});

const OPPOSING_RESPONSE = JSON.stringify({
  verdict: 'arguments-found',
  summary: 'Two independent timestamps contradict the 3pm claim.',
  arguments: [
    {
      label: 'Door-badge logs show entries between 3:05 and 3:14.',
      structure: 'Late entries imply the meeting had not yet started; therefore 3pm is too early.',
      strength: 'strong',
      citations: [
        { url: 'https://badge.example.com/log', snippet: 'entries 15:05–15:14' },
      ],
    },
  ],
});

const NO_ARGUMENTS_RESPONSE = JSON.stringify({
  verdict: 'no-strong-arguments-found',
  summary: '',
  arguments: [],
});

describe('findArguments() integration (#409 / #410)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-find-arguments-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
    completeWithToolsMock.mockReset();
    completeMock.mockReset();
    await plantClaim(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('support polarity: files a Proposal whose Grounds link via thought:supports', async () => {
    completeWithToolsMock.mockResolvedValueOnce({ text: SUPPORTING_RESPONSE, citations: [] });

    const result = await findArguments(ctx, {
      polarity: 'support',
      claimUri: CLAIM_URI,
    });
    expect(result.error).toBe('');
    expect(result.verdict).toBe('arguments-found');
    expect(result.argumentCount).toBe(2);
    expect(result.proposalUri).not.toBeNull();

    const [pending] = await listProposals(ctx, 'pending');
    expect(pending.operationType).toBe('evidence_link');
    expect(pending.proposedBy).toBe('llm:find-supporting-arguments');
    // 1 note + 2 graph-triples
    expect(pending.payloads).toHaveLength(3);
    expect(pending.payloads[0].kind).toBe('note');

    expect(await approveProposal(ctx, pending.uri)).toBe(true);

    // Supports edges land on the Claim.
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?g ?label ?strength WHERE {
        ?g a thought:Grounds ;
           thought:supports <${CLAIM_URI}> ;
           thought:label ?label ;
           thought:strength ?strength ;
           thought:extractedBy "llm:find-supporting-arguments" .
      }
    `);
    expect(r.results.length).toBe(2);

    // Note landed.
    const note = await fsp.readFile(
      path.join(root, 'notes/supporting-arguments-for-the-meeting-started-at-3pm.md'),
      'utf-8',
    );
    expect(note).toContain('Supporting arguments');
    expect(note).toContain('The calendar invite shows 3pm.');
  });

  it('oppose polarity: files a Proposal whose Grounds link via thought:rebuts', async () => {
    completeWithToolsMock.mockResolvedValueOnce({ text: OPPOSING_RESPONSE, citations: [] });

    const result = await findArguments(ctx, {
      polarity: 'oppose',
      claimUri: CLAIM_URI,
    });
    expect(result.argumentCount).toBe(1);

    const [pending] = await listProposals(ctx, 'pending');
    expect(pending.proposedBy).toBe('llm:find-opposing-arguments');
    expect(await approveProposal(ctx, pending.uri)).toBe(true);

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      ASK { ?g a thought:Grounds ; thought:rebuts <${CLAIM_URI}> . }
    `);
    expect(r.results).toBeDefined();
    // queryGraph returns boolean ASK as a row with `_ask: true`; some
    // engines surface it differently. Use a SELECT count instead for
    // robustness.
    const counted = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT (COUNT(?g) AS ?n) WHERE { ?g a thought:Grounds ; thought:rebuts <${CLAIM_URI}> . }
    `);
    const rows = counted.results as Array<{ n: string }>;
    expect(Number(rows[0].n)).toBe(1);

    const note = await fsp.readFile(
      path.join(root, 'notes/opposing-arguments-for-the-meeting-started-at-3pm.md'),
      'utf-8',
    );
    expect(note).toContain('Opposing arguments');
  });

  it('attaches thought:hasCitation triples for every cited URL', async () => {
    completeWithToolsMock.mockResolvedValueOnce({ text: SUPPORTING_RESPONSE, citations: [] });
    await findArguments(ctx, { polarity: 'support', claimUri: CLAIM_URI });
    const [pending] = await listProposals(ctx, 'pending');
    expect(await approveProposal(ctx, pending.uri)).toBe(true);

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?cite WHERE {
        ?g a thought:Grounds ; thought:hasCitation ?cite .
      }
      ORDER BY ?cite
    `);
    const cites = (r.results as Array<{ cite: string }>).map((row) => row.cite).sort();
    expect(cites).toEqual([
      'https://example.com/calendar',
      'https://slack.example.com/archive/abc',
    ]);
  });

  it('no-strong-arguments-found verdict files NO Proposal and surfaces the verdict', async () => {
    completeWithToolsMock.mockResolvedValueOnce({ text: NO_ARGUMENTS_RESPONSE, citations: [] });

    const result = await findArguments(ctx, {
      polarity: 'support',
      claimUri: CLAIM_URI,
    });
    expect(result.verdict).toBe('no-strong-arguments-found');
    expect(result.argumentCount).toBe(0);
    expect(result.proposalUri).toBeNull();
    expect(await listProposals(ctx)).toHaveLength(0);
  });

  it('returns an error and files no Proposal when the LLM body cannot be parsed', async () => {
    completeWithToolsMock.mockResolvedValueOnce({ text: 'not json', citations: [] });

    const result = await findArguments(ctx, {
      polarity: 'support',
      claimUri: CLAIM_URI,
    });
    expect(result.error).toMatch(/parse/i);
    expect(result.proposalUri).toBeNull();
    expect(await listProposals(ctx)).toHaveLength(0);
  });

  it('returns a clear error when the claim URI does not exist in the graph', async () => {
    const result = await findArguments(ctx, {
      polarity: 'support',
      claimUri: 'https://minerva.dev/c/claim-does-not-exist',
    });
    expect(result.error).toMatch(/no thought:claim/i);
    expect(completeWithToolsMock).not.toHaveBeenCalled();
    expect(result.proposalUri).toBeNull();
  });

  it('threads the model override into completeWithTools', async () => {
    completeWithToolsMock.mockResolvedValueOnce({ text: NO_ARGUMENTS_RESPONSE, citations: [] });
    await findArguments(ctx, {
      polarity: 'support',
      claimUri: CLAIM_URI,
      model: 'claude-opus-4-7',
    });

    expect(completeWithToolsMock).toHaveBeenCalledTimes(1);
    const opts = completeWithToolsMock.mock.calls[0][0];
    expect(opts.model).toBe('claude-opus-4-7');
    expect(opts.system).toMatch(/in favour of it/i);
  });
});
