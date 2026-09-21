/**
 * Per-project health-check state, in its own `createProjectStore` slot
 * (#2288, from #2240).
 *
 * Split out of `health-checks.ts` for the reason `note-caches.ts` was split
 * out of the graph (#2234): this is a separate concern with a separate
 * lifetime. That file computes checks; this holds what one open thoughtbase
 * has accumulated — the last results, whether a run is in flight, and the two
 * timers — and hands it back on disposal.
 *
 * The split was blocked until now, and it is worth recording why rather than
 * leaving it looking like an oversight. `Inspection` used to be declared in
 * `health-checks.ts`, so a state module would have had to import it from
 * there while `health-checks.ts` imported the state from here —
 * `no-cycles.test.ts` follows type-only imports, so that is a real cycle, not
 * a technicality. Moving `Inspection` to `shared/inspections.ts` (#2288,
 * which it wanted anyway: four other copies of it existed) unblocked this.
 */
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';
import type { Inspection, InspectionSettings } from '../../shared/inspections';
import type { OrphanedAsset } from '../../shared/asset-paths';

/**
 * Collaborators this module cannot import for itself (#2238, epic #2241).
 *
 * `checkUnreferencedImages` needs `findOrphanedInlineAssets`, which lives in
 * `notebase/`. `graph/` importing it was one of the three edges that made
 * `graph ↔ notebase` a package-level cycle — invisible to
 * `no-cycles.test.ts`, which checks MODULE cycles and was right to pass.
 * Injecting it is the same move this module already makes for `loadSettings`
 * (which reaches electron); the caller wires it, and `tests/architecture/
 * no-package-cycles.test.ts` is what stops the import coming back.
 *
 * **Omitting `findOrphanedAssets` makes the unreferenced-image check yield
 * nothing** — it has no graph query to fall back on, only a filesystem scan it
 * no longer owns. That is right for a test that doesn't care about assets, and
 * wrong for production, so the two real call sites (`project-context.ts` and
 * `register-graph.ts`) are asserted to pass it by the architecture test above.
 */
export interface HealthCheckDeps {
  findOrphanedAssets?: (rootPath: string) => Promise<OrphanedAsset[]>;
}

export interface AutoState {
  timer: ReturnType<typeof setTimeout> | null;
  loadSettings: () => Promise<InspectionSettings>;
  deps: HealthCheckDeps;
  debounceMs: number;
  unsubscribe: () => void;
}

/**
 * Everything this module holds per open project (#2240, epic #2241).
 *
 * It used to be four module-level maps keyed by `rootPath`, hand-rolled
 * outside the project-store registry — which is the exact class of bug
 * `createProjectStore` (#1085) exists to remove. Two of the four were torn
 * down because `project-context.ts` named them at release; the other two were
 * not, and `disposeAllProjectStores` couldn't reach them because they had
 * never registered.
 *
 * `lastResults` had no `.delete` call anywhere in the codebase, so **closing a
 * thoughtbase left its whole inspection list resident, and reopening showed
 * the stale list** — `getInspections` is the `INSPECTIONS_GET` handler, so the
 * panel rendered last session's findings (including ones for notes since
 * deleted) until a fresh run finished. That is a wrong answer, not just a
 * leak.
 *
 * All four now live in one slot, which is also the honest shape: they are one
 * subsystem's state with one lifetime, not four independent maps that happen
 * to share a key. Same arrangement `note-caches.ts` uses (#2234).
 */
export interface HealthCheckState {
  /** The last completed run's findings — what `getInspections` serves. */
  lastResults: Inspection[];
  /**
   * A run is in flight for THIS project (#1893). Per-project rather than a
   * module-global flag: a check running for one project used to make every
   * other project's concurrent check return `[]`, indistinguishable from
   * "clean". Concurrent runs are the normal case — `armAutoChecks` debounces
   * off every graph write and there's a periodic timer per project.
   */
  running: boolean;
  /** Graph-write subscription + its debounce timer, when armed. */
  auto: AutoState | null;
  /** The periodic backstop, when started. */
  periodicTimer: ReturnType<typeof setInterval> | null;
}

export const healthStore = createProjectStore<HealthCheckState>({
  // Reached by `disposeAllProjectStores` on a project's last release. The
  // timers are also stopped explicitly by `project-context.ts` BEFORE the
  // final persist (ordering: stop scheduling new work before teardown starts),
  // and both paths are idempotent — this is the net that catches a caller who
  // forgets, which is how the other two leaked in the first place.
  dispose: (state) => {
    if (state.auto?.timer) clearTimeout(state.auto.timer);
    state.auto?.unsubscribe();
    if (state.periodicTimer) clearInterval(state.periodicTimer);
  },
});

/** This project's state, created on first write. */
export function stateFor(ctx: ProjectContext): HealthCheckState {
  const existing = healthStore.get(ctx);
  if (existing) return existing;
  const fresh: HealthCheckState = {
    lastResults: [], running: false, auto: null, periodicTimer: null,
  };
  healthStore.set(ctx, fresh);
  return fresh;
}

export function getInspections(ctx: ProjectContext): Inspection[] {
  // Deliberately does NOT go through `stateFor`: a read must not allocate a
  // slot for a project that has none, or the leak comes straight back through
  // the panel polling a closed project.
  return healthStore.get(ctx)?.lastResults ?? [];
}

export function isRunning(ctx: ProjectContext): boolean {
  return healthStore.get(ctx)?.running ?? false;
}
