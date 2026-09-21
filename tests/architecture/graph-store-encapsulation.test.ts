/**
 * @vitest-environment node
 *
 * The rdflib store stays inside the graph package (#2234 PR 3, epic #2241).
 *
 * `GraphState` used to be an open twelve-field record, and `store` — the
 * mutable `IndexedFormula` that IS the knowledge graph — was as reachable as
 * any other field. #2234 asked for it to be made non-public "so bypass callers
 * have to come through the facade". One caller actually was bypassing:
 * `types/compile.ts`'s `materializeTypeClasses` held the graph's internal store
 * and wrote to it directly from another package, with no facade between them.
 * That was also half of a package-level cycle (`types/compile` → `graph/state`,
 * `graph/indexers/rebuild` → `types/compile`) that file-level cycle detection
 * could not see, because `state.ts` imports nothing back.
 *
 * PR 3 moved that function into `graph/indexers/type-classes.ts`. This test is
 * what stops the next one appearing.
 *
 * ── What it checks ─────────────────────────────────────────────────────────
 * No module outside `src/main/graph/` may name `GraphState` or reach `.store`
 * on it. That is the state boundary, and it is checkable with no false
 * positives.
 *
 * ── What it deliberately does NOT check, and why ────────────────────────────
 * **The ~240 call sites inside `graph/`.** Those are the indexers and the query
 * layer; the graph package working with its own data structure is not a
 * layering violation, and routing them through `addTriple()`/`query()` wrappers
 * would be churn on the scale the issue's own "don't just rename the problem"
 * warning cautions against. Since #2231 every one of those writes already
 * passes through the write guard at the `store.add`/`store.removeMatches`
 * chokepoint, which is the protection a facade would have been providing.
 *
 * **A bare `IndexedFormula` handed across the boundary** — which is, honestly,
 * the exact shape `materializeTypeClasses` had. It took
 * `store: $rdf.IndexedFormula`, named no `GraphState` and read no `.store`
 * field, so this test would NOT have caught it. It cannot: lexically there is
 * no difference between the graph's store handed to a stranger and the private
 * scratch `$rdf.graph()` that `sources/import-zotero-rdf.ts` legitimately
 * builds, reads and discards. Flagging the pattern would fail on the innocent
 * case; not flagging it misses the guilty one.
 *
 * What prevents a repeat is structural rather than lexical: the compiler now
 * lives inside `graph/`, so there is no external module holding the store to
 * hand it to. This test guards the half that CAN be guarded — and if a facade
 * for external callers is ever genuinely wanted, it makes skipping it visible.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GRAPH_DIR = 'src/main/graph/';

/**
 * Modules allowed to reach the store from outside `graph/`. Empty, and meant to
 * stay that way — an entry here is a documented hole in the boundary, so it
 * needs a reason and a plan, not just a path.
 */
const ALLOWED_OUTSIDE: Record<string, string> = {};

/** Reading the store field off graph state — `state.store`, `getState(ctx)!.store`.
 *  Anchored on the state variable, NOT on any identifier called `store`: a
 *  module's own scratch `$rdf.graph()` is not the graph's store. */
const STORE_FIELD = /\b(state|graphState|getState\([^)]*\))\s*(!|\?)?\.store\b/;

/** Naming the state type at all — the other way to get typed access to it. */
const GRAPH_STATE = /\bGraphState\b/;

/**
 * `.ts` under `src/main`, excluding the graph package itself.
 *
 * Walks the filesystem rather than `git ls-files` deliberately: the case this
 * test exists for is a NEW module reaching into the store, and a new module is
 * untracked until it's staged. Reading the index would let the author's own
 * `pnpm test` pass and leave the failure for CI.
 */
function modulesOutsideGraph(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (!rel.startsWith(GRAPH_DIR)) out.push(rel);
      }
    }
  };
  walk(path.join(ROOT, 'src', 'main'));
  return out.sort();
}

/** Drop comments so prose about the store never counts as a use. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function offenders(): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  for (const file of modulesOutsideGraph()) {
    if (file in ALLOWED_OUTSIDE) continue;
    const lines = stripComments(readFileSync(path.join(ROOT, file), 'utf-8')).split('\n');
    lines.forEach((text, i) => {
      if (STORE_FIELD.test(text) || GRAPH_STATE.test(text)) {
        out.push({ file, line: i + 1, text: text.trim() });
      }
    });
  }
  return out;
}

describe('graph store encapsulation (#2234 PR 3)', () => {
  it('finds modules to police — an empty scan would pass vacuously', () => {
    const modules = modulesOutsideGraph();
    expect(modules.length).toBeGreaterThan(50);
    expect(modules.some((f) => f.startsWith('src/main/types/'))).toBe(true);
  });

  it('the patterns match the shape they are meant to catch, and only that', () => {
    // Guards the regexes themselves: a typo that matched nothing would make the
    // real assertion below pass forever.
    expect(STORE_FIELD.test('const { store } = state.store;')).toBe(true);
    expect(STORE_FIELD.test('getState(ctx)!.store.add(s, p, o);')).toBe(true);
    expect(GRAPH_STATE.test('function f(state: GraphState): void {')).toBe(true);

    // And that they do NOT flag a module's own scratch rdflib graph, which is
    // what `sources/import-zotero-rdf.ts` legitimately builds and reads.
    expect(STORE_FIELD.test('const store = $rdf.graph();')).toBe(false);
    expect(STORE_FIELD.test('for (const st of store.statementsMatching(s, p, o)) {')).toBe(false);
    expect(STORE_FIELD.test('function collectBibItems(store: IndexedFormula) {')).toBe(false);
    expect(STORE_FIELD.test('noteIndexStore.get(ctx)')).toBe(false);
  });

  it('no module outside src/main/graph/ touches the rdflib store', () => {
    const found = offenders();
    expect(
      found,
      'The rdflib store is the graph package\'s own data structure (#2234 PR 3). ' +
        'A module outside src/main/graph/ reaching it bypasses the facade AND the ' +
        'write guard\'s package-level reasoning:\n' +
        found.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join('\n') +
        '\n\nMove the operation into src/main/graph/ (that is what #2234 PR 3 did with ' +
        '`materializeTypeClasses`), or add a method to the graph\'s public surface and ' +
        'call that. Adding an ALLOWED_OUTSIDE entry is the last resort and needs a reason.',
    ).toEqual([]);
  });
});
