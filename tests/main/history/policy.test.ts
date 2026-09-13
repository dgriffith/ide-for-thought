/**
 * Local per-note history — capture + retention policy (#1158). Pure logic:
 * append-only capture (dedupe identical), and pruning that respects the 30-day
 * window + per-note cap while never dropping a labeled or initial revision.
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

  it('compacts the initial revision once it ages out — the row survives, the content does not (#2167)', () => {
    // Unlike label/delete, initial's content is not a forever-exemption: only
    // its ROW is (so the timeline still shows when the note first appeared).
    // A large cap isolates this as a pure age-driven case.
    const baseline = rev(NOW - (RETENTION_DAYS + 100) * DAY, { initial: true });
    const filler = Array.from({ length: 5 }, (_, i) => rev(NOW - i * 1000));
    const { kept, compacted, removed } = selectForRetention([baseline, ...filler], NOW, { maxPerNote: 10 });
    expect(kept.map((r) => r.ts)).not.toContain(baseline.ts);
    expect(removed.map((r) => r.ts)).not.toContain(baseline.ts);
    expect(compacted.map((r) => r.ts)).toEqual([baseline.ts]);
  });

  it('keeps a fresh initial revision fully intact when neither age nor cap force it out', () => {
    const baseline = rev(NOW - 1 * DAY, { initial: true });
    const filler = [rev(NOW)];
    const { kept, compacted, removed } = selectForRetention([baseline, ...filler], NOW, { maxPerNote: 5 });
    expect(kept.map((r) => r.ts).sort()).toEqual([baseline.ts, filler[0]!.ts].sort());
    expect(compacted).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('an initial revision never consumes a slot in the per-note cap, but is not exempt from cap-driven content aging either', () => {
    const baseline = rev(NOW - 5000, { initial: true });
    const filler = Array.from({ length: 3 }, (_, i) => rev(NOW - i * 1000)); // exactly fills the cap
    const { kept, compacted, removed } = selectForRetention([baseline, ...filler], NOW, { maxPerNote: 3 });
    // All 3 filler survive with content — the baseline didn't crowd one out.
    expect(kept.map((r) => r.ts).sort()).toEqual(filler.map((r) => r.ts).sort());
    // But its own content ages out once the cap is already full, the same as
    // it would for an ordinary revision competing for those slots.
    expect(compacted.map((r) => r.ts)).toEqual([baseline.ts]);
    expect(removed).toHaveLength(0);
  });

  it('NEVER prunes a delete marker — not by age, not by cap (#2089)', () => {
    // A pruned delete marker would make a later "as of T" query silently claim
    // the note still exists at moments after it was actually removed.
    const deleteMarker = rev(NOW - (RETENTION_DAYS + 100) * DAY, { origin: 'delete' });
    const filler = Array.from({ length: 5 }, (_, i) => rev(NOW - i * 1000));
    const { kept, removed } = selectForRetention([deleteMarker, ...filler], NOW, { maxPerNote: 2 });
    expect(kept.map((r) => r.ts)).toContain(deleteMarker.ts);
    expect(removed.map((r) => r.ts)).not.toContain(deleteMarker.ts);
  });

  it('a delete marker does not consume a slot in the per-note cap', () => {
    const deleteMarker = rev(NOW, { origin: 'delete' });
    const filler = Array.from({ length: 3 }, (_, i) => rev(NOW - (i + 1) * 1000));
    const { kept, removed } = selectForRetention([deleteMarker, ...filler], NOW, { maxPerNote: 3 });
    // All 3 filler revisions fit under the cap — the marker doesn't crowd one out.
    expect(kept).toHaveLength(4);
    expect(removed).toHaveLength(0);
  });

  it('returns kept newest-first', () => {
    const revs = [rev(NOW - 2000), rev(NOW), rev(NOW - 1000)];
    const { kept } = selectForRetention(revs, NOW);
    expect(kept.map((r) => r.ts)).toEqual([NOW, NOW - 1000, NOW - 2000]);
  });
});
