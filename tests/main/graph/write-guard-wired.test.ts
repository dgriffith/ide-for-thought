/**
 * Integration coverage for the LLM write guard (#657 / QA Q-C1).
 *
 * write-guard.test.ts unit-tests the guard primitive (checkLLMWriteGuard). This
 * file proves the guard is actually WIRED INTO the real graph write path: it
 * drives the genuine `parseIntoStore` / `removeMatchingTriples` and asserts that
 *   - a direct write in LLM context (i.e. bypassing the approval engine) is
 *     caught (warned), and
 *   - the same write inside the approval engine's *trusted* context is exempt.
 *
 * That's the "verify the approval gate cannot be skipped" check CLAUDE.md's
 * LLM/Graph checklist asks for — the previous test only exercised the counter
 * and never touched a real write.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseIntoStore, removeMatchingTriples, queryGraph } from '../../../src/main/graph/index';
import {
  enterLLMContext,
  exitLLMContext,
  enterTrustedContext,
  exitTrustedContext,
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

describe('LLM write guard wired into the graph write path (#657)', () => {
  const project = useGraphProject('minerva-guard-wired-');
  let ctx: ProjectContext;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctx = project.ctx; // fresh per test (useGraphProject's beforeEach ran first)
    __resetWriteGuardForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    __resetWriteGuardForTests();
  });

  it('a direct parseIntoStore in LLM context (bypassing approval) trips the guard', () => {
    enterLLMContext();
    parseIntoStore(ctx, TRIPLE);
    exitLLMContext();

    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('[trust-guard]');
    expect(msg).toContain('parseIntoStore');
    expect(msg).toContain('proposeWrite'); // the message tells you the right path
  });

  it('the SAME write inside the approval engine\'s trusted context is exempt', async () => {
    // This is how the approval engine applies an approved proposal: an LLM-
    // originated path, but wrapped in the trusted context so its writes are
    // legitimate.
    enterLLMContext();
    enterTrustedContext();
    parseIntoStore(ctx, TRIPLE);
    exitTrustedContext();
    exitLLMContext();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(await objectsOf(ctx)).toContain('guarded'); // and it actually landed
  });

  it('a normal write outside any LLM context is silent', async () => {
    parseIntoStore(ctx, TRIPLE);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(await objectsOf(ctx)).toContain('guarded');
  });

  it('removeMatchingTriples is guarded on the same path', () => {
    parseIntoStore(ctx, TRIPLE); // seed outside LLM context
    warnSpy.mockClear();

    enterLLMContext();
    removeMatchingTriples(ctx, S, P);
    exitLLMContext();

    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain('removeMatchingTriples');
  });

  it('warns but does NOT block — a dev guardrail, not a hard gate (per CLAUDE.md)', async () => {
    // The guard's documented contract: it surfaces a bypass, it doesn't reject
    // the write. Pinning that so a future "make it throw" is a conscious change,
    // not an accidental one.
    enterLLMContext();
    parseIntoStore(ctx, TRIPLE);
    exitLLMContext();

    expect(warnSpy).toHaveBeenCalled();
    expect(await objectsOf(ctx)).toContain('guarded');
  });
});
