/**
 * A per-project state slot (#1085).
 *
 * Every stateful subsystem — graph, search, tables, vectors — held one value
 * per open project in its own `Map<string, TState>` keyed by `rootPath`, and
 * re-declared the same get / set / has / delete + dispose boilerplate. This
 * centralizes that map and its lifecycle in one place, and self-registers so the
 * orchestrator (`project-context.ts`) can tear a project down by iterating the
 * registry instead of naming each subsystem.
 *
 * A store owns the map only. Each subsystem keeps its own `init` — the
 * signatures genuinely diverge (some take options, some are async, some open a
 * DuckDB) — and calls `set` once it has built the state. Init ORDER stays the
 * orchestrator's job: the deliberate `indexAllNotes`-before-`registerAllCsvs`
 * sequencing (#337) is a cross-store dependency a generic store must not own.
 * Disposal, by contrast, has no cross-store ordering dependency — each store
 * closes only its own resources — so `disposeAllProjectStores` can run them in
 * any order.
 */

import type { ProjectContext } from './project-context-types';

export interface ProjectStore<T> {
  /** The state for this project, or null if it was never initialized. */
  get(ctx: ProjectContext): T | null;
  /** Whether this project has state — the idempotent-init guard. */
  has(ctx: ProjectContext): boolean;
  /** Register freshly-built state for this project. */
  set(ctx: ProjectContext, state: T): void;
  /**
   * Run the dispose hook (if any) and drop the state. Idempotent — a second
   * call, or a call for a project that was never initialized, is a no-op. The
   * state is removed from the map BEFORE the (possibly async) hook runs, so a
   * re-entrant lookup during teardown sees it already gone — matching the
   * delete-then-close ordering the vector store relied on.
   */
  dispose(ctx: ProjectContext): Promise<void>;
  /** rootPaths currently held — for diagnostics / tests. */
  keys(): string[];
}

const registry: Array<ProjectStore<unknown>> = [];

export function createProjectStore<T>(opts?: {
  /** Cleanup run before the state is dropped (close DB handles, await locks). */
  dispose?: (state: T, ctx: ProjectContext) => void | Promise<void>;
}): ProjectStore<T> {
  const map = new Map<string, T>();
  const store: ProjectStore<T> = {
    get: (ctx) => map.get(ctx.rootPath) ?? null,
    has: (ctx) => map.has(ctx.rootPath),
    set: (ctx, state) => { map.set(ctx.rootPath, state); },
    async dispose(ctx) {
      const state = map.get(ctx.rootPath);
      if (state === undefined) return;
      map.delete(ctx.rootPath);
      if (opts?.dispose) await opts.dispose(state, ctx);
    },
    keys: () => [...map.keys()],
  };
  registry.push(store);
  return store;
}

/**
 * Dispose every registered store for a project. Called by `project-context` on
 * a project's last release, AFTER the final persist. Order-independent (see the
 * module comment), so the registry's registration order is fine.
 */
export async function disposeAllProjectStores(ctx: ProjectContext): Promise<void> {
  for (const store of registry) await store.dispose(ctx);
}
