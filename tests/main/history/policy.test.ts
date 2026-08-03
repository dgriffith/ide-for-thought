/**
 * Local per-note history — capture + retention policy (#1158). Pure logic:
 * append-only capture (dedupe identical), and pruning that respects the 30-day
 * window + per-note cap while never dropping a labeled revision.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldCapture,
  selectForRetention,
  RETENTION_DAYS,
  type RevisionMeta,
} from '../../../src/main/history/policy';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY; // arbitrary fixed "now"

describe('shouldCapture (#1158)', () => {
  it('captures when there is no prior revision', () => {
    expect(shouldCapture('hello', undefined)).toBe(true);
  });
  it('captures a changed save, skips an identical one', () => {
    expect(shouldCapture('v2', 'v1')).toBe(true);
    expect(shouldCapture('same', 'same')).toBe(false);
  });
});

describe('selectForRetention (#1158)', () => {
  const rev = (ts: number, over: Partial<RevisionMeta> = {}): RevisionMeta => ({ ts, origin: 'edit', ...over });

  it('drops revisions older than the retention window', () => {
    const fresh = rev(NOW - 1 * DAY);
    const stale = rev(NOW - (RETENTION_DAYS + 5) * DAY);
    const { kept, removed } = selectForRetention([fresh, stale], NOW);
    expect(kept.map((r) => r.ts)).toEqual([fresh.ts]);
    expect(removed.map((r) => r.ts)).toEqual([stale.ts]);
  });

  it('enforces the per-note cap, keeping the newest', () => {
    const revs = Array.from({ length: 5 }, (_, i) => rev(NOW - i * 1000));
    const { kept, removed } = selectForRetention(revs, NOW, { maxPerNote: 3 });
    expect(kept).toHaveLength(3);
    expect(removed).toHaveLength(2);
    // Kept are the three newest, newest-first.
    expect(kept.map((r) => r.ts)).toEqual([NOW, NOW - 1000, NOW - 2000]);
  });

  it('NEVER prunes a labeled revision — not by age, not by cap', () => {
    const labeledOld = rev(NOW - (RETENTION_DAYS + 100) * DAY, { label: 'v1.0' });
    const filler = Array.from({ length: 5 }, (_, i) => rev(NOW - i * 1000));
    const { kept, removed } = selectForRetention([labeledOld, ...filler], NOW, { maxPerNote: 2 });
    expect(kept.map((r) => r.ts)).toContain(labeledOld.ts); // survived age + cap
    expect(removed.map((r) => r.ts)).not.toContain(labeledOld.ts);
  });

  it('returns kept newest-first', () => {
    const revs = [rev(NOW - 2000), rev(NOW), rev(NOW - 1000)];
    const { kept } = selectForRetention(revs, NOW);
    expect(kept.map((r) => r.ts)).toEqual([NOW, NOW - 1000, NOW - 2000]);
  });
});
