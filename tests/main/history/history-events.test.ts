/**
 * History change events (#1834) — the Electron-free pub/sub the renderer's
 * store rides on.
 *
 * The panel used to poll on a 700 ms timer because main had no way to say "a
 * revision was captured". These pin that the emit happens on every path that
 * changes a note's history, and *only* when something actually changed — a
 * no-op re-save that emitted would put the panel back to repainting on a
 * timer, with extra steps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  captureSnapshot,
  setRevisionLabel,
  pruneAllHistory,
} from '../../../src/main/history/store';
import { onHistoryChanged } from '../../../src/main/history/history-events';

describe('history events (#1834)', () => {
  let root: string;
  let seen: Array<[string, string | null]>;
  let unsubscribe: () => void;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-hist-events-'));
    seen = [];
    unsubscribe = onHistoryChanged((rootPath, relPath) => { seen.push([rootPath, relPath]); });
  });
  afterEach(async () => {
    unsubscribe();
    await fs.rm(root, { recursive: true, force: true });
  });

  const NOTE = 'notes/a.md';

  it('announces a capture', async () => {
    await captureSnapshot(root, NOTE, 'v1', { origin: 'edit' }, 1000);
    expect(seen).toEqual([[root, NOTE]]);
  });

  it('stays quiet when nothing was captured', async () => {
    await captureSnapshot(root, NOTE, 'same', { origin: 'edit' }, 1000);
    seen.length = 0;
    // Byte-identical re-save: no new revision, so nothing to announce.
    await captureSnapshot(root, NOTE, 'same', { origin: 'edit' }, 2000);
    expect(seen).toEqual([]);
  });

  it('announces a label change, so a second window sees the name appear', async () => {
    await captureSnapshot(root, NOTE, 'v1', { origin: 'edit' }, 1000);
    seen.length = 0;
    await setRevisionLabel(root, NOTE, 1000, 'before refactor');
    expect(seen).toEqual([[root, NOTE]]);
  });

  it('announces a prune sweep with a null path — many notes at once', async () => {
    for (let i = 1; i <= 4; i++) {
      await captureSnapshot(root, NOTE, `v${i}`, { origin: 'edit' }, 1000 * i, {
        retentionDays: 3650, maxRevisionsPerNote: 500, maxFileSizeKb: 0,
      });
    }
    seen.length = 0;
    await pruneAllHistory(root, 5000, { retentionDays: 3650, maxRevisionsPerNote: 1, maxFileSizeKb: 0 });
    expect(seen).toEqual([[root, null]]);
  });

  it('stays quiet when a sweep removed nothing', async () => {
    await captureSnapshot(root, NOTE, 'v1', { origin: 'edit' }, 1000);
    seen.length = 0;
    await pruneAllHistory(root, 2000, { retentionDays: 3650, maxRevisionsPerNote: 500, maxFileSizeKb: 0 });
    expect(seen).toEqual([]);
  });

  it('survives a listener that throws — history must not break a save', async () => {
    const boom = onHistoryChanged(() => { throw new Error('listener exploded'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(captureSnapshot(root, NOTE, 'v1', { origin: 'edit' }, 1000)).resolves.not.toBeNull();
      expect(seen).toEqual([[root, NOTE]]); // the good listener still ran
    } finally {
      warn.mockRestore();
      boom();
    }
  });
});
