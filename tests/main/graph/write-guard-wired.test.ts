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
 *
 * ── What #2231 changed about these assertions ───────────────────────────────
 * The guard moved from fourteen hand-pasted calls in the indexer facades to
 * the store chokepoint (`instrumentStoreMirror` wrapping store.add /
 * store.removeMatches). One real thing is lost: the message used to name the
 * facade (`parseIntoStore`, `removeMatchingTriples`) and now names the store
 * operation and the subject IRI (`store.add(<https://…>)`), because at the
 * chokepoint the facade is simply not known.
 *
 * That's worth stating rather than quietly editing the regexes below, since
 * the trade is deliberate: under test the guard THROWS, so the stack trace
 * names the facade and everything above it — strictly more than the old string
 * did. In dev/prod it warns, where the subject IRI identifies the write. What
 * the message can no longer do is tell you the facade from the log line alone.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseIntoStore,
  removeMatchingTriples,
  queryGraph,
  persistGraph,
  indexNote,
  indexAllNotes,
  reloadTypeCatalog,
} from '../../../src/main/graph/index';
import { getState } from '../../../src/main/graph/state';
import { addOntologyToStore } from '../../../src/main/graph/indexers/rebuild';
import { materializeTypeClasses } from '../../../src/main/graph/indexers/type-classes';
import type { TypeCatalog } from '../../../src/shared/objects/type-def';
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
    // `store.add`, not `parseIntoStore` — see the header. The subject IRI is
    // what identifies the write now.
    expect(() => parseIntoStore(ctx, TRIPLE)).toThrow(/\[trust-guard\].*store\.add\(<.*guard-test>\)/);
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
    expect(() => removeMatchingTriples(ctx, S, P)).toThrow(/\[trust-guard\].*store\.removeMatches\(<.*guard-test>\)/);
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

/**
 * The seven store-mutating functions the hand-pasted guard missed (#2231).
 *
 * Before the guard moved to the store chokepoint, coverage was whatever the
 * fourteen facades happened to opt into. These functions all mutate
 * `state.store` and none of them called `checkLLMWriteGuard` — so CLAUDE.md's
 * promise that "an LLM write that skips approval fails CI" was quietly
 * conditional on the write not arriving through any of them, and nobody
 * reading CLAUDE.md would have known which.
 *
 * `materializeTypeClasses` was the sharpest of the seven: it lived in
 * `src/main/types/`, held a reference to the graph package's internal
 * `IndexedFormula`, and wrote to it directly — no facade, no guard, no package
 * boundary. #2231 covered it the same way it covers everything else (it goes
 * through `store.add`, and that is where the guard lives); #2234 PR 3 then
 * moved it inside `graph/`, so the boundary violation is gone too. The case
 * stays because the guard coverage is what it asserts, and that is still worth
 * pinning wherever the function lives.
 */
describe('previously unguarded store mutations (#2231)', () => {
  const project = useGraphProject('minerva-guard-total-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = project.ctx;
    __resetWriteGuardForTests();
  });

  it('materializeTypeClasses is guarded', async () => {
    const state = getState(ctx)!;
    const catalog: TypeCatalog = {
      types: [{
        id: 'guard-probe',
        classLocalName: 'GuardProbe',
        label: 'Guard Probe',
        source: 'stock',
        properties: [],
      }],
      errors: [],
    };
    // Outside LLM context this is an ordinary, legitimate write.
    expect(() => materializeTypeClasses(state.store, catalog)).not.toThrow();

    await expect(
      withLLMContext(async () => materializeTypeClasses(state.store, catalog)),
    ).rejects.toThrow(/\[trust-guard\].*store\.add/);
  });

  it('addOntologyToStore is guarded', async () => {
    const state = getState(ctx)!;
    await expect(
      withLLMContext(async () => addOntologyToStore(state)),
    ).rejects.toThrow(/\[trust-guard\]/);
  });

  it('reloadTypeCatalog is guarded', async () => {
    await expect(
      withLLMContext(async () => reloadTypeCatalog(ctx)),
    ).rejects.toThrow(/\[trust-guard\]/);
  });

  it('indexAllNotes — the wholesale store swap — is guarded', async () => {
    await expect(
      withLLMContext(async () => indexAllNotes(ctx)),
    ).rejects.toThrow(/\[trust-guard\]/);
  });

  it('a turtle block inside a note is guarded, not logged away as a parse error', async () => {
    // `indexNote`'s per-block `$rdf.parse` sits in a try/catch that exists to
    // tolerate malformed Turtle. The guard now throws from INSIDE that try, so
    // without `rethrowIfTrustGuard` this bypass would be swallowed and printed
    // as "Failed to parse turtle block" — a guard that does nothing.
    const body = '# Note\n\n```turtle\nthis: <https://minerva.dev/ontology/thought#label> "x" .\n```\n';
    await expect(
      withLLMContext(async () => indexNote(ctx, 'notes/guarded.md', body)),
    ).rejects.toThrow(/\[trust-guard\]/);
  });

  it('persistGraph is exempt — it is serialization bookkeeping, and says so', async () => {
    // It strips the ontology triples, serializes, and puts them straight back.
    // It is also genuinely called from LLM context (proposal-persistence calls
    // it right after its trusted block closes), so a false positive here would
    // break every approved proposal.
    await expect(withLLMContext(async () => persistGraph(ctx))).resolves.toBeUndefined();
  });
});
