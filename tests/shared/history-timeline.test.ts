/**
 * Unified multi-file history primitives (#2090): per-revision event
 * classification, and resolving a note's state as of a moment in time — the
 * shared building block both the unified timeline and batch point-in-time
 * revert (#2091) need. Pure — no I/O.
 */
import { describe, it, expect } from 'vitest';
import { classifyHistoryEvent, resolveAsOf } from '../../src/shared/history';

describe('classifyHistoryEvent (#2090)', () => {
  it('classifies a delete marker as deleted, regardless of other fields', () => {
    expect(classifyHistoryEvent({ origin: 'delete' })).toBe('deleted');
    expect(classifyHistoryEvent({ origin: 'delete', initial: true })).toBe('deleted');
  });

  it('classifies the baseline revision as added', () => {
    expect(classifyHistoryEvent({ origin: 'edit', initial: true })).toBe('added');
  });

  it('classifies everything else as modified', () => {
    expect(classifyHistoryEvent({ origin: 'edit' })).toBe('modified');
    expect(classifyHistoryEvent({ origin: 'restore' })).toBe('modified');
    expect(classifyHistoryEvent({ origin: 'proposal' })).toBe('modified');
  });

  it('a note recreated after deletion classifies its next save as modified, not added again', () => {
    // The baseline stays whichever revision was first — recreation doesn't
    // get its own "added" event without cross-revision context, which this
    // function deliberately doesn't have (it only sees one revision).
    expect(classifyHistoryEvent({ origin: 'edit', initial: false })).toBe('modified');
  });
});

describe('resolveAsOf (#2090)', () => {
  const rev = (ts: number, origin: 'edit' | 'delete' = 'edit') => ({ ts, origin });

  it('is absent before the note existed', () => {
    expect(resolveAsOf([rev(1000)], 500)).toBe('absent');
  });

  it('is absent for an empty revision list', () => {
    expect(resolveAsOf([], 1000)).toBe('absent');
  });

  it('is present at the exact moment of a revision', () => {
    expect(resolveAsOf([rev(1000)], 1000)).toEqual({ kind: 'present', ts: 1000 });
  });

  it('resolves to the most recent revision at or before t, not the nearest overall', () => {
    const entries = [rev(1000), rev(2000), rev(4000)];
    expect(resolveAsOf(entries, 3000)).toEqual({ kind: 'present', ts: 2000 });
  });

  it('is deleted when the most recent revision at or before t is a delete marker', () => {
    const entries = [rev(1000), rev(2000, 'delete')];
    expect(resolveAsOf(entries, 3000)).toBe('deleted');
    expect(resolveAsOf(entries, 2000)).toBe('deleted');
  });

  it('is present again if the note was recreated after that delete', () => {
    const entries = [rev(1000), rev(2000, 'delete'), rev(3000)];
    expect(resolveAsOf(entries, 1500)).toEqual({ kind: 'present', ts: 1000 });
    expect(resolveAsOf(entries, 2500)).toBe('deleted');
    expect(resolveAsOf(entries, 3000)).toEqual({ kind: 'present', ts: 3000 });
  });

  it('does not depend on input order', () => {
    const entries = [rev(3000), rev(1000), rev(2000)];
    expect(resolveAsOf(entries, 2500)).toEqual({ kind: 'present', ts: 2000 });
  });
});
