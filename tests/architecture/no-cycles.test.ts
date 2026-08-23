/**
 * @vitest-environment node
 *
 * No import cycles anywhere in `src/` (#1847, epic #1855).
 *
 * The layer *directions* are enforced by eslint (`eslint.config.mjs` — shared
 * ↛ main/renderer/preload, main ↛ renderer, renderer ↛ main, cli ↛ renderer).
 * Cycles are the orthogonal property, and until now nothing checked them:
 * `madge` wasn't a dependency, no test ran it, CI never looked. "Zero cycles
 * across 452 files" was a reviewer running it by hand, once. A cycle *within*
 * a layer — `llm/a → llm/b → llm/a` — passed lint, type-check and the whole
 * suite.
 *
 * That matters here because the codebase leans on acyclicity deliberately and
 * says so: `graph/indexers.ts` documents importing from `./state` "never from
 * `./index`, to keep the package acyclic"; `history/index.ts` spells out
 * `notebase/fs → history → store → policy` and notes that restore
 * orchestration lives in the IPC layer "never the reverse". Those are design
 * decisions currently held by comments and care. This holds them by test.
 *
 * `dependency-cruiser` resolves the real graph — tsconfig paths, extensionless
 * imports, `.svelte` files, type-only imports — rather than a regex over
 * import lines. A cycle detector that silently misses edges is worse than
 * none, because it reads as a guarantee.
 */
import { describe, it, expect } from 'vitest';
import { cruise, type IModule } from 'dependency-cruiser';

/** One cycle, rendered as the import chain that closes it. */
interface Cycle {
  from: string;
  chain: string;
}

const CRUISE_OPTIONS = {
  doNotFollow: { path: 'node_modules' },
  exclude: { path: '(node_modules|\\.d\\.ts$)' },
  // Follow type-only imports too: `import type { X } from './y'` is erased at
  // runtime but is still a design-time dependency, and a cycle made of them is
  // exactly as confusing to read.
  tsPreCompilationDeps: true,
  enhancedResolveOptions: { extensions: ['.ts', '.mts', '.js', '.mjs', '.svelte'] },
};

async function graphModules(): Promise<IModule[]> {
  const result = await cruise(['src'], CRUISE_OPTIONS);
  return (result.output as { modules: IModule[] }).modules ?? [];
}

async function findCycles(): Promise<Cycle[]> {
  const modules = await graphModules();
  return modules.flatMap((module) =>
    (module.dependencies ?? [])
      .filter((dependency) => dependency.circular)
      // A component that renders itself — FileTree for nested folders,
      // SplitContainer for nested splits — reports as a one-module cycle.
      // That's a recursive template, not two modules that can't be understood
      // apart, so it isn't what this test is about. Note this is a RULE about
      // self-reference, not an allowlist of known-bad pairs: a genuine A → B →
      // A still fails, whichever modules A and B are.
      .filter((dependency) => dependency.resolved !== module.source)
      .map((dependency) => ({
        from: module.source,
        chain: [module.source, ...(dependency.cycle ?? []).map((step) =>
          typeof step === 'string' ? step : step.name,
        )].join('\n     → '),
      })),
  );
}

describe('src has no import cycles (#1847)', () => {
  it('resolves the real graph — a miss here would read as a guarantee', async () => {
    const modules = await graphModules();
    // Sanity floor: if resolution silently breaks, the cycle check below would
    // pass vacuously on a graph of nothing.
    expect(modules.length).toBeGreaterThan(400);
    expect(modules.some((m) => m.source.endsWith('.svelte'))).toBe(true);
  }, 60_000);

  it('has none', async () => {
    const cycles = await findCycles();
    if (cycles.length > 0) {
      // Name the chain, not just the count — the fix is always "which edge
      // should not exist", and that's unreadable from a number.
      const detail = cycles.map((c) => `  ${c.chain}`).join('\n\n');
      expect.fail(`${cycles.length} import cycle(s) in src/:\n\n${detail}\n`);
    }
    expect(cycles).toEqual([]);
  }, 60_000);
});
