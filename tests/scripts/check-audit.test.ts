/**
 * The advisory ratchet's comparison (#2249).
 *
 * `audit:all` was `continue-on-error: true` with a comment naming the next
 * move — "once the full tree is clean, remove `continue-on-error`" — and no
 * mechanism to tell anyone when that became possible, because the step was
 * green whether the tree got better or worse. A plan with no feedback loop.
 *
 * The tree is not clean and can't currently be made clean (see
 * `build/audit-baseline.json`), so the gate is "no worse than today" rather
 * than zero — the shape the codebase already uses for pattern ratchets,
 * file-size budgets and coverage floors.
 *
 * The property worth testing is that it tracks advisory **identities**, not a
 * count. A count-based gate passes when one advisory is fixed and a different
 * one appears, which is precisely the drift this exists to catch.
 */
import { describe, it, expect } from 'vitest';
import { advisoryKeys, compare } from '../../scripts/check-audit.mjs';

const adv = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  module: 'some-dep',
  severity: 'high',
  title: 't',
  patched: null,
  ...over,
});

describe('advisoryKeys — what gets gated', () => {
  it('keeps high and critical, drops the rest', () => {
    const json = {
      advisories: {
        1: { github_advisory_id: 'GHSA-a', module_name: 'x', severity: 'high', title: 'a' },
        2: { github_advisory_id: 'GHSA-b', module_name: 'y', severity: 'critical', title: 'b' },
        3: { github_advisory_id: 'GHSA-c', module_name: 'z', severity: 'moderate', title: 'c' },
        4: { github_advisory_id: 'GHSA-d', module_name: 'w', severity: 'low', title: 'd' },
      },
    };
    expect(advisoryKeys(json).map((a) => a.id)).toEqual(['GHSA-a', 'GHSA-b']);
  });

  it('prefers the GHSA id over the registry-local numeric one', () => {
    // The numeric `id` can churn between registry snapshots; GHSA ids don't.
    // A baseline keyed on the unstable one would flap for no reason.
    const json = { advisories: { 99: { id: 99, github_advisory_id: 'GHSA-stable', module_name: 'x', severity: 'high' } } };
    expect(advisoryKeys(json)[0]!.id).toBe('GHSA-stable');
  });

  it('falls back to the numeric id when no GHSA id is present', () => {
    const json = { advisories: { 99: { id: 99, module_name: 'x', severity: 'high' } } };
    expect(advisoryKeys(json)[0]!.id).toBe('99');
  });

  it('records whether a patch exists at all', () => {
    // `null` is the difference between "nobody has bumped it" and "there is
    // nothing to bump to" — extract-zip is the latter, and the remediation
    // advice the script prints depends on knowing which.
    const json = {
      advisories: {
        1: { github_advisory_id: 'GHSA-a', module_name: 'x', severity: 'high', patched_versions: '>=2.0.3' },
        2: { github_advisory_id: 'GHSA-b', module_name: 'y', severity: 'high' },
      },
    };
    const byId = Object.fromEntries(advisoryKeys(json).map((a) => [a.id, a.patched]));
    expect(byId['GHSA-a']).toBe('>=2.0.3');
    expect(byId['GHSA-b']).toBeNull();
  });

  it('is stable-sorted, so a re-bless produces a reviewable diff', () => {
    const json = {
      advisories: {
        1: { github_advisory_id: 'GHSA-z', module_name: 'x', severity: 'high' },
        2: { github_advisory_id: 'GHSA-a', module_name: 'y', severity: 'high' },
      },
    };
    expect(advisoryKeys(json).map((a) => a.id)).toEqual(['GHSA-a', 'GHSA-z']);
  });

  it('handles an empty audit without throwing', () => {
    expect(advisoryKeys({})).toEqual([]);
    expect(advisoryKeys({ advisories: {} })).toEqual([]);
  });
});

describe('compare — growth fails', () => {
  it('flags an advisory not in the baseline', () => {
    const { added, removed } = compare([adv('GHSA-a'), adv('GHSA-new')], [adv('GHSA-a')]);
    expect(added.map((a) => a.id)).toEqual(['GHSA-new']);
    expect(removed).toEqual([]);
  });

  it('passes when the set is unchanged', () => {
    const set = [adv('GHSA-a'), adv('GHSA-b')];
    expect(compare(set, set)).toEqual({ added: [], removed: [] });
  });

  it('ignores ordering', () => {
    const { added, removed } = compare([adv('GHSA-b'), adv('GHSA-a')], [adv('GHSA-a'), adv('GHSA-b')]);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });
});

describe('compare — a fix must be recorded', () => {
  it('flags a baseline advisory that is gone', () => {
    // Same reasoning as the file-size budgets' shrink check: an unrecorded
    // improvement quietly becomes room for a new advisory.
    const { removed } = compare([adv('GHSA-a')], [adv('GHSA-a'), adv('GHSA-fixed')]);
    expect(removed.map((a) => a.id)).toEqual(['GHSA-fixed']);
  });
});

describe('compare — the swap a count-based gate would miss', () => {
  it('catches one advisory replacing another at the same count', () => {
    // The reason this tracks identities. Both sides have two advisories, so a
    // count comparison reports "no change" while the tree has silently traded
    // a known-accepted advisory for an unreviewed one.
    const current = [adv('GHSA-a'), adv('GHSA-new')];
    const baseline = [adv('GHSA-a'), adv('GHSA-old')];
    expect(current.length).toBe(baseline.length);

    const { added, removed } = compare(current, baseline);
    expect(added.map((a) => a.id)).toEqual(['GHSA-new']);
    expect(removed.map((a) => a.id)).toEqual(['GHSA-old']);
  });
});

describe('the committed baseline is real', () => {
  it('matches the shape the gate expects', async () => {
    const baseline = (await import('../../build/audit-baseline.json', {
      with: { type: 'json' },
    })) as unknown as { default: { advisories: Array<{ id: string; module: string; severity: string }>; blessed: string } };
    const { advisories, blessed } = baseline.default;

    expect(Array.isArray(advisories)).toBe(true);
    expect(blessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Every entry gated — a moderate sneaking into the baseline would make the
    // accepted set look worse than it is and mask a real high.
    for (const a of advisories) {
      expect(['high', 'critical']).toContain(a.severity);
      expect(a.id).toBeTruthy();
      expect(a.module).toBeTruthy();
    }
  });

  it('compares clean against itself', async () => {
    const baseline = (await import('../../build/audit-baseline.json', {
      with: { type: 'json' },
    })) as unknown as { default: { advisories: Array<{ id: string }> } };
    expect(compare(baseline.default.advisories, baseline.default.advisories)).toEqual({
      added: [],
      removed: [],
    });
  });
});
