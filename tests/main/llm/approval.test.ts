import { describe, it, expect, beforeEach } from 'vitest';
import {
  getApprovalTier,
  setPolicy,
  resetPolicy,
  type OperationType,
  type ApprovalTier,
} from '../../../src/main/llm/approval';

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
