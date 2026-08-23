/**
 * What a save costs in file reads (#1836).
 *
 * Capture is awaited inside `writeFile`, so every read it does is latency the
 * user's save pays for — and autosave fires a second after every typing pause.
 * These count the actual `fs.readFile` calls rather than trusting a comment,
 * because the cost crept in the way costs do: each addition looked free.
 *
 * Awaiting is deliberate (it's the only thing serializing the read-modify-write
 * on `index.json` — see the note at the call site in `notebase/fs.ts`), so the
 * fix was to make the awaited work cheap, not to stop waiting for it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { onNoteWriting, onNoteWritten } from '../../../src/main/history';
import { listRevisions } from '../../../src/main/history/store';

describe('per-save history I/O (#1836)', () => {
  let root: string;
  const NOTE = 'notes/a.md';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-hist-io-'));
    await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  /** Simulate what `notebase/fs.writeFile` does around a save. */
  async function save(content: string): Promise<void> {
    await onNoteWriting(root, NOTE);
    await fs.writeFile(path.join(root, NOTE), content, 'utf-8');
    await onNoteWritten(root, NOTE, content);
  }

  /** Count the reads a single save performs, once history already exists.
   *  Every read on this path passes a plain string path. */
  async function readsForSave(content: string): Promise<string[]> {
    const spy = vi.spyOn(fsp, 'readFile');
    await save(content);
    const paths = spy.mock.calls.map(([target]) => (typeof target === 'string' ? target : ''));
    spy.mockRestore();
    return paths;
  }

  it('reads only the revision index on a steady-state save', async () => {
    await save('v1');
    await save('v2');

    const reads = await readsForSave('v3');

    // One read: the note's index. Not the previous snapshot (compared by
    // hash), and not a second parse of the index from the pre-write hook
    // (answered by a stat). The settings file doesn't appear here either, but
    // this environment has no `app.getPath` so it was never read — the cache
    // that removes it in the real app is pinned in settings.test.ts.
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatch(/index\.json$/);
  });

  it('decides "unchanged" without reading the previous snapshot back', async () => {
    await save('v1');
    const reads = await readsForSave('v1'); // byte-identical re-save

    expect(reads.filter((p) => p.endsWith('.snap'))).toEqual([]);
    expect(await listRevisions(root, NOTE)).toHaveLength(1); // still deduped
  });

  it('falls back to comparing content for revisions written before hashes', async () => {
    await save('v1');
    // An index from an older version: entries with no `hash`.
    const dir = path.join(root, '.minerva', 'history', NOTE);
    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    for (const entry of index) delete entry.hash;
    await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index), 'utf-8');

    // Dedupe still works — it just costs the snapshot read it used to cost.
    const reads = await readsForSave('v1');
    expect(reads.filter((p) => p.endsWith('.snap'))).toHaveLength(1);
    expect(await listRevisions(root, NOTE)).toHaveLength(1);

    // And the re-read is a one-off: the next real save writes a hashed entry.
    await save('v2');
    expect((await listRevisions(root, NOTE))[0]?.hash).toBeTruthy();
  });

  it('stores a content hash on each captured revision', async () => {
    await save('v1');
    const [rev] = await listRevisions(root, NOTE);
    expect(rev?.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
