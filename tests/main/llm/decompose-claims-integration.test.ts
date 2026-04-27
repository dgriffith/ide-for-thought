/**
 * Integration coverage for the decompose-claims orchestrator (#408).
 *
 * Drives `decomposeClaims()` end-to-end with a mocked LLM response so
 * the full path — prompt → LLM call → JSON parse → ProposalBundle
 * (note + N triples) → proposeWrite → approval engine — is exercised as
 * one unit. The pure prompt-builder / parser pieces have their own
 * tests in shared; this file is the wiring + bundle-shape contract.
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

import { decomposeClaims } from '../../../src/main/llm/decompose-claims';
import {
  approveProposal,
  listProposals,
  getProposal,
  resetPolicy,
} from '../../../src/main/llm/approval';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const FOUR_CLAIMS_RESPONSE = JSON.stringify({
  claims: [
    {
      label: 'The meeting started at 3pm.',
      sourceText: 'We started the meeting at 3pm sharp.',
      kind: 'factual',
    },
    {
      label: 'The discussion was unproductive.',
      sourceText: 'Honestly the whole hour was a waste.',
      kind: 'evaluative',
    },
    {
      label: 'A "post-mortem" is a structured retrospective held after a notable event.',
      sourceText: 'A post-mortem just means a structured retro after the fact.',
      kind: 'definitional',
    },
    {
      label: 'The next release will slip by two weeks.',
      sourceText: 'We are going to slip the release by two weeks at least.',
      kind: 'predictive',
    },
  ],
});

describe('decomposeClaims() integration (#408)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-decompose-claims-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
    completeMock.mockReset();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('files a single Proposal whose payloads cover note + one triples-block per claim', async () => {
    completeMock.mockResolvedValueOnce(FOUR_CLAIMS_RESPONSE);

    const result = await decomposeClaims(ctx, {
      passage: 'whatever — the LLM is mocked',
      sourceRelPath: 'notes/standup-2026-04-26.md',
    });
    expect(result.error).toBe('');
    expect(result.claimCount).toBe(4);
    expect(result.proposalUri).not.toBeNull();

    const proposals = await listProposals(ctx, 'pending');
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.operationType).toBe('component_creation');
    expect(p.proposedBy).toBe('llm:decompose-claims');

    // 1 note + 4 graph-triples = 5 payloads.
    expect(p.payloads).toHaveLength(5);
    expect(p.payloads[0].kind).toBe('note');
    for (let i = 1; i <= 4; i++) {
      expect(p.payloads[i].kind).toBe('graph-triples');
    }

    // Each triples payload affects exactly its own claim URI.
    const triplesAffects = p.payloads.slice(1).flatMap((pl) =>
      pl.kind === 'graph-triples' ? pl.affectsNodeUris : [],
    );
    expect(triplesAffects).toHaveLength(4);
    expect(new Set(triplesAffects).size).toBe(4);
    for (const uri of triplesAffects) {
      expect(uri).toMatch(/^https:\/\/minerva\.dev\/c\/claim-/);
    }
    // The proposal's affectsNodeUris is the union of every payload's URIs:
    // claim URIs from the triples blocks PLUS the note's project IRI added
    // by the approval engine so the note shows up in integrity queries.
    for (const uri of triplesAffects) {
      expect(p.affectsNodeUris).toContain(uri);
    }
    expect(p.affectsNodeUris.length).toBeGreaterThanOrEqual(triplesAffects.length);
  });

  it('approving the bundle lands the note on disk AND every Claim in the graph', async () => {
    completeMock.mockResolvedValueOnce(FOUR_CLAIMS_RESPONSE);
    await decomposeClaims(ctx, {
      passage: 'whatever',
      sourceRelPath: 'notes/standup-2026-04-26.md',
    });

    const [pending] = await listProposals(ctx, 'pending');
    expect(await approveProposal(ctx, pending.uri)).toBe(true);

    // The note exists at the expected derived path.
    const noteOnDisk = await fsp.readFile(
      path.join(root, 'notes/decomposition-of-standup-2026-04-26.md'),
      'utf-8',
    );
    expect(noteOnDisk).toContain('# Decomposition: standup-2026-04-26');
    expect(noteOnDisk).toContain('The meeting started at 3pm.');
    expect(noteOnDisk).toContain('_kind:_ `factual`');
    expect(noteOnDisk).toContain('> We started the meeting at 3pm sharp.');

    // Every Claim made it into the graph with its kind preserved.
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?label ?kind WHERE {
        ?c a thought:Claim ;
           thought:label ?label ;
           thought:claimKind ?kind ;
           thought:extractedBy "llm:decompose-claims" .
      }
      ORDER BY ?label
    `);
    const rows = r.results as Array<{ label: string; kind: string }>;
    expect(rows).toHaveLength(4);
    const kinds = rows.map((row) => row.kind).sort();
    expect(kinds).toEqual(['definitional', 'evaluative', 'factual', 'predictive']);

    // Proposal status flips to approved (one record, replaced — see #332).
    const refreshed = await getProposal(ctx, pending.uri);
    expect(refreshed?.status).toBe('approved');
  });

  it('returns claimCount=0 and files no proposal when the LLM returns an empty claims array', async () => {
    completeMock.mockResolvedValueOnce(JSON.stringify({ claims: [] }));

    const result = await decomposeClaims(ctx, {
      passage: 'a passage with no real claims',
    });
    expect(result.claimCount).toBe(0);
    expect(result.proposalUri).toBeNull();
    expect(result.error).toBe('');
    expect(await listProposals(ctx)).toHaveLength(0);
  });

  it('surfaces a parse error and files no proposal when the LLM returns garbage', async () => {
    completeMock.mockResolvedValueOnce('this is not json at all');

    const result = await decomposeClaims(ctx, { passage: 'whatever' });
    expect(result.claimCount).toBe(0);
    expect(result.proposalUri).toBeNull();
    expect(result.error).toMatch(/parse/i);
    expect(await listProposals(ctx)).toHaveLength(0);
  });

  it('skips the LLM entirely when the passage is empty / whitespace', async () => {
    const result = await decomposeClaims(ctx, { passage: '   \n   ' });
    expect(result.claimCount).toBe(0);
    expect(result.proposalUri).toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('threads the model override into the underlying complete() call', async () => {
    completeMock.mockResolvedValueOnce(JSON.stringify({ claims: [] }));
    await decomposeClaims(ctx, {
      passage: 'something',
      model: 'claude-opus-4-7',
    });

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock.mock.calls[0][1]).toEqual({ model: 'claude-opus-4-7' });
  });

  it('falls back to a generic stem when no source path is provided', async () => {
    completeMock.mockResolvedValueOnce(JSON.stringify({
      claims: [{
        label: 'A thing is true.',
        sourceText: 'A thing is true.',
        kind: 'factual',
      }],
    }));
    await decomposeClaims(ctx, { passage: 'A thing is true.' });

    const [pending] = await listProposals(ctx, 'pending');
    const note = pending.payloads.find((p) => p.kind === 'note');
    expect(note?.kind).toBe('note');
    if (note?.kind === 'note') {
      expect(note.relativePath).toBe('notes/decomposition-of-passage.md');
    }
  });
});
