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
import { writeFile, deleteFile } from '../../../src/main/notebase/fs';
import { resolveOrphanedTargets, listNoteHistoryTimeline } from '../../../src/main/notebase/multi-file-history';

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
});
