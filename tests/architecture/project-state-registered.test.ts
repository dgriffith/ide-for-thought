/**
 * @vitest-environment node
 *
 * Per-project state lives in a `createProjectStore` slot (#2240, epic #2241).
 *
 * `createProjectStore` (#1085) exists so that closing a thoughtbase tears down
 * every subsystem's state by iterating a registry, instead of
 * `project-context.ts` remembering to name each one. A module-level
 * `Map`/`Set` keyed by `rootPath` opts out of that silently: nothing fails, no
 * lint fires, and `disposeAllProjectStores` simply cannot see it.
 *
 * `graph/health-checks.ts` had four. Two were torn down because the
 * orchestrator named them; `lastResultsByProject` had no `.delete` call
 * anywhere in the codebase, so closing a thoughtbase left its whole inspection
 * list resident and reopening served last session's findings from memory —
 * `getInspections` is the `INSPECTIONS_GET` handler. A wrong answer, not just
 * a leak, and invisible for as long as nobody went looking.
 *
 * This finds the shape rather than the symptom: a collection indexed by
 * `rootPath` that wasn't built by `createProjectStore`. It reads identifiers,
 * not lines — `store.get(ctx)` (a real project store, keyed by the ctx) does
 * not match; `kernels.get(rootPath)` does.
 *
 * ── The KNOWN list ──────────────────────────────────────────────────────────
 * May only shrink, like every ratchet here. Each entry is torn down today by
 * an explicit call from `project-context.ts` — which is exactly the
 * arrangement the two surviving health-check maps had, and the reason the
 * other two going unnoticed was possible. They are not bugs; they are the
 * places where the next one would hide.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = path.join(ROOT, 'src', 'main');

/** The registry itself, which is allowed to key a map by rootPath. */
const EXEMPT = new Set(['src/main/project-store.ts']);

/**
 * Collections keyed by `rootPath` outside the registry, with the explicit
 * teardown that keeps each one honest today. MAY ONLY SHRINK.
 */
const KNOWN_UNREGISTERED: Record<string, string> = {
  // AbortControllers for in-flight embedding backfills.
  // Torn down by `abortBackfill(rootPath)` — project-context.ts:145.
  'src/main/embeddings/backfill.ts': 'running',
  // Per-project token + ctx advertised to out-of-process CLI/MCP clients.
  // Torn down by `unregisterProject(rootPath)` — project-context.ts:148.
  'src/main/substrate/app-server.ts': 'registry',
  // Live Python kernels. Torn down by the compute shutdown path rather than by
  // the project registry — the closest remaining relative of the health-check
  // maps, and the one worth looking at next.
  'src/main/compute/python-kernel.ts': 'kernels',
  // Collision listeners for CSV table-name clashes; unsubscribed by their
  // callers rather than held for a project's lifetime.
  'src/main/sources/tables.ts': 'collisionListeners',
  // The orchestrator's own registry of open projects — the thing that DRIVES
  // disposal, so it cannot itself be a project store.
  'src/main/project-context.ts': 'projects',
};

/** `foo.get(rootPath)`, `foo.set(ctx.rootPath, …)`, `foo.has(rootPath)`, … */
const KEYED_BY_ROOT = /\b([A-Za-z_$][\w$]*)\s*\.\s*(?:get|set|has|delete|add)\s*\(\s*(?:ctx\s*\.\s*)?rootPath\s*[,)]/g;

/** `const foo = createProjectStore<…>(…)` — the thing that is NOT a finding. */
function projectStoreNames(source: string): Set<string> {
  const names = new Set<string>();
  const re = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*createProjectStore\b/g;
  for (const m of source.matchAll(re)) names.add(m[1]!);
  return names;
}

function mainFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
    }
  };
  walk(MAIN);
  return out;
}

interface Finding { file: string; name: string }

function unregisteredProjectState(): Finding[] {
  const found: Finding[] = [];
  for (const file of mainFiles()) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (EXEMPT.has(relative)) continue;
    const source = fs.readFileSync(file, 'utf-8');
    const stores = projectStoreNames(source);
    const names = new Set<string>();
    for (const m of source.matchAll(KEYED_BY_ROOT)) {
      const name = m[1]!;
      if (!stores.has(name)) names.add(name);
    }
    for (const name of names) found.push({ file: relative, name });
  }
  return found;
}

describe('per-project state is registered with createProjectStore (#2240)', () => {
  it('the scan reads real files — an empty walk would pass vacuously', () => {
    expect(mainFiles().length).toBeGreaterThan(200);
    // A real project store must NOT be reported, or the check is just noise.
    expect(projectStoreNames("const store = createProjectStore<S>({ dispose: () => {} });")).toEqual(
      new Set(['store']),
    );
  });

  it('recognises the shape it is looking for', () => {
    // The regex is the whole test. Pinned directly so a change to it can't
    // quietly turn the ratchet into a tautology that matches nothing.
    const sample = `
      const cache = new Map<string, number>();
      cache.set(ctx.rootPath, 1);
      const real = createProjectStore<number>();
      real.get(ctx);
    `;
    const stores = projectStoreNames(sample);
    const hits = [...sample.matchAll(KEYED_BY_ROOT)].map((m) => m[1]!).filter((n) => !stores.has(n));
    expect(hits).toEqual(['cache']);
  });

  it('health-checks.ts holds no hand-rolled per-project map', () => {
    // Named on its own so a regression says which file came back, rather than
    // only that a count moved. This is the file #2240 fixed.
    const found = unregisteredProjectState().filter((f) => f.file === 'src/main/graph/health-checks.ts');
    expect(found).toEqual([]);
  });

  it('has no unregistered per-project state beyond the known list', () => {
    const unexpected = unregisteredProjectState().filter(
      (f) => KNOWN_UNREGISTERED[f.file] !== f.name,
    );

    if (unexpected.length > 0) {
      expect.fail(
        `Per-project state outside the project-store registry:\n\n` +
        unexpected.map((f) => `  ${f.file} — \`${f.name}\` keyed by rootPath`).join('\n') +
        `\n\n\`disposeAllProjectStores\` cannot reach these, so closing a thoughtbase ` +
        `leaves them resident and reopening it can serve the previous session's state ` +
        `(#2240). Use \`createProjectStore<T>({ dispose })\` instead — it self-registers, ` +
        `so teardown is free and the orchestrator doesn't have to name your subsystem.`,
      );
    }
  });

  it('the known list has no stale entries', () => {
    // A list that keeps naming something already fixed teaches the next reader
    // that it's decorative.
    const live = new Set(unregisteredProjectState().map((f) => `${f.file}::${f.name}`));
    const stale = Object.entries(KNOWN_UNREGISTERED)
      .map(([file, name]) => `${file}::${name}`)
      .filter((key) => !live.has(key));
    expect(stale, 'fixed or renamed — update KNOWN_UNREGISTERED').toEqual([]);
  });
});
