/**
 * @vitest-environment node
 *
 * The DuckDB native binding stays off the boot path (#2335).
 *
 * `main.ts` pulls its whole dependency graph at module scope, and the heaviest
 * single edge was a native binding reached for a `before-quit` handler:
 *
 *     main.ts            import { flushAllProjects } from './project-context'
 *       → project-context   import * as tables  from './sources/tables'
 *       → project-context   import * as vectors from './embeddings/vector-store'
 *         → both            import … from '@duckdb/node-api'
 *
 * `libduckdb.dylib` in the packaged app is 107MB. Measured unbundled, a cold
 * `@duckdb/node-api` import is 2,896ms — the largest item on the boot path by
 * a wide margin, ahead of `@comunica` at 732ms — against ~12ms warm, because
 * the library is lazily mapped. So it is a first-launch and post-reboot cost,
 * paid by every user including the ones who never open a table.
 *
 * ── Why this is a source-level check ────────────────────────────────────────
 * The property that matters is about the built bundle, and the honest way to
 * test it would be to build and inspect. That takes minutes and needs
 * `electron-forge`, so it cannot sit in the unit suite. What CAN be checked
 * cheaply and deterministically is the thing that would cause the regression:
 * a **value** import of `@duckdb/node-api` outside the lazy loader. Vite
 * follows static value imports into the entry chunk; a `import type` is erased
 * before the bundler ever sees it, and an `await import()` becomes a separate
 * chunk.
 *
 * So this is a ratchet on the cause, not an assertion about the artifact. It
 * says so rather than implying it proves more than it does.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');

/** The one module allowed to load it, relative to `src/`. */
const LAZY_LOADER = path.join('main', 'duckdb-lazy.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|svelte)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Source lines importing the package, split by whether the import erases. */
function duckdbImports(): { value: string[]; typeOnly: string[] } {
  const value: string[] = [];
  const typeOnly: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    const source = fs.readFileSync(file, 'utf-8');
    // Walk BACK from each `from '@duckdb/node-api'` to the `import` that owns
    // it. A forward lazy match (`import\s+([\s\S]*?)from …`) looks equivalent
    // and is not: with the `m` flag it anchors at the FIRST import in the file
    // and spans every statement in between, so the captured clause never
    // starts with `type` and every importer reads as a value import. That is
    // how the first version of this test failed against correct code.
    //
    // `await import(…)` is deliberately not matched — it is the shape this
    // test exists to encourage.
    for (const m of source.matchAll(/from\s*['"]@duckdb\/node-api['"]/g)) {
      const before = source.slice(0, m.index);
      const start = before.lastIndexOf('import');
      if (start < 0) continue;
      const clause = before.slice(start + 'import'.length);
      // `import type { … }` erases wholesale. A mixed clause
      // (`import { X, type Y }`) still pulls the module in for `X`.
      if (/^\s*type\b/.test(clause)) typeOnly.push(rel);
      else value.push(rel);
    }
  }
  return { value, typeOnly };
}

describe('the DuckDB binding is loaded lazily (#2335)', () => {
  it('only the lazy loader imports it for its value', () => {
    const { value } = duckdbImports();
    expect(
      value,
      'a static value import of @duckdb/node-api puts a 107MB native binding back '
        + 'on the pre-window boot path. Use `await duckdb()` from `main/duckdb-lazy.ts`, '
        + 'or `import type` if only the types are needed (#2335).',
    ).toEqual([LAZY_LOADER]);
  });

  it('the scan finds the type-only importers — an empty scan would pass vacuously', () => {
    // Without this, deleting DuckDB from the codebase entirely, or breaking
    // the regex, would look identical to a clean result.
    const { typeOnly } = duckdbImports();
    expect(typeOnly.length).toBeGreaterThanOrEqual(2);
    expect(typeOnly).toContain(path.join('main', 'sources', 'tables.ts'));
    expect(typeOnly).toContain(path.join('main', 'embeddings', 'vector-store.ts'));
  });

  it('the lazy loader really is dynamic', () => {
    // The loader is exempted above by path, so its own body has to be checked
    // or the exemption is a hole: a static import there would satisfy the
    // first test while restoring the exact defect.
    const source = fs.readFileSync(path.join(SRC, LAZY_LOADER), 'utf-8');
    expect(source).toMatch(/await import\(['"]@duckdb\/node-api['"]\)|import\(['"]@duckdb\/node-api['"]\)/);
    expect(
      /^\s*import\s+(?!type\s)[\s\S]*?from\s+['"]@duckdb\/node-api['"]/m.test(source),
      'the lazy loader statically imports the package it exists to defer',
    ).toBe(false);
  });

  it('project-context does not reach the binding statically', () => {
    // The specific chain from the issue. `main.ts` imports `project-context`
    // for a `before-quit` handler, and that is how a table engine ended up on
    // the path to first paint.
    const pc = fs.readFileSync(path.join(SRC, 'main', 'project-context.ts'), 'utf-8');
    expect(/from\s+['"]@duckdb\/node-api['"]/.test(pc)).toBe(false);

    for (const rel of [
      path.join('main', 'sources', 'tables.ts'),
      path.join('main', 'embeddings', 'vector-store.ts'),
    ]) {
      const source = fs.readFileSync(path.join(SRC, rel), 'utf-8');
      expect(
        source.includes("from '../duckdb-lazy'"),
        `${rel} should reach DuckDB through the lazy loader`,
      ).toBe(true);
    }
  });
});
