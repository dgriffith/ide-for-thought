/**
 * The revision source is ASYNC-SCOPED, not a module variable (#1833).
 *
 * Six call sites wrap await-heavy writes in `runWithHistorySource`, nothing in
 * main serializes them, and each window carries its own project — so two of
 * them can be in flight at once. The old save-and-restore-a-module-var design
 * was correct only for strictly LIFO nesting; every assertion below fails
 * against it.
 *
 * Failure modes being pinned:
 *  - a write inside scope A, after a concurrent scope B set the variable, was
 *    recorded with B's cause (mislabeling);
 *  - when A finished before B, B's `finally` restored A's value, leaving the
 *    module var permanently set with no scope active — every later plain save
 *    was then filed as an AI proposal (the durable corruption).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithHistorySource, onNoteWritten, listRevisions } from '../../../src/main/history';

/** A promise plus its resolver, so a test can hold a scope open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('history source is async-scoped (#1833)', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-hist-async-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  /** Write a note and let the capture hook record it under the ambient source. */
  async function write(relPath: string, content: string): Promise<void> {
    await fs.mkdir(path.join(root, path.dirname(relPath)), { recursive: true });
    await fs.writeFile(path.join(root, relPath), content, 'utf-8');
    await onNoteWritten(root, relPath, content);
  }

  async function causeOf(relPath: string): Promise<string | undefined> {
    return (await listRevisions(root, relPath))[0]?.cause;
  }

  async function originOf(relPath: string): Promise<string | undefined> {
    return (await listRevisions(root, relPath))[0]?.origin;
  }

  it('keeps each concurrent scope on its own source', async () => {
    const holdA = deferred();
    const holdB = deferred();

    // Scope A opens first and stays open across B's whole lifetime.
    const a = runWithHistorySource({ origin: 'proposal', cause: 'Antithesize' }, async () => {
      await write('notes/a1.md', 'from A, before B');
      await holdA.promise;
      // Still inside A — but B has come and gone in the meantime.
      await write('notes/a2.md', 'from A, after B');
    });

    // Scope B opens and closes while A is parked.
    const b = runWithHistorySource({ origin: 'edit', cause: 'Bibliography' }, async () => {
      await write('notes/b1.md', 'from B');
      await holdB.promise;
    });

    // Finish B first, then let A continue: the non-LIFO order the old design
    // could not survive.
    holdB.resolve();
    await b;
    holdA.resolve();
    await a;

    expect(await causeOf('notes/a1.md')).toBe('Antithesize');
    expect(await causeOf('notes/b1.md')).toBe('Bibliography');
    // The write that used to be mislabeled: still inside A, after B ran.
    expect(await causeOf('notes/a2.md')).toBe('Antithesize');

  });

  it('leaves no source behind when the outer scope exits first', async () => {
    // The durable-corruption ordering, and the reason this is a correctness bug
    // rather than a cosmetic one. Old behaviour: A saves the default and sets X;
    // B saves X and sets Y; A exits and restores the default; B exits and
    // restores *X*. The module var is now X with no scope active, so every
    // later plain save is filed as someone else's AI proposal — permanently.
    const holdA = deferred();
    const holdB = deferred();

    const a = runWithHistorySource({ origin: 'proposal', cause: 'Antithesize' }, async () => {
      await write('notes/a.md', 'from A');
      await holdA.promise;
    });
    const b = runWithHistorySource({ origin: 'edit', cause: 'Bibliography' }, async () => {
      await write('notes/b.md', 'from B');
      await holdB.promise;
    });

    holdA.resolve();
    await a;
    holdB.resolve();
    await b;

    // A plain save is a plain edit, not whichever scope happened to exit last.
    await write('notes/plain.md', 'just typing');
    expect(await causeOf('notes/plain.md')).toBeUndefined();
    expect(await originOf('notes/plain.md')).toBe('edit');
  });

  it('leaves no source behind when a scope throws', async () => {
    await expect(
      runWithHistorySource({ origin: 'restore', cause: 'Restored from earlier' }, async () => {
        await write('notes/restored.md', 'put back');
        throw new Error('write pipeline blew up');
      }),
    ).rejects.toThrow('write pipeline blew up');

    expect(await causeOf('notes/restored.md')).toBe('Restored from earlier');
    await write('notes/after-throw.md', 'just typing');
    expect(await originOf('notes/after-throw.md')).toBe('edit');
  });

  it('nests, so an inner scope wins for its own writes and the outer resumes', async () => {
    await runWithHistorySource({ origin: 'proposal', cause: 'Auto-tag' }, async () => {
      await write('notes/outer-first.md', 'outer');
      await runWithHistorySource({ origin: 'edit', cause: 'Bibliography' }, async () => {
        await write('notes/inner.md', 'inner');
      });
      await write('notes/outer-second.md', 'outer again');
    });

    expect(await causeOf('notes/outer-first.md')).toBe('Auto-tag');
    expect(await causeOf('notes/inner.md')).toBe('Bibliography');
    expect(await causeOf('notes/outer-second.md')).toBe('Auto-tag');
  });
});
