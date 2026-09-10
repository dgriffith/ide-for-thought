/**
 * Client-side revert preview (#2092) — pure bucketing over an already-loaded
 * `UnifiedTimelineEntry[]`, approximating the five `BatchRevertResult`
 * buckets from metadata alone so the dialog can show "here's what will
 * happen" before the real (authoritative) `batchRevertToPointInTime` runs.
 */
import { describe, it, expect } from 'vitest';
import { previewRevert } from '../../../src/renderer/lib/history/multi-file-preview';
import type { UnifiedTimelineEntry } from '../../../src/shared/history';

function entry(path: string, ts: number, origin: UnifiedTimelineEntry['origin'], event: UnifiedTimelineEntry['event']): UnifiedTimelineEntry {
  return { path, ts, origin, event };
}

describe('previewRevert (#2092)', () => {
  it('reverted: present both then and now, at a different revision', () => {
    const timeline = [
      entry('a.md', 200, 'edit', 'modified'),
      entry('a.md', 100, 'edit', 'added'),
    ];
    expect(previewRevert(timeline, 100)).toEqual([{ path: 'a.md', bucket: 'reverted' }]);
  });

  it('unchanged: target revision is already the latest present revision', () => {
    const timeline = [
      entry('a.md', 200, 'edit', 'modified'),
      entry('a.md', 100, 'edit', 'added'),
    ];
    expect(previewRevert(timeline, 200)).toEqual([{ path: 'a.md', bucket: 'unchanged' }]);
  });

  it('recreated: existed then, currently deleted', () => {
    const timeline = [
      entry('a.md', 200, 'delete', 'deleted'),
      entry('a.md', 100, 'edit', 'added'),
    ];
    expect(previewRevert(timeline, 100)).toEqual([{ path: 'a.md', bucket: 'recreated' }]);
  });

  it('unchanged: deleted then, still deleted now', () => {
    const timeline = [
      entry('a.md', 200, 'delete', 'deleted'),
      entry('a.md', 100, 'edit', 'added'),
    ];
    expect(previewRevert(timeline, 200)).toEqual([{ path: 'a.md', bucket: 'unchanged' }]);
  });

  it('removed: did not exist yet at the target moment, exists now', () => {
    const timeline = [entry('a.md', 200, 'edit', 'added')];
    expect(previewRevert(timeline, 100)).toEqual([{ path: 'a.md', bucket: 'removed' }]);
  });

  it('removed: deleted at the target moment (before it existed again), present now', () => {
    const timeline = [
      entry('a.md', 300, 'edit', 'added'),
      entry('a.md', 200, 'delete', 'deleted'),
      entry('a.md', 100, 'edit', 'added'),
    ];
    expect(previewRevert(timeline, 200)).toEqual([{ path: 'a.md', bucket: 'removed' }]);
  });

  it('skipped: absent at the target moment and currently deleted', () => {
    const timeline = [
      entry('a.md', 200, 'delete', 'deleted'),
      entry('a.md', 100, 'edit', 'added'),
    ];
    expect(previewRevert(timeline, 50)).toEqual([{ path: 'a.md', bucket: 'skipped' }]);
  });

  it('buckets each path independently and sorts by path', () => {
    const timeline = [
      entry('b.md', 100, 'edit', 'added'),
      entry('a.md', 200, 'delete', 'deleted'),
      entry('a.md', 100, 'edit', 'added'),
    ];
    expect(previewRevert(timeline, 100)).toEqual([
      { path: 'a.md', bucket: 'recreated' },
      { path: 'b.md', bucket: 'unchanged' },
    ]);
  });
});
