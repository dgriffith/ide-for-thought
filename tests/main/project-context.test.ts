import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { silenceLogTags } from '../helpers/quiet-logs';
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
  refreshOpenExtensionCatalogs,
} from '../../src/main/project-context';
import { queryGraph } from '../../src/main/graph/index';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-project-context-test-'));
}

// Expected: these tests drive failure paths the code logs (#2390).
silenceLogTags('project-context');

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

describe('project-context: the extension catalog (#2618)', () => {
  let root: string;
  beforeEach(() => { root = mkTempProject(); });
  afterEach(async () => {
    for (const r of [...activeProjects()]) await releaseProject(r, 1);
    await fsp.rm(root, { recursive: true, force: true });
  });

  /** Object-type contributions recorded in the graph, by id. */
  async function typeContributions(): Promise<string[]> {
    const r = await queryGraph(getProjectContext(root)!, `
      SELECT ?id WHERE {
        ?c a minerva:Contribution ; minerva:contributesTo ?p ; dc:identifier ?id .
        ?p dc:identifier "object-types" .
      }`);
    return (r.results as Array<{ id: string }>).map((x) => x.id);
  }

  /** The refresh is fire-and-forget; wait for it to land. */
  async function until(check: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timed out waiting for the extension catalog');
  }

  it('opening a project records what is installed', async () => {
    await acquireProject(root, 1);
    await until(async () => (await typeContributions()).includes('place'));
  });

  it('a refresh picks up a contribution added since', async () => {
    await acquireProject(root, 1);
    await until(async () => (await typeContributions()).includes('place'));
    await fsp.mkdir(path.join(root, '.minerva', 'types'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva', 'types', 'recipe.md'), '---\nlabel: Recipe\nproperties:\n  - name: serves\n    type: number\n---\n');
    refreshOpenExtensionCatalogs();
    await until(async () => (await typeContributions()).includes('recipe'));
  });
});
