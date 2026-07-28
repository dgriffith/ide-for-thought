/**
 * Trust-Principle integrity query, automated (#1101).
 *
 * The integrity query documented in CLAUDE.md — LLM-attributed
 * `thought:Component` nodes lacking an approved `thought:Proposal` — was the one
 * defect-prevention mechanism that stayed a manual dev-run query. This promotes
 * it (via `findUnreviewedLLMWrites`) into a continuous gate: seed a graph, drive
 * the real approval engine, and assert the audit is empty on the honest path and
 * flags the offender on a bypass.
 *
 * The approve→graph half runs for real (`proposeWrite` → `approveProposal`); the
 * bypass fixture writes a component straight into the store with `applyTurtle`,
 * standing in for a hypothetical write that skipped the gate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph } from '../../../src/main/graph/index';
import { findUnreviewedLLMWrites } from '../../../src/main/graph/integrity';
import { proposeWrite, approveProposal } from '../../../src/main/llm/approval';
import { applyTurtle } from '../../../src/main/llm/proposal-persistence';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

let root: string;
let ctx: ProjectContext;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-trust-integrity-'));
  ctx = projectContext(root);
  await initGraph(ctx);
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

/** Turtle for a `thought:Claim` (a `thought:Component` subclass) with LLM
 *  provenance — the exact shape the integrity query hunts for. Prefixes are
 *  injected by both `applyTurtle` and `queryGraph`. */
function llmClaimTurtle(uri: string, label: string, extractedBy = 'llm:conversation:c1'): string {
  return `<${uri}> a thought:Claim ; thought:label "${label}" ; thought:extractedBy "${extractedBy}" .`;
}

/** File + approve a claim component through the real approval engine, returning
 *  the proposal URI. This is the honest path: the approved proposal's
 *  `thought:affectsNode` points back at the component. */
async function approveLlmClaim(uri: string, label: string): Promise<string> {
  const proposal = await proposeWrite(ctx, {
    operationType: 'new_claim',
    payloads: [{ kind: 'graph-triples', turtle: llmClaimTurtle(uri, label), affectsNodeUris: [uri] }],
    note: 'trust integrity test',
    proposedBy: 'llm:conversation:c1',
  });
  const res = await approveProposal(ctx, proposal.uri);
  expect(res.ok).toBe(true);
  return proposal.uri;
}

describe('Trust-Principle integrity query', () => {
  it('an empty graph has no unreviewed LLM writes', async () => {
    expect(await findUnreviewedLLMWrites(ctx)).toEqual([]);
  });

  it('passes: an approved LLM claim is NOT flagged', async () => {
    await approveLlmClaim('urn:trust:approved-claim', 'Approved LLM Claim');
    expect(await findUnreviewedLLMWrites(ctx)).toEqual([]);
  });

  it('flags: a component written straight to the graph (approval bypassed)', async () => {
    // No proposal — a component that skipped the gate.
    await applyTurtle(ctx, llmClaimTurtle('urn:trust:bypass-claim', 'Sneaky LLM Claim'));

    const offenders = await findUnreviewedLLMWrites(ctx);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.component).toBe('urn:trust:bypass-claim');
    expect(offenders[0]!.label).toBe('Sneaky LLM Claim');
    expect(offenders[0]!.extractedBy).toContain('llm');
  });

  it('flags: a component present in the graph whose proposal is only PENDING', async () => {
    // Only an *approved* proposal satisfies the gate. Put the component in the
    // graph and file a proposal that affects it but never approve it — a merely
    // pending proposal must not clear the audit. (In the normal flow a pending
    // proposal hasn't applied its payload at all; this constructs the stricter
    // "component exists + proposal still pending" state directly.)
    await applyTurtle(ctx, llmClaimTurtle('urn:trust:pending-claim', 'Pending LLM Claim'));
    await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{
        kind: 'graph-triples',
        turtle: llmClaimTurtle('urn:trust:pending-claim', 'Pending LLM Claim'),
        affectsNodeUris: ['urn:trust:pending-claim'],
      }],
      note: 'pending',
      proposedBy: 'llm:conversation:c1',
    });

    const offenders = await findUnreviewedLLMWrites(ctx);
    expect(offenders.map((o) => o.component)).toContain('urn:trust:pending-claim');
  });

  it('ignores a non-LLM component (human-authored) with no proposal', async () => {
    // The audit is scoped to LLM-attributed provenance; a hand-authored
    // component legitimately has no proposal and must not be flagged.
    await applyTurtle(ctx, llmClaimTurtle('urn:trust:human-claim', 'Human Claim', 'human:dave'));
    expect(await findUnreviewedLLMWrites(ctx)).toEqual([]);
  });

  it('mixed graph: flags only the bypass, not the approved sibling', async () => {
    await approveLlmClaim('urn:trust:ok-claim', 'Approved Sibling');
    await applyTurtle(ctx, llmClaimTurtle('urn:trust:leak-claim', 'Leaked Claim'));

    const offenders = await findUnreviewedLLMWrites(ctx);
    expect(offenders.map((o) => o.component)).toEqual(['urn:trust:leak-claim']);
  });
});
