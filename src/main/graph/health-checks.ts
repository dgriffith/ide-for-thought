import type { ProjectContext } from '../project-context-types';
import {
  healthStore,
  stateFor,
  getInspections,
  isRunning,
  type AutoState,
  type HealthCheckDeps,
} from './health-check-state';

// Per-project state lives next door (#2288) — see that module's header for
// why it is a separate concern, and why the split waited on `Inspection`
// moving to `shared/`. Re-exported because callers have always read the
// results from here.
export { getInspections, isRunning };
export type { HealthCheckDeps };
import { logger } from '../../shared/logger';
import { rethrowIfTrustGuard } from './write-guard';
import { onGraphChanged } from './graph-events';
import { emitInspectionsChanged } from './inspection-events';
import {
  INSPECTIONS,
  catalogTypeFor,
  isInspectionEnabled,
  DEFAULT_INSPECTION_SETTINGS,
  type InspectionSettings,
  type Inspection,
  type InspectionSeverity,
} from '../../shared/inspections';
import {
  INSPECTION_CHECKS,
  emitsOf,
  idOf,
  runCheck,
  type CheckRun,
  type InspectionCheck,
} from './inspection-checks';
// The registry lives with the checks (#2627); re-exported for callers of this module.
export { INSPECTION_CHECKS };
export type { InspectionCheck } from './inspection-checks';

// The result type lives in `shared/inspections.ts` beside the catalog (#2288);
// this module owns how each check is COMPUTED, not what a finding looks like.
// Re-exported because callers have always imported it from here.
export type { Inspection, InspectionSeverity };

// ── Types ──────────────────────────────────────────────────────────────────


// ── Named Constants ────────────────────────────────────────────────────────

/** Periodic checks interval: 5 minutes */
const PERIODIC_CHECKS_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;



// ── Run All Checks ─────────────────────────────────────────────────────────

/**
 * Run one check so that its failure costs only its own results (#2363).
 *
 * The checks' fixed queries go through `queryGraphRows`, which THROWS on the
 * union's failure arm — before #2363 a failed query came back as empty rows,
 * so a check that hit an engine error quietly reported nothing. Throwing is
 * right (rule 1), but under the `Promise.all` below one throwing check would
 * reject the whole run and blank every inspection. So: log it loudly, omit
 * that check's results for this run, keep the rest. A trust-guard violation
 * is never absorbed here.
 */
async function isolated(name: string, run: () => Promise<Inspection[]>): Promise<Inspection[]> {
  try {
    return await run();
  } catch (err) {
    rethrowIfTrustGuard(err);
    logger('graph').warn(`inspection '${name}' failed; its results are omitted from this run:`, err);
    return [];
  }
}

const SEVERITY = new Map<string, InspectionSeverity>(INSPECTIONS.map((d) => [d.type, d.severity]));
/** The catalog's severity for a type; a plugin's type (#2642) keeps its shape's. */
const severityOf = (type: string, own: InspectionSeverity): InspectionSeverity => SEVERITY.get(catalogTypeFor(type)) ?? own;

/**
 * Run every ENABLED check. `settings` comes from the per-machine inspection
 * config (#1792); omitting it runs everything at the built-in thresholds, which
 * is what tests and any non-Electron caller want.
 *
 * A disabled check is skipped rather than filtered afterwards — the point of
 * switching one off is not to pay for it, and several of these are whole-graph
 * SPARQL queries.
 *
 * A check that emits several types (evidence gaps → missing_warrant +
 * missing_backing; the source scan; broken links) runs while any of them is
 * on, and the types switched off are dropped from its findings.
 */
export async function runAllChecks(
  ctx: ProjectContext,
  settings: InspectionSettings = DEFAULT_INSPECTION_SETTINGS,
  deps: HealthCheckDeps = {},
): Promise<Inspection[]> {
  const state = stateFor(ctx);
  if (state.running) return state.lastResults;
  state.running = true;

  const on = (type: string) => isInspectionEnabled(type, settings);
  const run: CheckRun = { ctx, settings, deps, on };

  try {
    // Minerva's checks, then the plugins' shapes (#2642): a plugin whose
    // shapes can't be read costs only them.
    let pluginChecks: InspectionCheck[] = [];
    try {
      pluginChecks = (deps.pluginShapes?.() ?? []).map(({ id, file }) => ({ kind: 'shacl' as const, id, file }));
    } catch (e) {
      logger('graph').warn("couldn't read the plugins' inspection shapes:", e);
    }
    const results = await Promise.all([...INSPECTION_CHECKS, ...pluginChecks].map((check) => {
      const emits = emitsOf(check);
      if (!emits.some(on)) return Promise.resolve([]);
      return isolated(idOf(check), async () => {
        const found = await runCheck(check, run);
        // A check reports only the types it declares — the catalog's switches
        // and descriptions are keyed on them.
        const stray = found.filter((i) => !emits.includes(catalogTypeFor(i.type)));
        if (stray.length > 0) {
          logger('graph').warn(`inspection '${idOf(check)}' emitted undeclared types; dropped:`, [...new Set(stray.map((i) => i.type))]);
        }
        return found.filter((i) => !stray.includes(i));
      });
    }));
    // A multi-type check runs as a unit, so drop the individual types the user
    // switched off.
    // Severity is the catalog's — one per type, whichever check found it.
    const flat = results.flat()
      .filter((i) => isInspectionEnabled(catalogTypeFor(i.type), settings))
      .map((i) => ({ ...i, severity: severityOf(i.type, i.severity) }));
    state.lastResults = flat;
    // Tell anyone showing the results that they moved (#1795) — runs are no
    // longer only user-initiated, so the panel can't assume it caused them.
    //
    // Unless the project closed while this run was in flight. `state` is then
    // a detached object the store no longer holds (dispose removes it before
    // running its hook), so these results are unreachable and announcing them
    // would wake a panel for a thoughtbase that isn't open.
    if (healthStore.get(ctx) === state) emitInspectionsChanged(ctx.rootPath);
    return flat;
  } finally {
    state.running = false;
  }
}

// ── Automatic runs ─────────────────────────────────────────────────────────

/**
 * Re-run the checks shortly after the graph changes (#1795).
 *
 * Saving a note is when you most want to know you've just broken a link, and
 * waiting up to five minutes for the next timer tick made the panel feel
 * broken. Every graph write emits `graphChanged`; this debounces the burst
 * (a bulk index at project open emits once per note) and runs once things
 * settle.
 *
 * The debounce is a floor, not a promise: a run already in flight is left to
 * finish and the next change schedules another.
 */

export const DEFAULT_CHECK_DEBOUNCE_MS = 2000;

export function armAutoChecks(
  ctx: ProjectContext,
  opts: {
    loadSettings: () => Promise<InspectionSettings>;
    debounceMs?: number;
  } & HealthCheckDeps,
): void {
  disarmAutoChecks(ctx);
  const state: AutoState = {
    timer: null,
    loadSettings: opts.loadSettings,
    // `opts` already widens to HealthCheckDeps; rebuilding the object would
    // trip `exactOptionalPropertyTypes` on an absent scanner.
    deps: opts,
    debounceMs: opts.debounceMs ?? DEFAULT_CHECK_DEBOUNCE_MS,
    unsubscribe: () => {},
  };
  state.unsubscribe = onGraphChanged((rootPath) => {
    // One armed project per root; ignore writes to other open thoughtbases.
    if (rootPath !== ctx.rootPath) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void (async () => {
        await runAllChecks(ctx, await state.loadSettings(), state.deps);
      })();
    }, state.debounceMs);
  });
  stateFor(ctx).auto = state;
}

export function disarmAutoChecks(ctx: ProjectContext): void {
  const auto = healthStore.get(ctx)?.auto;
  if (!auto) return;
  if (auto.timer) clearTimeout(auto.timer);
  auto.unsubscribe();
  healthStore.get(ctx)!.auto = null;
}

// ── Timer ──────────────────────────────────────────────────────────────────

/**
 * Re-run the checks every `intervalMs`.
 *
 * `loadSettings` is injected rather than imported because the settings loader
 * reaches `electron`, and this module is imported all over the test suite —
 * see the module header of `shared/inspections.ts`. Omitting it runs at the
 * built-in defaults, which is only right for a caller that has no user
 * settings to honour.
 */
export function startPeriodicChecks(
  ctx: ProjectContext,
  opts: {
    loadSettings?: () => Promise<InspectionSettings>;
    intervalMs?: number;
  } & HealthCheckDeps = {},
): void {
  stopPeriodicChecks(ctx);
  const intervalMs = opts.intervalMs ?? PERIODIC_CHECKS_DEFAULT_INTERVAL_MS;
  const timer = setInterval(() => {
    void (async () => {
      const settings = opts.loadSettings ? await opts.loadSettings() : DEFAULT_INSPECTION_SETTINGS;
      await runAllChecks(ctx, settings, opts);
    })();
  }, intervalMs);
  stateFor(ctx).periodicTimer = timer;
}

export function stopPeriodicChecks(ctx: ProjectContext): void {
  const state = healthStore.get(ctx);
  if (!state?.periodicTimer) return;
  clearInterval(state.periodicTimer);
  state.periodicTimer = null;
}
