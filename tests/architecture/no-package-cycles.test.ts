/**
 * @vitest-environment node
 *
 * No cycles between `src/main/*` PACKAGES (#2238, epic #2241).
 *
 * Its sibling `no-cycles.test.ts` checks module cycles and is well built — real
 * resolution through `dependency-cruiser`, type-only imports followed,
 * self-recursion excluded by rule rather than allowlist. It passes. It has
 * always passed. And underneath a clean module graph, `graph ↔ notebase` was a
 * genuine two-way package dependency:
 *
 *     graph/indexers/rebuild.ts  → notebase/{indexable-files, ignored-dirs}
 *     graph/health-checks.ts     → notebase/asset-references
 *     notebase/{write-pipeline, rename, merge, watch-handlers, …} → graph/*
 *
 * Every one of those edges points at a different file, so no file imports
 * itself back and the module test is *correct* to pass. The coupling is real
 * anyway: you cannot read, move, or reason about either package without the
 * other, which is the thing a cycle check is supposed to tell you.
 *
 * That is the shape this whole epic is about — an invariant ("the packages are
 * layered") policed one notch narrower than it is stated ("no file cycles"),
 * with the gap already inhabited.
 *
 * ── What counts as a package ────────────────────────────────────────────────
 * A directory under `src/main/` (`graph`, `notebase`, `llm`, `ipc`, …), plus
 * one bucket each for `shared`, `renderer`, `preload` and `cli`. Deliberately
 * coarse: this is about top-level structure, and a finer split would report
 * `graph/queries ↔ graph/state` pairs that are a package working with its own
 * internals.
 *
 * Files sitting DIRECTLY under `src/main/` are excluded, and that exclusion is
 * load-bearing rather than convenient. They are two things, neither a package:
 * the composition root (`main.ts`, `window-manager.ts`, `menu.ts`,
 * `project-context.ts`) which wires every package by definition, and leaf
 * modules everything imports (`project-context-types.ts`, `secret-storage.ts`,
 * `project-config.ts`) which import almost nothing back. Bucketing those
 * together manufactured a `main ↔ <every package>` cycle out of "the root
 * wires X" plus "X imports the ProjectContext type" — thirteen findings, none
 * of them real. A check that cries wolf thirteen times is one nobody reads.
 *
 * ── The KNOWN list ──────────────────────────────────────────────────────────
 * Like every other ratchet here, it may only shrink, and the entries are real
 * findings rather than noise — #2238 scoped itself to `graph ↔ notebase` and
 * these are what was underneath once that one was broken.
 *
 * Worth knowing before opening any of them: **none is a tangle.** Every entry
 * has a thinner direction of one or two imports. What the cycle reports is
 * almost always a single module that is in the wrong package, not two
 * subsystems that grew into each other. They split three ways:
 *
 *   - **Mis-homed modules — cleared by #2283.** Three pure leaves sitting in
 *     the wrong package accounted for four of the nine: `ipc/read-json.ts`
 *     (a JSON file helper importing only `node:fs`), `llm/turtle.ts` (Turtle
 *     escaping, no imports at all) and `bibliography/scan-citations.ts` (a
 *     wiki-link scanner). Worth knowing how that one went: the issue proposed
 *     extracting the whole `publish/csl/` subsystem to break
 *     `bibliography ↔ publish`, but all FIVE `publish → bibliography` edges
 *     turned out to be the same `scanCitations` import. One file move, not a
 *     subsystem extraction. Measure the edges before designing the fix.
 *   - **Layer questions (#2284).** Four single imports that each pose a real
 *     "should this package know about that one": the watcher sending to
 *     windows, source mining calling the LLM, the file watcher driving the
 *     Python kernel, source merging rewriting links.
 *   - `graph ↔ types`, tracked by #2231/#2234.
 */
import { describe, it, expect } from 'vitest';
import { cruise, type IModule } from 'dependency-cruiser';

const CRUISE_OPTIONS = {
  doNotFollow: { path: 'node_modules' },
  exclude: { path: '(node_modules|\\.d\\.ts$)' },
  // Type-only imports are design-time dependencies: a package you must import
  // a type from is a package you depend on, even though nothing is emitted.
  // This is what makes moving `OrphanedAsset` to `shared/` (#2238) load-bearing
  // rather than cosmetic.
  tsPreCompilationDeps: true,
  enhancedResolveOptions: { extensions: ['.ts', '.mts', '.js', '.mjs', '.svelte'] },
};

/**
 * Package that owns a module path, or null for anything outside `src/`.
 *
 * `src/main/graph/queries/sources.ts` → `main/graph`
 * `src/main/project-context.ts`       → null (composition root, not a package)
 * `src/shared/time.ts`                → `shared`
 */
export function packageOf(modulePath: string): string | null {
  const parts = modulePath.split('/');
  if (parts[0] !== 'src') return null;
  const layer = parts[1];
  if (layer === undefined) return null;
  if (layer !== 'main') return layer;
  // Loose files directly under src/main/ are the composition root and its leaf
  // types — not a package. See the header for why lumping them together
  // fabricated a cycle with everything.
  return parts.length > 3 ? `main/${parts[2]}` : null;
}

/** `a ↔ b`, with the pair ordered so the key is stable whichever way round. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a} <-> ${b}` : `${b} <-> ${a}`;
}

/**
 * Cycles between packages the epic has accepted for now. MAY ONLY SHRINK —
 * adding an entry means a new package cycle, which is the thing this test is
 * for. Each needs a reason and an issue.
 */
const KNOWN_PACKAGE_CYCLES = new Set<string>([
  // The one the review named alongside graph ↔ notebase, explicitly out of
  // scope for #2238: same coupling as the `materializeTypeClasses` hole
  // (#2231) and the GraphState decomposition (#2234), tracked there.
  // graph/indexers/rebuild.ts → types/{loader,compile}; types/compile.ts →
  // graph/state.ts.
  'main/graph <-> main/types',

  // (#2283 cleared four more: `ipc/read-json.ts` → `config/json-file.ts`,
  // `llm/turtle.ts` → `shared/turtle.ts`, `bibliography/scan-citations.ts` →
  // `shared/scan-citations.ts`. All three were pure leaves in the wrong
  // package — no design decision in any of them.)

  // ── A layering question (#2284) — one import, but a real decision ────────
  // NOT the same as the group above, and `ipc/broadcast.ts` is the reason to
  // say so: unlike read-json it IS genuinely IPC (a typed main→renderer
  // channel send checked against EventMap), so the fix is not to move it. The
  // question is whether `notebase/watcher.ts` should be sending to a window at
  // all, rather than emitting an event the IPC layer forwards. The other three
  // are the same shape: one module reaching across a boundary that may or may
  // not be the right one.
  'main/ipc <-> main/notebase',      // notebase/watcher.ts → ipc/broadcast.ts
  'main/llm <-> main/sources',       // sources/mine-references.ts → llm/index.ts
  'main/compute <-> main/notebase',  // notebase/watch-handlers.ts → compute/python-kernel.ts
  'main/notebase <-> main/sources',  // sources/merge-sources.ts → notebase/{fs,link-rewriting}
]);

interface Edge { from: string; to: string; via: string }

async function packageEdges(): Promise<Edge[]> {
  const result = await cruise(['src'], CRUISE_OPTIONS);
  const modules = ((result.output as { modules: IModule[] }).modules ?? []);
  const edges: Edge[] = [];
  for (const module of modules) {
    const from = packageOf(module.source);
    if (from === null) continue;
    for (const dependency of module.dependencies ?? []) {
      const to = packageOf(dependency.resolved);
      if (to === null || to === from) continue;
      edges.push({ from, to, via: `${module.source} → ${dependency.resolved}` });
    }
  }
  return edges;
}

/** Two-way package dependencies, with one example edge in each direction. */
async function findPackageCycles(): Promise<Array<{ pair: string; examples: string[] }>> {
  const edges = await packageEdges();
  const byDirection = new Map<string, string[]>();
  for (const edge of edges) {
    const key = `${edge.from} -> ${edge.to}`;
    if (!byDirection.has(key)) byDirection.set(key, []);
    byDirection.get(key)!.push(edge.via);
  }

  const found = new Map<string, string[]>();
  for (const [key, examples] of byDirection) {
    const [from, to] = key.split(' -> ') as [string, string];
    const back = byDirection.get(`${to} -> ${from}`);
    if (!back) continue;
    const pair = pairKey(from, to);
    if (found.has(pair)) continue;
    found.set(pair, [examples[0]!, back[0]!]);
  }
  return [...found].map(([pair, examples]) => ({ pair, examples }));
}

describe('package-level cycles in src/main (#2238)', () => {
  it('packageOf buckets a path to its package', () => {
    // The whole test reduces to this mapping, so a silent change to it would
    // turn the check into a tautology over one giant package.
    expect(packageOf('src/main/graph/queries/sources.ts')).toBe('main/graph');
    expect(packageOf('src/main/graph/index.ts')).toBe('main/graph');
    expect(packageOf('src/main/project-context.ts')).toBeNull();
    expect(packageOf('src/main/project-context-types.ts')).toBeNull();
    expect(packageOf('src/shared/time.ts')).toBe('shared');
    expect(packageOf('src/renderer/App.svelte')).toBe('renderer');
    expect(packageOf('node_modules/x/index.js')).toBeNull();
  });

  it('resolves a real graph — an empty edge list would pass vacuously', async () => {
    const edges = await packageEdges();
    expect(edges.length).toBeGreaterThan(500);
    // The known one-way dependency this epic is protecting: notebase drives
    // the indexer on every write. If this stops appearing, the resolver broke.
    expect(edges.some((e) => e.from === 'main/notebase' && e.to === 'main/graph')).toBe(true);
  });

  it('graph does not import notebase — the edge #2238 broke', async () => {
    // Named separately from the ratchet below so a regression says WHICH
    // boundary came back, not just that the count went up.
    const edges = await packageEdges();
    const back = edges.filter((e) => e.from === 'main/graph' && e.to === 'main/notebase');
    expect(back.map((e) => e.via)).toEqual([]);
  });

  it('has no package cycles beyond the known list', async () => {
    const cycles = await findPackageCycles();
    const unexpected = cycles.filter((c) => !KNOWN_PACKAGE_CYCLES.has(c.pair));

    if (unexpected.length > 0) {
      expect.fail(
        `New package-level cycle(s):\n\n` +
        unexpected.map((c) => `  ${c.pair}\n${c.examples.map((e) => `    ${e}`).join('\n')}`).join('\n\n') +
        `\n\nTwo packages that import each other can't be read, moved or tested apart, ` +
        `even when no single FILE imports itself back (which is why no-cycles.test.ts ` +
        `passes on these). Break the thinner direction — usually a leaf utility that ` +
        `belongs in src/shared, or a collaborator the caller should inject — rather ` +
        `than adding an entry above.`,
      );
    }
  });

  it('the known list has no stale entries', async () => {
    // A ratchet that keeps listing a cycle somebody already fixed teaches the
    // next reader that the list is decorative.
    const cycles = new Set((await findPackageCycles()).map((c) => c.pair));
    const stale = [...KNOWN_PACKAGE_CYCLES].filter((pair) => !cycles.has(pair));
    expect(stale, 'fixed — delete these from KNOWN_PACKAGE_CYCLES').toEqual([]);
  });
});
