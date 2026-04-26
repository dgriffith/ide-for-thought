import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  getApprovalTier,
  setPolicy,
  resetPolicy,
  proposeWrite,
  approveProposal,
  rejectProposal,
  type OperationType,
  type ApprovalTier,
} from '../../../src/main/llm/approval';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('approval policy', () => {
  beforeEach(() => {
    resetPolicy();
  });

  it('returns requires_approval for new_claim by default', () => {
    expect(getApprovalTier('new_claim')).toBe('requires_approval');
  });

  it('returns requires_approval for evidence_link by default', () => {
    expect(getApprovalTier('evidence_link')).toBe('requires_approval');
  });

  it('returns requires_approval for component_creation by default', () => {
    expect(getApprovalTier('component_creation')).toBe('requires_approval');
  });

  it('returns notify_only for confidence_update by default', () => {
    expect(getApprovalTier('confidence_update')).toBe('notify_only');
  });

  it('returns notify_only for status_change by default', () => {
    expect(getApprovalTier('status_change')).toBe('notify_only');
  });

  it('returns autonomous for tag_addition by default', () => {
    expect(getApprovalTier('tag_addition')).toBe('autonomous');
  });

  it('returns autonomous for staleness_flag by default', () => {
    expect(getApprovalTier('staleness_flag')).toBe('autonomous');
  });

  it('allows overriding policy for an operation type', () => {
    setPolicy('tag_addition', 'requires_approval');
    expect(getApprovalTier('tag_addition')).toBe('requires_approval');
  });

  it('resetPolicy restores defaults', () => {
    setPolicy('tag_addition', 'requires_approval');
    resetPolicy();
    expect(getApprovalTier('tag_addition')).toBe('autonomous');
  });

  it('falls back to requires_approval for unknown operation types', () => {
    expect(getApprovalTier('unknown_op' as OperationType)).toBe('requires_approval');
  });
});

describe('updateProposalStatus replaces, does not append (#332)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-status-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function statusesFor(uri: string): Promise<string[]> {
    const r = await queryGraph(ctx, `
      SELECT ?s WHERE { <${uri}> thought:proposalStatus ?s . }
    `);
    return (r.results as Array<{ s: string }>).map((row) => row.s);
  }

  it('approving a pending proposal leaves only the approved status', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{
        kind: 'graph-triples',
        turtle: '<https://ex.example/x> a <https://ex.example/Claim> .',
        affectsNodeUris: ['https://ex.example/x'],
      }],
      note: 'test',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();
    expect(await statusesFor(proposal!.uri)).toEqual([
      'https://minerva.dev/ontology/thought#pending',
    ]);

    expect(await approveProposal(ctx, proposal!.uri)).toBe(true);
    expect(await statusesFor(proposal!.uri)).toEqual([
      'https://minerva.dev/ontology/thought#approved',
    ]);
  });

  it('rejecting a pending proposal leaves only the rejected status', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{
        kind: 'graph-triples',
        turtle: '<https://ex.example/y> a <https://ex.example/Claim> .',
        affectsNodeUris: ['https://ex.example/y'],
      }],
      note: 'test',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();
    expect(await rejectProposal(ctx, proposal!.uri)).toBe(true);
    expect(await statusesFor(proposal!.uri)).toEqual([
      'https://minerva.dev/ontology/thought#rejected',
    ]);
  });
});

describe('approval tiers cover all default operations', () => {
  const expectedTiers: [OperationType, ApprovalTier][] = [
    ['new_claim', 'requires_approval'],
    ['evidence_link', 'requires_approval'],
    ['component_creation', 'requires_approval'],
    ['confidence_update', 'notify_only'],
    ['status_change', 'notify_only'],
    ['tag_addition', 'autonomous'],
    ['staleness_flag', 'autonomous'],
  ];

  for (const [op, tier] of expectedTiers) {
    it(`${op} → ${tier}`, () => {
      expect(getApprovalTier(op)).toBe(tier);
    });
  }
});
