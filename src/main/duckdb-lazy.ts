/**
 * The one place `@duckdb/node-api` is loaded, and it is loaded late (#2335).
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * `main.ts` pulls its whole dependency graph at module scope, and the heaviest
 * single edge was a native binding reached for a `before-quit` handler:
 *
 *     main.ts:15            import { flushAllProjects } from './project-context'
 *       → project-context      import * as tables   from './sources/tables'
 *       → project-context      import * as vectors  from './embeddings/vector-store'
 *         → both               import … from '@duckdb/node-api'
 *
 * `libduckdb.dylib` in the packaged app is **107MB**. Measured cold (first
 * launch after a build) the whole eager bundle costs ~988ms, of which
 * `@duckdb/node-api` is 2,896ms unbundled — far and away the largest item,
 * ahead of `@comunica` at 732ms. Warm it is ~12ms, because the library is
 * lazily mapped: this is a first-launch and post-reboot cost, which is the
 * launch a new user forms an opinion on. Every user paid it, including the
 * ones who never open a table.
 *
 * ── Why a shared module rather than an inline `await import` ────────────────
 * Two packages need it (`sources/tables.ts`, `embeddings/vector-store.ts`) and
 * both are reached from project open, so an inline dynamic import in each
 * would race: two `import()` calls for the same native module resolve to the
 * same module instance, but each caller would separately await the resolution.
 * Caching the PROMISE here means the second caller joins the first rather than
 * starting a second load, which matters because project open touches both.
 *
 * It also gives the ratchet something to point at:
 * `tests/architecture/lazy-boot-modules.test.ts` asserts this is the only
 * module in `src/` with a value import of `@duckdb/node-api`, so the next
 * subsystem that wants a table cannot quietly put the binding back on the boot
 * path. Type-only imports stay free everywhere — they erase.
 *
 * ── What this does NOT do ───────────────────────────────────────────────────
 * It does not make DuckDB cheaper, or defer it past the point of use. Opening
 * a project still initialises both stores, so a user who opens a thoughtbase
 * with tables pays the same load a moment later. What moves is the *window*:
 * off the pre-window boot path, where it delays first paint for everyone, and
 * onto the path that actually needs it.
 */
type DuckDbModule = typeof import('@duckdb/node-api');

let pending: Promise<DuckDbModule> | null = null;

/**
 * The `@duckdb/node-api` module, loaded on first use and shared thereafter.
 *
 * A rejected load is not cached — a failed `dlopen` is usually a broken or
 * mismatched native build, and retrying gives the next caller a fresh error
 * rather than replaying a stale one for the life of the process.
 */
export function duckdb(): Promise<DuckDbModule> {
  if (!pending) {
    pending = import('@duckdb/node-api').catch((err: unknown) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

/** Test seam: forget the cached module so a load can be observed again. */
export function _resetDuckdbLoaderForTests(): void {
  pending = null;
}
