/**
 * Multi-file/directory local history read path (#2090). Real temp
 * thoughtbase — writes/deletes notes via the real `notebase/fs.ts` +
 * `history` modules so the merged timeline is exercised end-to-end, not
 * against mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeFile, deleteFile, readFile } from '../../../src/main/notebase/fs';
import { resolveOrphanedTargets, listNoteHistoryTimeline, batchRevertToPointInTime } from '../../../src/main/notebase/multi-file-history';
import { initGraph } from '../../../src/main/graph/index';
import { initSearch } from '../../../src/main/search/index';
import { listRevisions, captureSnapshot } from '../../../src/main/history/store';
import { projectContext } from '../../../src/main/project-context-types';
import { formatDateTime } from '../../../src/shared/format-datetime';
import type { WritePipelineHooks } from '../../../src/main/notebase/write-pipeline';

function makeHooks(): WritePipelineHooks {
  return {
    markPathHandled: () => {},
    broadcastRewritten: () => {},
    broadcastHeadingRename: () => {},
  };
}

describe('multi-file history (#2090)', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-multi-hist-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  describe('resolveOrphanedTargets', () => {
    it('finds an orphan under a selected directory root', async () => {
      await writeFile(root, 'notes/gone.md', 'v1');
      await deleteFile(root, 'notes/gone.md');

      const orphaned = await resolveOrphanedTargets(root, [{ relativePath: 'notes', isDirectory: true }]);
      expect(orphaned).toEqual(['notes/gone.md']);
    });

    it('ignores file selection roots — a live tree never lists an orphan as a file', async () => {
      await writeFile(root, 'notes/a.md', 'v1');
      const orphaned = await resolveOrphanedTargets(root, [{ relativePath: 'notes/a.md', isDirectory: false }]);
      expect(orphaned).toEqual([]);
    });

    it('dedupes an orphan reachable from two overlapping directory roots', async () => {
      await writeFile(root, 'notes/sub/gone.md', 'v1');
      await deleteFile(root, 'notes/sub/gone.md');

      const orphaned = await resolveOrphanedTargets(root, [
        { relativePath: 'notes', isDirectory: true },
        { relativePath: 'notes/sub', isDirectory: true },
      ]);
      expect(orphaned).toEqual(['notes/sub/gone.md']);
    });

    it('returns an empty array when nothing is orphaned', async () => {
      await writeFile(root, 'notes/a.md', 'v1');
      expect(await resolveOrphanedTargets(root, [{ relativePath: 'notes', isDirectory: true }])).toEqual([]);
    });
  });

  describe('listNoteHistoryTimeline', () => {
    it('merges live paths and orphaned paths under the selection into one sorted timeline', async () => {
      await writeFile(root, 'notes/a.md', 'v1');
      await writeFile(root, 'notes/gone.md', 'v1');
      await deleteFile(root, 'notes/gone.md');

      // Renderer already expanded the live tree to notes/a.md; notes/gone.md
      // no longer appears there at all — only the orphan search finds it.
      const timeline = await listNoteHistoryTimeline(
        root,
        ['notes/a.md'],
        [{ relativePath: 'notes', isDirectory: true }],
      );

      const paths = timeline.map((e) => e.path);
      expect(paths).toContain('notes/a.md');
      expect(paths).toContain('notes/gone.md');
      // Newest-first across both notes' merged logs.
      expect(timeline).toEqual([...timeline].sort((a, b) => b.ts - a.ts));
    });

    it('classifies events per revision — added/modified/deleted', async () => {
      await writeFile(root, 'notes/a.md', 'v1');
      await writeFile(root, 'notes/a.md', 'v2');
      await deleteFile(root, 'notes/a.md');

      const timeline = await listNoteHistoryTimeline(root, [], [{ relativePath: '.', isDirectory: true }]);
      const events = timeline.filter((e) => e.path === 'notes/a.md').map((e) => e.event);
      // Newest-first: delete, then the v2 edit, then the v1 baseline.
      expect(events).toEqual(['deleted', 'modified', 'added']);
    });

    it('does not duplicate a path that is both live-listed and independently orphaned', async () => {
      await writeFile(root, 'notes/a.md', 'v1');
      const timeline = await listNoteHistoryTimeline(
        root,
        ['notes/a.md'],
        [{ relativePath: 'notes', isDirectory: true }], // notes/a.md is live, not orphaned — no double-count regardless
      );
      expect(timeline.filter((e) => e.path === 'notes/a.md')).toHaveLength(1);
    });

    it('a corrupt index for one note does not blank the merged view', async () => {
      await writeFile(root, 'notes/a.md', 'v1');
      await writeFile(root, 'notes/broken.md', 'v1');
      await fs.writeFile(path.join(root, '.minerva/history/notes/broken.md/index.json'), 'not json', 'utf-8');

      const timeline = await listNoteHistoryTimeline(root, ['notes/a.md', 'notes/broken.md'], []);
      expect(timeline.map((e) => e.path)).toEqual(['notes/a.md']);
    });

    it('returns an empty timeline for an empty selection', async () => {
      expect(await listNoteHistoryTimeline(root, [], [])).toEqual([]);
    });
  });

  describe('batchRevertToPointInTime (#2091)', () => {
    let ctx: ReturnType<typeof projectContext>;
    beforeEach(async () => {
      ctx = projectContext(root);
      await initGraph(ctx);
      await initSearch(ctx);
    });

    it('reverted: existed then and now, content differs — written back', async () => {
      await writeFile(root, 'a.md', 'v1');
      const [{ ts: ts1 }] = await listRevisions(root, 'a.md');
      await writeFile(root, 'a.md', 'v2');

      const result = await batchRevertToPointInTime(root, ['a.md'], [], ts1, makeHooks());

      expect(result.reverted).toEqual(['a.md']);
      expect(await readFile(root, 'a.md')).toBe('v1');
    });

    it('recreated: existed then, deleted since — undeleted', async () => {
      await writeFile(root, 'a.md', 'v1');
      const [{ ts: ts1 }] = await listRevisions(root, 'a.md');
      await deleteFile(root, 'a.md');

      const result = await batchRevertToPointInTime(root, [], [{ relativePath: '.', isDirectory: true }], ts1, makeHooks());

      expect(result.recreated).toEqual(['a.md']);
      expect(await readFile(root, 'a.md')).toBe('v1');
    });

    it('removed: did not exist yet at the target moment, exists now — deleted to match', async () => {
      const before = Date.now() - 10_000;
      await writeFile(root, 'a.md', 'v1'); // created AFTER `before`

      const result = await batchRevertToPointInTime(root, ['a.md'], [], before, makeHooks());

      expect(result.removed).toEqual(['a.md']);
      await expect(fs.access(path.join(root, 'a.md'))).rejects.toThrow();
    });

    it('a live note with NO recorded history is removed when reverted to any past moment (documented gap, not a bug)', async () => {
      // Written directly to disk, never through the app — no history captured.
      await fs.writeFile(path.join(root, 'external.md'), 'never tracked', 'utf-8');
      const result = await batchRevertToPointInTime(root, ['external.md'], [], Date.now() - 10_000, makeHooks());
      expect(result.removed).toEqual(['external.md']);
    });

    it('unchanged: target content already matches what is on disk', async () => {
      await writeFile(root, 'a.md', 'v1');
      const [{ ts: ts1 }] = await listRevisions(root, 'a.md');

      const result = await batchRevertToPointInTime(root, ['a.md'], [], ts1, makeHooks());
      expect(result.unchanged).toEqual(['a.md']);
    });

    it('unchanged: already deleted at the target moment, and still gone now', async () => {
      await writeFile(root, 'a.md', 'v1');
      await deleteFile(root, 'a.md');
      const revs = await listRevisions(root, 'a.md');
      const deleteMarkerTs = revs.find((r) => r.origin === 'delete')!.ts;

      const result = await batchRevertToPointInTime(root, [], [{ relativePath: '.', isDirectory: true }], deleteMarkerTs, makeHooks());
      expect(result.unchanged).toEqual(['a.md']);
    });

    it('skipped: no history reaching back to the target moment, and does not exist now either', async () => {
      await writeFile(root, 'a.md', 'v1');
      await deleteFile(root, 'a.md'); // orphaned — findable via the directory root
      const longBefore = Date.now() - 100_000;

      const result = await batchRevertToPointInTime(root, [], [{ relativePath: '.', isDirectory: true }], longBefore, makeHooks());
      expect(result.skipped).toEqual(['a.md']);
    });

    it('a bad path is reported per-item without aborting the rest of the selection', async () => {
      await writeFile(root, 'good.md', 'v1');
      const [{ ts: ts1 }] = await listRevisions(root, 'good.md');
      await writeFile(root, 'good.md', 'v2');
      // Corrupt bad.md's index so listRevisions throws for it.
      await writeFile(root, 'bad.md', 'v1');
      await fs.writeFile(path.join(root, '.minerva/history/bad.md/index.json'), 'not json', 'utf-8');

      const result = await batchRevertToPointInTime(root, ['good.md', 'bad.md'], [], ts1, makeHooks());

      expect(result.reverted).toEqual(['good.md']);
      expect(result.errors).toEqual([{ path: 'bad.md', error: expect.any(String) }]);
    });

    it('per-path runWithHistorySource scoping: two concurrent batch reverts do not swap causes (#1833)', async () => {
      // Explicit, widely-separated timestamps (years apart) via captureSnapshot
      // directly — formatDateTime is minute-precision, so two REAL writes a
      // few milliseconds apart in a fast test could format identically and
      // make this assertion pass vacuously regardless of correctness.
      const tsA = Date.UTC(2020, 0, 1, 12, 0);
      const tsB = Date.UTC(2024, 6, 15, 9, 30);
      await captureSnapshot(root, 'a.md', 'a-v1', { origin: 'edit' }, tsA);
      await captureSnapshot(root, 'a.md', 'a-v2', { origin: 'edit' }, tsA + 60_000);
      await captureSnapshot(root, 'b.md', 'b-v1', { origin: 'edit' }, tsB);
      await captureSnapshot(root, 'b.md', 'b-v2', { origin: 'edit' }, tsB + 60_000);
      await fs.writeFile(path.join(root, 'a.md'), 'a-v2', 'utf-8');
      await fs.writeFile(path.join(root, 'b.md'), 'b-v2', 'utf-8');

      // Two distinct target moments (distinct cause strings via formatDateTime)
      // reverting two DIFFERENT notes, concurrently — a shared/hoisted source
      // instead of per-item AsyncLocalStorage scoping would let one call's
      // cause bleed into the other's write.
      await Promise.all([
        batchRevertToPointInTime(root, ['a.md'], [], tsA, makeHooks()),
        batchRevertToPointInTime(root, ['b.md'], [], tsB, makeHooks()),
      ]);

      const aRevs = await listRevisions(root, 'a.md');
      const bRevsAfter = await listRevisions(root, 'b.md');
      expect(formatDateTime(tsA)).not.toBe(formatDateTime(tsB)); // sanity: the test can actually distinguish them
      expect(aRevs[0]!.cause).toBe(`Reverted to ${formatDateTime(tsA)} (batch)`);
      expect(bRevsAfter[0]!.cause).toBe(`Reverted to ${formatDateTime(tsB)} (batch)`);
    });
  });
});
