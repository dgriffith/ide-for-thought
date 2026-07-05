/**
 * Proposal lifecycle: expiry / auto-reject window, list/get, and the
 * reject-non-pending guards (#1000). The trust path's happy path is well
 * covered by approval.test.ts; this pins the time-based expiry sweep and the
 * read/lifecycle branches that were previously untested.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  proposeWrite,
  approveProposal,
  rejectProposal,
  expireProposals,
  listProposals,
  getProposal,
} from '../../../src/main/llm/approval';
import { initGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const THOUGHT = 'https://minerva.dev/ontology/thought#';

describe('proposal expiry + lifecycle (#1000)', () => {
  let root: string;
  let ctx: ProjectContext;
  let seq = 0;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-proposal-expiry-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    seq = 0;
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  /** File a pending (requires_approval) proposal; `expiryDays` sets its
   *  autoExpires relative to now (negative ⇒ already past). */
  async function proposePending(expiryDays?: number) {
    const subject = `urn:test:claim:${seq++}`;
    const p = await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{
        kind: 'graph-triples' as const,
        turtle: `<${subject}> a <${THOUGHT}Claim> .`,
        affectsNodeUris: [subject],
      }],
      note: 'expiry test',
      proposedBy: 'unit-test',
      ...(expiryDays !== undefined ? { expiryDays } : {}),
    });
    expect(p).not.toBeNull();
    return p!;
  }

  it('expires a pending proposal whose autoExpires is in the past', async () => {
    const p = await proposePending(-1);
    expect((await getProposal(ctx, p.uri))!.status).toBe('pending');

    expect(await expireProposals(ctx)).toBe(1);
    expect((await getProposal(ctx, p.uri))!.status).toBe('expired');
  });

  it('leaves a not-yet-expired proposal pending', async () => {
    const p = await proposePending(7);
    expect(await expireProposals(ctx)).toBe(0);
    expect((await getProposal(ctx, p.uri))!.status).toBe('pending');
  });

  it('counts and expires only the past-due pending proposals', async () => {
    await proposePending(-1);
    await proposePending(-5);
    await proposePending(30); // future — must survive
    expect(await expireProposals(ctx)).toBe(2);
    expect((await listProposals(ctx, 'expired')).length).toBe(2);
    expect((await listProposals(ctx, 'pending')).length).toBe(1);
  });

  it('does not touch an already-approved proposal even if its window has passed', async () => {
    const p = await proposePending(-1);
    expect((await approveProposal(ctx, p.uri)).ok).toBe(true);
    // The expiry sweep only looks at *pending* proposals.
    expect(await expireProposals(ctx)).toBe(0);
    expect((await getProposal(ctx, p.uri))!.status).toBe('approved');
  });

  it('is a no-op sweep when there are no proposals', async () => {
    expect(await expireProposals(ctx)).toBe(0);
  });

  it('listProposals returns every proposal, and filters by status', async () => {
    const a = await proposePending(7);
    const b = await proposePending(7);
    await rejectProposal(ctx, b.uri);

    const all = await listProposals(ctx);
    expect(all.map((p) => p.uri).sort()).toEqual([a.uri, b.uri].sort());

    expect((await listProposals(ctx, 'pending')).map((p) => p.uri)).toEqual([a.uri]);
    expect((await listProposals(ctx, 'rejected')).map((p) => p.uri)).toEqual([b.uri]);
  });

  it('getProposal returns null for a missing uri', async () => {
    expect(await getProposal(ctx, 'urn:test:nonexistent')).toBeNull();
  });

  it('rejectProposal returns false for a missing uri', async () => {
    expect(await rejectProposal(ctx, 'urn:test:nonexistent')).toBe(false);
  });

  it('rejectProposal returns false once a proposal is no longer pending', async () => {
    const p = await proposePending(7);
    expect((await approveProposal(ctx, p.uri)).ok).toBe(true);
    // Already approved — a subsequent reject must not flip it.
    expect(await rejectProposal(ctx, p.uri)).toBe(false);
    expect((await getProposal(ctx, p.uri))!.status).toBe('approved');
  });

  it('approveProposal on a missing / non-pending proposal returns { ok: false } without applying', async () => {
    expect((await approveProposal(ctx, 'urn:test:nonexistent')).ok).toBe(false);
    const p = await proposePending(7);
    await rejectProposal(ctx, p.uri);
    expect((await approveProposal(ctx, p.uri)).ok).toBe(false);
    expect((await getProposal(ctx, p.uri))!.status).toBe('rejected');
  });
});
