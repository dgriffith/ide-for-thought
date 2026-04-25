import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  acquireProject,
  releaseProject,
  refCountFor,
  activeProjects,
  getProjectContext,
} from '../../src/main/project-context';
import { queryGraph } from '../../src/main/graph/index';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-project-context-test-'));
}

describe('project-context lifecycle (#333)', () => {
  let root: string;

  beforeEach(() => {
    root = mkTempProject();
  });

  afterEach(async () => {
    // Belt and suspenders: drain the registry so the next test starts clean.
    // Iterate `activeProjects()` and release every winId we used during the
    // test. The test set keeps to a small range of synthetic ids.
    for (const r of [...activeProjects()]) {
      for (const id of [1, 2, 3, 999]) await releaseProject(r, id);
    }
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('first acquire initialises the project, second acquire reuses it', async () => {
    const ctxA = await acquireProject(root, 1);
    expect(refCountFor(root)).toBe(1);

    const ctxB = await acquireProject(root, 2);
    // Second acquirer gets the *same* ProjectContext instance — identity
    // matters because it's used as a Map key in subsystem state.
    expect(ctxB).toBe(ctxA);
    expect(refCountFor(root)).toBe(2);
  });

  it('releasing all acquirers disposes the graph state', async () => {
    await acquireProject(root, 1);
    await acquireProject(root, 2);

    // Sanity: querying the graph works while held.
    const ctx = getProjectContext(root)!;
    const live = await queryGraph(ctx, 'SELECT * WHERE { ?s ?p ?o } LIMIT 1');
    expect(live.error).toBeUndefined();

    await releaseProject(root, 1);
    expect(refCountFor(root)).toBe(1);
    expect(getProjectContext(root)).not.toBeNull();

    await releaseProject(root, 2);
    expect(refCountFor(root)).toBe(0);
    expect(getProjectContext(root)).toBeNull();

    // After full release, queryGraph against a no-state ctx returns the
    // empty-binding sentinel rather than throwing.
    const after = await queryGraph(ctx, 'SELECT * WHERE { ?s ?p ?o }');
    expect(after.results).toEqual([]);
  });

  it('two projects open simultaneously stay isolated', async () => {
    const root2 = mkTempProject();
    try {
      const ctxA = await acquireProject(root, 1);
      const ctxB = await acquireProject(root2, 2);
      expect(ctxA).not.toBe(ctxB);
      expect(activeProjects().sort()).toEqual([root, root2].sort());
      await releaseProject(root, 1);
      expect(activeProjects()).toEqual([root2]);
    } finally {
      await releaseProject(root2, 2);
      await fsp.rm(root2, { recursive: true, force: true });
    }
  });

  it('release on a winId that never acquired is a no-op', async () => {
    await acquireProject(root, 1);
    await releaseProject(root, 999);
    expect(refCountFor(root)).toBe(1);
    await releaseProject(root, 1);
    expect(refCountFor(root)).toBe(0);
  });
});
