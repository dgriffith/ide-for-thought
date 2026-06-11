/**
 * Shared temp-project test fixtures (#678).
 *
 * ~90 main-process test files repeat the same `fs.mkdtempSync(...) →
 * projectContext → initGraph → afterEach rm` boilerplate. The team deliberately
 * tolerated that duplication until fixtures were warranted (see CLAUDE.md feedback);
 * at this many repetitions the threshold is crossed. These helpers collapse the
 * boilerplate to one line and give a single place to harden teardown — afterEach
 * always runs, so a tmpdir can't leak even if a test or a beforeEach throws after
 * the dir is created.
 *
 * Three shapes, pick what fits:
 *  - `useGraphProject()` / `useTempDir()` — register the per-test lifecycle for
 *    you and return a live handle (`.root` / `.ctx` track the current test).
 *    The least boilerplate; preferred for new describe blocks.
 *  - `makeGraphProject()` — returns `{ root, ctx, cleanup }` so a test can wire
 *    it into its own beforeEach/afterEach when it needs extra setup alongside.
 *  - `withTempProject(fn)` — a one-shot temp dir for the duration of `fn`.
 */

import { beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph } from '../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../src/main/project-context-types';

const DEFAULT_PREFIX = 'minerva-test-';

function freshTempDir(prefix = DEFAULT_PREFIX): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function removeDir(dir: string): Promise<void> {
  if (dir) await fsp.rm(dir, { recursive: true, force: true });
}

/** A created temp project + its graph, plus a teardown. */
export interface GraphProject {
  root: string;
  ctx: ProjectContext;
  /** Remove the temp dir. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/**
 * Create a fresh temp dir, bind a ProjectContext, and initialize its graph.
 * The caller owns teardown via the returned `cleanup()` — wire it into an
 * afterEach (or a try/finally).
 */
export async function makeGraphProject(prefix = DEFAULT_PREFIX): Promise<GraphProject> {
  const root = freshTempDir(prefix);
  const ctx = projectContext(root);
  await initGraph(ctx);
  return { root, ctx, cleanup: () => removeDir(root) };
}

/** A live handle whose `.root` / `.ctx` point at the current test's project. */
export interface ProjectHandle {
  readonly root: string;
  readonly ctx: ProjectContext;
}

/**
 * Register a fresh temp project + graph for every test in the enclosing
 * describe, with automatic teardown. Returns a live handle — read `.root` /
 * `.ctx` inside each `it`.
 *
 *   const project = useGraphProject();
 *   it('…', () => { parseIntoStore(project.ctx, …); });
 */
export function useGraphProject(prefix = DEFAULT_PREFIX): ProjectHandle {
  let project: GraphProject | undefined;
  beforeEach(async () => { project = await makeGraphProject(prefix); });
  afterEach(async () => { await project?.cleanup(); });
  return {
    get root() { return project?.root ?? ''; },
    get ctx() {
      if (!project) throw new Error('useGraphProject: accessed ctx outside a test');
      return project.ctx;
    },
  };
}

/**
 * Register a fresh temp dir (no graph) for every test in the enclosing
 * describe, with automatic teardown. For fs-level tests.
 */
export function useTempDir(prefix = DEFAULT_PREFIX): { readonly root: string } {
  let root = '';
  beforeEach(() => { root = freshTempDir(prefix); });
  afterEach(async () => { await removeDir(root); });
  return { get root() { return root; } };
}

/**
 * Run `fn` with a one-shot temp dir, removed afterward — even if `fn` throws.
 * For a single isolated case that doesn't need the describe-wide lifecycle.
 */
export async function withTempProject<T>(
  fn: (root: string) => T | Promise<T>,
  prefix = DEFAULT_PREFIX,
): Promise<T> {
  const root = freshTempDir(prefix);
  try {
    return await fn(root);
  } finally {
    await removeDir(root);
  }
}
