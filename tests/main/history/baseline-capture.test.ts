/**
 * The "there is always an initial version" guarantee (#1158), exercised through
 * the real `notebase/fs` write path rather than the history store directly —
 * because the whole point is that no note write can slip past it.
 *
 * Without this, a note that pre-dates its own history (an existing thoughtbase,
 * an import, a file another tool wrote) loses its pre-edit state on the very
 * first save: the only revision captured is the edited one, and there is
 * nothing to undo back to.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFile, writeFile } from '../../../src/main/notebase/fs';
import { listRevisions, getRevisionContent } from '../../../src/main/history';

describe('initial revision (#1158)', () => {
  let root: string;
  beforeEach(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), 'minerva-baseline-')); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  const NOTE = 'notes/a.md';

  it('back-fills the pre-edit state of a note that has no history yet', async () => {
    // A note that arrived from outside the app — written straight to disk.
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, NOTE), 'the original', 'utf-8');

    await writeFile(root, NOTE, 'edited');

    const revs = await listRevisions(root, NOTE);
    expect(revs).toHaveLength(2);
    expect(revs.map((r) => r.cause)).toEqual([undefined, 'Initial version']);
    expect(revs[1]!.initial).toBe(true);
    // The state before the edit is recoverable — the point of the exercise.
    expect(await getRevisionContent(root, NOTE, revs[1]!.ts)).toBe('the original');
    expect(await getRevisionContent(root, NOTE, revs[0]!.ts)).toBe('edited');
  });

  it('back-fills only once — later saves just append', async () => {
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, NOTE), 'the original', 'utf-8');

    await writeFile(root, NOTE, 'edit 1');
    await writeFile(root, NOTE, 'edit 2');

    const revs = await listRevisions(root, NOTE);
    expect(revs).toHaveLength(3);
    expect(revs.filter((r) => r.initial)).toHaveLength(1);
  });

  it('gives a note created empty in the app an initial version straight away', async () => {
    await createFile(root, NOTE);
    const revs = await listRevisions(root, NOTE);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ cause: 'Initial version', initial: true });
    expect(await getRevisionContent(root, NOTE, revs[0]!.ts)).toBe('');
  });

  it('treats the first write of a brand-new note as the baseline itself', async () => {
    await writeFile(root, NOTE, '# From a template\n');
    const revs = await listRevisions(root, NOTE);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.initial).toBe(true);
  });

  it('leaves non-note writes alone', async () => {
    await writeFile(root, 'assets/data.csv', 'a,b\n');
    expect(await listRevisions(root, 'assets/data.csv')).toEqual([]);
  });
});
