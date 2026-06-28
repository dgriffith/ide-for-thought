import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { planRename, renameWithLinkRewrites, RefactorError } from '../../../src/main/notebase/rename';
import { initGraph, indexNote, disposeProject } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';

let root: string;
const ctx = () => projectContext(root);

async function write(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plan-rename-'));
  await initGraph(ctx());
});
afterEach(async () => {
  disposeProject(ctx());
  await fsp.rm(root, { recursive: true, force: true });
});

describe('planRename', () => {
  it('reports the inbound wiki-link rewrite without writing anything', async () => {
    await write('raft.md', '# Raft\n\nbody');
    await write('consensus.md', '# Consensus\n\nSee [[raft]] for details.');
    await indexNote(ctx(), 'raft.md', await fsp.readFile(path.join(root, 'raft.md'), 'utf-8'));
    await indexNote(ctx(), 'consensus.md', await fsp.readFile(path.join(root, 'consensus.md'), 'utf-8'));

    const plan = await planRename(root, 'raft.md', 'algorithms/raft.md');
    const consensus = plan.affectedNotes.find((a) => a.path === 'consensus.md')!;
    expect(consensus).toBeDefined();
    expect(consensus.before).toContain('[[raft]]');
    expect(consensus.after).toContain('[[algorithms/raft]]');

    // Nothing on disk changed.
    expect(await fsp.readFile(path.join(root, 'consensus.md'), 'utf-8')).toContain('[[raft]]');
    expect(fs.existsSync(path.join(root, 'algorithms/raft.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'raft.md'))).toBe(true);
  });

  it("the plan's affected set matches what the commit actually rewrites", async () => {
    await write('a.md', '# A\n\nlinks to [[target]] here');
    await write('b.md', '# B\n\nalso [[target]]');
    await write('target.md', '# Target');
    for (const f of ['a.md', 'b.md', 'target.md']) {
      await indexNote(ctx(), f, await fsp.readFile(path.join(root, f), 'utf-8'));
    }
    const plan = await planRename(root, 'target.md', 'moved/target.md');
    const planned = new Set(plan.affectedNotes.filter((a) => !a.isMoved).map((a) => a.path));

    const { rewrittenPaths } = await renameWithLinkRewrites(root, 'target.md', 'moved/target.md');
    expect(planned).toEqual(new Set(rewrittenPaths));
  });

  describe('guardrails', () => {
    beforeEach(async () => { await write('note.md', '# Note'); await write('exists.md', '# Exists'); });

    it('rejects a no-op (same path)', async () => {
      await expect(planRename(root, 'note.md', 'note.md')).rejects.toBeInstanceOf(RefactorError);
    });
    it('rejects a collision with an existing file', async () => {
      await expect(planRename(root, 'note.md', 'exists.md')).rejects.toThrow(/already exists/);
    });
    it('rejects a missing source', async () => {
      await expect(planRename(root, 'ghost.md', 'x.md')).rejects.toThrow(/no longer exists/);
    });
    it('rejects a non-note source', async () => {
      await write('data.csv', 'a,b\n1,2');
      await expect(planRename(root, 'data.csv', 'data2.csv')).rejects.toBeInstanceOf(RefactorError);
    });
    it('rejects an unsafe destination (path traversal)', async () => {
      await expect(planRename(root, 'note.md', '../escape.md')).rejects.toThrow();
    });
    it('rejects a folder source', async () => {
      await write('folder/inner.md', '# Inner');
      await expect(planRename(root, 'folder', 'folder2')).rejects.toBeInstanceOf(RefactorError);
    });
  });
});
