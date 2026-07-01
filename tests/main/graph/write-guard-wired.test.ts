/**
 * Integration coverage for the LLM write guard (#657, hardened in #944).
 *
 * write-guard.test.ts unit-tests the guard primitive (checkLLMWriteGuard). This
 * file proves the guard is actually WIRED INTO the real graph write path: it
 * drives the genuine `parseIntoStore` / `removeMatchingTriples` and asserts that
 *   - a direct write in LLM context (i.e. bypassing the approval engine) is
 *     caught, and
 *   - the same write inside the approval engine's *trusted* context is exempt.
 *
 * That's the "verify the approval gate cannot be skipped" check CLAUDE.md's
 * LLM/Graph checklist asks for.
 *
 * #944 made the guard FATAL under test (it throws), so the invariant "every
 * LLM-originated write goes through proposeWrite()/approveProposal()" is
 * enforced in CI, not merely observed in a warning. In dev/prod it stays a
 * non-fatal warning (a dev guardrail must never crash the user's app).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseIntoStore, removeMatchingTriples, queryGraph } from '../../../src/main/graph/index';
import {
  enterLLMContext,
  exitLLMContext,
  enterTrustedContext,
  exitTrustedContext,
  withLLMContext,
  __resetWriteGuardForTests,
} from '../../../src/main/graph/write-guard';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const S = 'https://minerva.dev/c/guard-test';
const P = 'https://minerva.dev/ontology/thought#label';
const TRIPLE = `<${S}> <${P}> "guarded" .`;

async function objectsOf(ctx: ProjectContext): Promise<string[]> {
  const r = await queryGraph(ctx, `SELECT ?o WHERE { <${S}> <${P}> ?o }`);
  return (r.results as Array<{ o: string }>).map((x) => x.o);
}

describe('LLM write guard wired into the graph write path (#657, fatal #944)', () => {
  const project = useGraphProject('minerva-guard-wired-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = project.ctx; // fresh per test (useGraphProject's beforeEach ran first)
    __resetWriteGuardForTests();
  });

  afterEach(() => {
    // A thrown guard skips the paired exitLLMContext(); reset so the counter
    // doesn't leak into the next test.
    __resetWriteGuardForTests();
  });

  it('a direct parseIntoStore in LLM context (bypassing approval) throws — and the write is rejected', async () => {
    enterLLMContext();
    expect(() => parseIntoStore(ctx, TRIPLE)).toThrow(/\[trust-guard\].*parseIntoStore/);
    exitLLMContext();
    // Fatal means blocked: the triple never landed.
    expect(await objectsOf(ctx)).not.toContain('guarded');
  });

  it('the trust-guard message names the right path (proposeWrite/approveProposal)', () => {
    enterLLMContext();
    expect(() => parseIntoStore(ctx, TRIPLE)).toThrow(/proposeWrite\(\)\/approveProposal\(\)/);
    exitLLMContext();
  });

  it('the SAME write inside the approval engine\'s trusted context is exempt', async () => {
    // This is how the approval engine applies an approved proposal: an LLM-
    // originated path, but wrapped in the trusted context so its writes are
    // legitimate.
    enterLLMContext();
    enterTrustedContext();
    expect(() => parseIntoStore(ctx, TRIPLE)).not.toThrow();
    exitTrustedContext();
    exitLLMContext();
    expect(await objectsOf(ctx)).toContain('guarded'); // and it actually landed
  });

  it('a normal write outside any LLM context is silent', async () => {
    expect(() => parseIntoStore(ctx, TRIPLE)).not.toThrow();
    expect(await objectsOf(ctx)).toContain('guarded');
  });

  it('removeMatchingTriples is guarded on the same path', () => {
    parseIntoStore(ctx, TRIPLE); // seed outside LLM context
    enterLLMContext();
    expect(() => removeMatchingTriples(ctx, S, P)).toThrow(/\[trust-guard\].*removeMatchingTriples/);
    exitLLMContext();
  });

  it('withLLMContext arms the guard — a bypass write inside it is rejected (#944)', async () => {
    // This is exactly what the converged apply helpers (auto-tag/-link, set/
    // source properties, note-body) wrap themselves in. A regression that writes
    // to the graph directly instead of via proposeWrite() fails here.
    await expect(
      withLLMContext(async () => parseIntoStore(ctx, TRIPLE)),
    ).rejects.toThrow(/\[trust-guard\]/);
    expect(await objectsOf(ctx)).not.toContain('guarded'); // rejected, never landed
    // The wrapper still exited LLM context despite the throw.
    expect(() => parseIntoStore(ctx, TRIPLE)).not.toThrow();
  });
});
