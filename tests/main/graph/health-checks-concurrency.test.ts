/**
 * `running` guard in `graph/health-checks.ts` (#1893).
 *
 * `runAllChecks` used to guard concurrent execution with a single
 * module-global `let running = false` while every other piece of state
 * (`lastResultsByProject`) was keyed by `rootPath`. Concurrent runs across
 * different projects are the normal case, not an edge case: `armAutoChecks`
 * debounces a run off every graph write, and there's a 5-minute periodic
 * timer per project — with two+ thoughtbases open, their checks routinely
 * overlap. A check in flight for project A made a concurrent check for
 * project B return `[]`, indistinguishable from "clean."
 *
 * `runAllChecks` runs synchronously up through marking itself "running" and
 * kicking off its `Promise.all([...])` of check queries — it only yields to
 * the caller at that `await`. So firing two calls back-to-back without
 * awaiting between them (as below) reliably overlaps them: by the time the
 * second call's guard runs, the first has already marked itself running but
 * has not yet reached its `finally`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { applyTurtle } from '../../../src/main/llm/proposal-persistence';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-health-checks-concurrency-test-'));
}

describe('runAllChecks concurrency guard (#1893)', () => {
  let rootA: string;
  let rootB: string;
  let ctxA: ProjectContext;
  let ctxB: ProjectContext;

  beforeEach(async () => {
    rootA = mkTempProject();
    rootB = mkTempProject();
    ctxA = projectContext(rootA);
    ctxB = projectContext(rootB);
    await initGraph(ctxA);
    await initGraph(ctxB);
    await applyTurtle(ctxA, `<urn:claim:a> a thought:Claim ; thought:label "Claim A" .`);
    await applyTurtle(ctxB, `<urn:claim:b> a thought:Claim ; thought:label "Claim B" .`);
  });

  afterEach(async () => {
    await Promise.all([
      fsp.rm(rootA, { recursive: true, force: true }),
      fsp.rm(rootB, { recursive: true, force: true }),
    ]);
  });

  it("project B's check returns its real results while project A's is in flight, not []", async () => {
    const pA = runAllChecks(ctxA);
    const pB = runAllChecks(ctxB); // fired before pA resolves — genuinely concurrent

    const [resultsA, resultsB] = await Promise.all([pA, pB]);

    expect(resultsA.some((i) => i.type === 'unsupported_claim' && i.nodeUri === 'urn:claim:a')).toBe(true);
    expect(resultsB.some((i) => i.type === 'unsupported_claim' && i.nodeUri === 'urn:claim:b')).toBe(true);
  });

  // Not the #1893 bug (that's cross-project), but worth pinning: the dedup
  // guard should still collapse a genuinely-concurrent SECOND call for the
  // SAME project onto that project's own last known state — never onto
  // another project's.
  it('a second concurrent call for the SAME project collapses onto its own state, not an empty cross-project leak', async () => {
    const first = runAllChecks(ctxA);
    const second = runAllChecks(ctxA);

    const [firstResults, secondResults] = await Promise.all([first, second]);
    expect(firstResults.some((i) => i.type === 'unsupported_claim' && i.nodeUri === 'urn:claim:a')).toBe(true);
    // No prior run had completed for A yet, so the collapsed call sees A's
    // own (empty) last-known state — not [] because someone ELSE was running.
    expect(secondResults).toEqual([]);
  });
});
