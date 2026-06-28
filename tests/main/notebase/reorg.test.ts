import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { orderRefactors, planReorg } from '../../../src/main/notebase/reorg';
import { initGraph, indexNote, disposeProject } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';

describe('orderRefactors (pure)', () => {
  it('keeps independent moves in input order, no cycle', () => {
    const { ordered, cycle } = orderRefactors([
      { fromPath: 'a.md', toPath: 'x/a.md' },
      { fromPath: 'b.md', toPath: 'y/b.md' },
    ]);
    expect(cycle).toBe(false);
    expect(ordered.map((o) => o.fromPath)).toEqual(['a.md', 'b.md']);
  });

  it('vacates a path before filling it (chain)', () => {
    // A: X→Y, B: Y→Z. B frees Y, so B must apply before A.
    const { ordered, cycle } = orderRefactors([
      { fromPath: 'X.md', toPath: 'Y.md' },
      { fromPath: 'Y.md', toPath: 'Z.md' },
    ]);
    expect(cycle).toBe(false);
    expect(ordered.map((o) => o.fromPath)).toEqual(['Y.md', 'X.md']);
  });

  it('flags a swap as an unorderable cycle', () => {
    const { cycle } = orderRefactors([
      { fromPath: 'A.md', toPath: 'B.md' },
      { fromPath: 'B.md', toPath: 'A.md' },
    ]);
    expect(cycle).toBe(true);
  });
});

describe('planReorg', () => {
  let root: string;
  const ctx = () => projectContext(root);
  async function seed(rel: string, body: string): Promise<void> {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body, 'utf-8');
    await indexNote(ctx(), rel, body);
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-reorg-'));
    await initGraph(ctx());
    await seed('a.md', '# A\n\nlinks [[b]]');
    await seed('b.md', '# B\n\nbody');
    await seed('keep.md', '# Keep');
  });
  afterEach(async () => {
    disposeProject(ctx());
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('plans valid operations with their blast radius', async () => {
    const plan = await planReorg(root, [
      { path: 'a.md', newPath: 'notes/a.md' },
      { path: 'b.md', newPath: 'notes/b.md' },
    ]);
    expect(plan.items.map((i) => i.toPath)).toEqual(['notes/a.md', 'notes/b.md']);
    expect(plan.warnings).toHaveLength(0);
    // Moving b.md rewrites a.md's [[b]] link — captured in b's blast radius.
    const bItem = plan.items.find((i) => i.fromPath === 'b.md')!;
    expect(bItem.affectedNotes.some((n) => n.path === 'a.md')).toBe(true);
  });

  it('drops an un-runnable operation with a warning', async () => {
    const plan = await planReorg(root, [
      { path: 'a.md', newPath: 'notes/a.md' },
      { path: 'b.md', newPath: 'keep.md' }, // collides with existing keep.md
    ]);
    expect(plan.items.map((i) => i.fromPath)).toEqual(['a.md']);
    expect(plan.warnings.some((w) => /keep\.md/.test(w))).toBe(true);
  });

  it('flags two operations targeting the same destination', async () => {
    const plan = await planReorg(root, [
      { path: 'a.md', newPath: 'merged.md' },
      { path: 'b.md', newPath: 'merged.md' },
    ]);
    expect(plan.warnings.some((w) => /same destination/.test(w))).toBe(true);
  });
});
