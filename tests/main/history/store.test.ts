/**
 * Local per-note history STORE (#1158) — disk round-trips against a temp vault:
 * append + dedupe, list newest-first, read a revision, prune to retention,
 * history-follows-rename, and labeled-survives-prune.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  captureSnapshot,
  ensureInitialRevision,
  listRevisions,
  getRevisionContent,
  moveHistory,
  setRevisionLabel,
} from '../../../src/main/history/store';

const DAY = 24 * 60 * 60 * 1000;

describe('history store (#1158)', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-hist-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const NOTE = 'notes/a.md';

  it('appends a revision and stores it under .minerva/history', async () => {
    await captureSnapshot(root, NOTE, 'v1', { origin: 'edit' }, 1000);
    const revs = await listRevisions(root, NOTE);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.origin).toBe('edit');
    // Lives under the gitignored .minerva/history mirror of the note path.
    const dir = path.join(root, '.minerva', 'history', 'notes', 'a.md');
    expect((await fs.readdir(dir)).some((f) => f.endsWith('.snap'))).toBe(true);
  });

  it('records the cause alongside the origin, and omits it for a plain edit', async () => {
    await captureSnapshot(root, NOTE, 'v1', { origin: 'proposal', cause: 'Antithesize' }, 1000);
    await captureSnapshot(root, NOTE, 'v2', { origin: 'edit' }, 2000);
    const revs = await listRevisions(root, NOTE);
    expect(revs.map((r) => r.cause)).toEqual([undefined, 'Antithesize']);
  });

  it('marks the first revision of a note as its baseline', async () => {
    await captureSnapshot(root, NOTE, 'v1', { origin: 'edit' }, 1000);
    await captureSnapshot(root, NOTE, 'v2', { origin: 'edit' }, 2000);
    const revs = await listRevisions(root, NOTE);
    expect(revs.map((r) => r.initial)).toEqual([undefined, true]);
  });

  it('dedupes an identical consecutive save', async () => {
    await captureSnapshot(root, NOTE, 'same', { origin: 'edit' }, 1000);
    const second = await captureSnapshot(root, NOTE, 'same', { origin: 'edit' }, 2000);
    expect(second).toBeNull();
    expect(await listRevisions(root, NOTE)).toHaveLength(1);
  });

  it('lists revisions newest-first and reads each one back', async () => {
    await captureSnapshot(root, NOTE, 'v1', { origin: 'edit' }, 1000);
    await captureSnapshot(root, NOTE, 'v2', { origin: 'edit' }, 2000);
    await captureSnapshot(root, NOTE, 'v3', { origin: 'restore' }, 3000);
    const revs = await listRevisions(root, NOTE);
    expect(revs.map((r) => r.ts)).toEqual([3000, 2000, 1000]);
    expect(await getRevisionContent(root, NOTE, 1000)).toBe('v1');
    expect(await getRevisionContent(root, NOTE, 3000)).toBe('v3');
    expect(await getRevisionContent(root, NOTE, 999)).toBeNull();
  });

  it('prunes revisions older than the retention window on capture', async () => {
    const now = 500 * DAY;
    const baseTs = now - 50 * DAY;
    const ancientTs = now - 40 * DAY;
    // Baseline, an "old" capture, then a fresh one far later → the middle one
    // ages out. (The baseline is exempt — see the next test.)
    await captureSnapshot(root, NOTE, 'base', { origin: 'edit' }, baseTs);
    await captureSnapshot(root, NOTE, 'ancient', { origin: 'edit' }, ancientTs);
    await captureSnapshot(root, NOTE, 'fresh', { origin: 'edit' }, now);
    const revs = await listRevisions(root, NOTE);
    expect(revs.map((r) => r.ts)).toEqual([now, baseTs]);
    // The pruned snapshot file is gone too.
    expect(await getRevisionContent(root, NOTE, ancientTs)).toBeNull();
  });

  it('keeps the baseline revision however old it gets — "back to the start" must stay reachable', async () => {
    const now = 500 * DAY;
    const baseTs = now - 400 * DAY;
    await captureSnapshot(root, NOTE, 'the original', { origin: 'edit' }, baseTs);
    await captureSnapshot(root, NOTE, 'fresh', { origin: 'edit' }, now);
    expect(await getRevisionContent(root, NOTE, baseTs)).toBe('the original');
  });

  it('keeps a labeled revision even when it would otherwise age out', async () => {
    const now = 500 * DAY;
    const oldTs = now - 40 * DAY;
    // A baseline first, so the labeled revision isn't exempt just for being
    // the note's first.
    await captureSnapshot(root, NOTE, 'base', { origin: 'edit' }, now - 50 * DAY);
    await captureSnapshot(root, NOTE, 'milestone', { origin: 'edit' }, oldTs);
    await setRevisionLabel(root, NOTE, oldTs, 'v1.0');
    await captureSnapshot(root, NOTE, 'fresh', { origin: 'edit' }, now);
    const revs = await listRevisions(root, NOTE);
    expect(revs.map((r) => r.ts)).toContain(oldTs); // labeled survived
    expect(await getRevisionContent(root, NOTE, oldTs)).toBe('milestone');
  });

  it('history follows a note rename', async () => {
    await captureSnapshot(root, NOTE, 'v1', { origin: 'edit' }, 1000);
    await moveHistory(root, NOTE, 'archive/a.md');
    expect(await listRevisions(root, NOTE)).toHaveLength(0);       // old path empty
    expect((await listRevisions(root, 'archive/a.md')).map((r) => r.ts)).toEqual([1000]);
    expect(await getRevisionContent(root, 'archive/a.md', 1000)).toBe('v1');
  });

  it('a folder-style move relocates every contained note (path-parallel mirror)', async () => {
    await captureSnapshot(root, 'notes/a.md', 'a1', { origin: 'edit' }, 1000);
    await captureSnapshot(root, 'notes/b.md', 'b1', { origin: 'edit' }, 1000);
    await moveHistory(root, 'notes', 'archive'); // move the whole folder's history
    expect(await getRevisionContent(root, 'archive/a.md', 1000)).toBe('a1');
    expect(await getRevisionContent(root, 'archive/b.md', 1000)).toBe('b1');
  });
});

describe('ensureInitialRevision (#1158)', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-hist-init-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const NOTE = 'notes/a.md';

  async function writeNote(content: string, mtime?: number): Promise<void> {
    await fs.mkdir(path.join(root, 'notes'), { recursive: true });
    await fs.writeFile(path.join(root, NOTE), content, 'utf-8');
    if (mtime !== undefined) {
      const when = new Date(mtime);
      await fs.utimes(path.join(root, NOTE), when, when);
    }
  }

  it('captures what is on disk as the baseline, stamped with the file mtime', async () => {
    const mtime = 5_000_000;
    await writeNote('the original', mtime);
    const meta = await ensureInitialRevision(root, NOTE, mtime + 10_000);

    expect(meta).toMatchObject({ ts: mtime, cause: 'Initial version', initial: true });
    expect(await getRevisionContent(root, NOTE, mtime)).toBe('the original');
  });

  it('no-ops once the note has any history — the baseline is captured once', async () => {
    await writeNote('the original');
    await captureSnapshot(root, NOTE, 'already recorded', { origin: 'edit' }, 1000);
    expect(await ensureInitialRevision(root, NOTE)).toBeNull();
    expect(await listRevisions(root, NOTE)).toHaveLength(1);
  });

  it('no-ops for a note that does not exist yet — the write that follows is the baseline', async () => {
    expect(await ensureInitialRevision(root, 'notes/brand-new.md')).toBeNull();
    expect(await listRevisions(root, 'notes/brand-new.md')).toEqual([]);
  });

  it('keeps the baseline strictly before the write that follows, even with a future mtime', async () => {
    const now = 5_000_000;
    await writeNote('the original', now + 60_000); // clock skew / copied file
    const meta = await ensureInitialRevision(root, NOTE, now);
    expect(meta!.ts).toBe(now - 1);
  });
});
