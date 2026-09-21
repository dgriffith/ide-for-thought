/**
 * Health-check per-project state is disposed with the project (#2240, epic #2241).
 *
 * `createProjectStore` (#1085) exists so a subsystem's per-project state is
 * torn down by iterating the registry rather than by the orchestrator naming
 * each subsystem. `health-checks.ts` kept four module-level maps keyed by
 * `rootPath` outside that registry. Two were torn down because
 * `project-context.ts` named them at release; `lastResultsByProject` had no
 * `.delete` call anywhere in the codebase.
 *
 * The consequence was a wrong answer, not only a leak. `getInspections` is the
 * `INSPECTIONS_GET` handler the right-sidebar panel reads, so **closing a
 * thoughtbase and reopening it showed the previous session's findings** —
 * including ones for notes deleted in between — until a fresh run finished.
 *
 * These tests drive `disposeAllProjectStores` directly, which is what
 * `releaseProject` calls on the last window close. Using the real registry
 * rather than a health-check-specific teardown function is the point: it is
 * exactly the path that could not reach this state before.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  runAllChecks,
  getInspections,
  isRunning,
  armAutoChecks,
  startPeriodicChecks,
} from '../../../src/main/graph/health-checks';
import { disposeAllProjectStores } from '../../../src/main/project-store';
import { applyTurtle } from '../../../src/main/llm/proposal-persistence';
import { initGraph } from '../../../src/main/graph/index';
import { onInspectionsChanged } from '../../../src/main/graph/inspection-events';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';
import { DEFAULT_INSPECTION_SETTINGS } from '../../../src/shared/inspections';

describe('closing a project drops its inspection results (#2240)', () => {
  const projectA = useGraphProject('minerva-health-lifecycle-a-');
  const projectB = useGraphProject('minerva-health-lifecycle-b-');
  let ctxA: ProjectContext;
  let ctxB: ProjectContext;

  beforeEach(async () => {
    ctxA = projectA.ctx;
    ctxB = projectB.ctx;
    await applyTurtle(ctxA, `<urn:claim:a> a thought:Claim ; thought:label "Claim A" .`);
    await applyTurtle(ctxB, `<urn:claim:b> a thought:Claim ; thought:label "Claim B" .`);
  });

  it('serves nothing after disposal — the staleness bug', async () => {
    // The regression, end to end: run checks, close the project, and ask the
    // question the reopened panel asks. Before #2240 this returned the full
    // list from the closed session.
    const found = await runAllChecks(ctxA);
    expect(found.some((i) => i.nodeUri === 'urn:claim:a')).toBe(true);
    expect(getInspections(ctxA)).toHaveLength(found.length);

    await disposeAllProjectStores(ctxA);

    expect(getInspections(ctxA)).toEqual([]);
  });

  it('disposing one project leaves another open project alone', async () => {
    // Two thoughtbases open at once is the normal case here, so teardown has
    // to be per-project rather than a module-wide clear.
    await runAllChecks(ctxA);
    const beforeB = await runAllChecks(ctxB);
    expect(beforeB.length).toBeGreaterThan(0);

    await disposeAllProjectStores(ctxA);

    expect(getInspections(ctxA)).toEqual([]);
    expect(getInspections(ctxB)).toHaveLength(beforeB.length);
  });

  it('a read does not resurrect a disposed project', async () => {
    // `getInspections` deliberately doesn't create a slot. If it did, the
    // panel polling a closed thoughtbase would re-register it and the leak
    // would return by a different route.
    await runAllChecks(ctxA);
    await disposeAllProjectStores(ctxA);

    getInspections(ctxA);
    isRunning(ctxA);

    // Nothing to dispose the second time round: a slot that came back would
    // have to be dropped again, and this would be re-clearing real state.
    await disposeAllProjectStores(ctxA);
    expect(getInspections(ctxA)).toEqual([]);
  });

  it('a reopened thoughtbase reports what is in it NOW, not last session', async () => {
    // The whole bug, as a user would hit it: work in a thoughtbase, close it,
    // change what's in it, open it again. `disposeAllProjectStores` tears down
    // every registered store — the graph included — so re-opening means
    // `initGraph` again, which is what `acquireProject` does.
    const first = await runAllChecks(ctxA);
    expect(first.some((i) => i.nodeUri === 'urn:claim:a')).toBe(true);

    await disposeAllProjectStores(ctxA);
    expect(getInspections(ctxA)).toEqual([]);

    // Remove the persisted graph while the project is "closed" — standing in
    // for the user deleting notes outside the app, which is when a stale
    // inspection list is most visibly wrong.
    await fsp.rm(path.join(projectA.root, '.minerva', 'graph.ttl'), { force: true });

    await initGraph(ctxA);
    await applyTurtle(ctxA, `<urn:claim:later> a thought:Claim ; thought:label "Claim added later" .`);
    const second = await runAllChecks(ctxA);

    // Rebuilt from what's on disk now: the new claim is reported and the one
    // from the closed session is not. Before #2240 the panel served the old
    // list from memory until this run completed, so a deleted note's
    // inspection outlived the note.
    expect(second.some((i) => i.nodeUri === 'urn:claim:later')).toBe(true);
    expect(second.some((i) => i.nodeUri === 'urn:claim:a')).toBe(false);
  });
});

describe('the in-flight flag is per project and survives disposal (#2240)', () => {
  const project = useGraphProject('minerva-health-lifecycle-run-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = project.ctx;
    await applyTurtle(ctx, `<urn:claim:r> a thought:Claim ; thought:label "Claim R" .`);
  });

  it('reports not-running for a project with no state at all', () => {
    expect(isRunning(ctx)).toBe(false);
  });

  it('clears the flag when a project is disposed mid-run', async () => {
    // `runAllChecks` marks itself running synchronously and only yields at its
    // `Promise.all`, so disposing here lands genuinely mid-run.
    const inFlight = runAllChecks(ctx);
    expect(isRunning(ctx)).toBe(true);

    await disposeAllProjectStores(ctx);
    await inFlight;

    // The run finished against a detached state object; the store holds
    // nothing, so a reopened project starts clean rather than inheriting a
    // stuck "a check is already running" flag that would suppress every
    // future run's results.
    expect(isRunning(ctx)).toBe(false);
    expect(getInspections(ctx)).toEqual([]);
  });

  it('does not announce results for a project that closed mid-run', async () => {
    // `emitInspectionsChanged` wakes whatever is showing the panel. Firing it
    // for a thoughtbase that is no longer open is announcing results nothing
    // can reach — `getInspections` returns [] by then.
    const seen: string[] = [];
    const unsubscribe = onInspectionsChanged((rootPath) => { seen.push(rootPath); });
    try {
      const inFlight = runAllChecks(ctx);
      await disposeAllProjectStores(ctx);
      await inFlight;

      expect(seen).not.toContain(ctx.rootPath);
    } finally {
      unsubscribe();
    }
  });

  it('still announces results on an ordinary run', async () => {
    // The guard above must not have switched the event off in the normal case.
    const seen: string[] = [];
    const unsubscribe = onInspectionsChanged((rootPath) => { seen.push(rootPath); });
    try {
      await runAllChecks(ctx);
      expect(seen).toContain(ctx.rootPath);
    } finally {
      unsubscribe();
    }
  });
});

describe('timers are stopped by the registry, not only by the orchestrator (#2240)', () => {
  const project = useGraphProject('minerva-health-lifecycle-timers-');
  let ctx: ProjectContext;

  beforeEach(() => { ctx = project.ctx; });

  it('disposal clears the periodic timer without stopPeriodicChecks being called', async () => {
    // `project-context.ts` does call `stopPeriodicChecks` explicitly, before
    // the final persist, and should keep doing so — that ordering stops new
    // work being scheduled during teardown. This asserts the other half: if
    // that call is ever dropped or a new caller forgets it, the registry still
    // cleans up. It's the guarantee the two leaking maps never had.
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => DEFAULT_INSPECTION_SETTINGS);
      startPeriodicChecks(ctx, { loadSettings, intervalMs: 1000 });

      await disposeAllProjectStores(ctx);
      await vi.advanceTimersByTimeAsync(5000);

      expect(loadSettings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposal unsubscribes the graph-write listener without disarmAutoChecks', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => DEFAULT_INSPECTION_SETTINGS);
      armAutoChecks(ctx, { loadSettings, debounceMs: 10 });

      await disposeAllProjectStores(ctx);
      const { emitGraphChanged } = await import('../../../src/main/graph/graph-events');
      emitGraphChanged(ctx.rootPath);
      await vi.advanceTimersByTimeAsync(1000);

      expect(loadSettings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
