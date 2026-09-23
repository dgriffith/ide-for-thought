/**
 * @vitest-environment node
 *
 * The expensive modules stay off the boot path (#2335).
 *
 * `main.ts` pulls its whole dependency graph at module scope. Measured
 * unbundled, cold:
 *
 *     @duckdb/node-api   2,896ms   (libduckdb.dylib is 107MB in the package)
 *     @comunica/…          732ms
 *     openai               242ms
 *     @google/genai        164ms
 *     @anthropic-ai/sdk    132ms
 *
 * Every one was reached from `main.ts` at module scope, so every launch paid
 * for all of them — a table engine, a SPARQL engine and three vendor SDKs —
 * regardless of what the user did next. Warm, they are a few milliseconds each
 * (native code is lazily mapped, JS is in the page cache), so this is a
 * first-launch and post-reboot cost: the launch a new user judges the app on.
 *
 * ── Two shapes of laziness, checked differently ─────────────────────────────
 * **A. A dedicated loader.** `@duckdb/node-api` and `@comunica/…` are imported
 * for their value in exactly one module, which reaches them through
 * `await import(pkg)`. The check is "no other module has a value import", plus
 * "that module's own import really is dynamic" — otherwise exempting it by
 * path would be a hole.
 *
 * **B. A lazily-reached module.** Each LLM provider imports its vendor SDK
 * statically, which is fine *because nothing statically imports the provider*:
 * `llm/provider/index.ts` reaches them via `await import('./openai')` and
 * friends, so a user on Anthropic never loads the other two at all. Checking
 * "only openai.ts imports openai" would pass while `provider/index.ts` dragged
 * all three into the entry chunk, so the check here is on the edge INTO the
 * provider, not the edge out of it.
 *
 * ── What this proves, and what it does not ──────────────────────────────────
 * The property that matters is about the built bundle, and testing it honestly
 * would mean building and inspecting — minutes, and `electron-forge`. This is
 * a ratchet on the CAUSE: Vite follows static value imports into the entry
 * chunk, `import type` is erased before the bundler sees it, and `await
 * import()` becomes a separate chunk. It says so rather than implying it
 * proves more.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');

/** Shape A: one dedicated loader, reached through `await import(pkg)`. */
const DEDICATED_LOADER: ReadonlyArray<{
  pkg: string;
  loader: string;
  /** Type-only importers the scan must keep finding, or it passes vacuously. */
  expectTypeOnly: readonly string[];
}> = [
  {
    pkg: '@duckdb/node-api',
    loader: path.join('main', 'duckdb-lazy.ts'),
    expectTypeOnly: [
      path.join('main', 'sources', 'tables.ts'),
      path.join('main', 'embeddings', 'vector-store.ts'),
    ],
  },
  {
    // Construction was always lazy; the import was not. `getEngine` returns a
    // promise now, and `initGraph` prefetches it without awaiting.
    pkg: '@comunica/query-sparql-rdfjs',
    loader: path.join('main', 'graph', 'state.ts'),
    expectTypeOnly: [path.join('main', 'graph', 'state.ts')],
  },
];

/** Shape B: modules nothing may statically import, because they are heavy. */
const LAZILY_REACHED: ReadonlyArray<{ module: string; sdk: string }> = [
  { module: path.join('main', 'llm', 'provider', 'openai.ts'), sdk: 'openai' },
  { module: path.join('main', 'llm', 'provider', 'anthropic.ts'), sdk: '@anthropic-ai/sdk' },
  { module: path.join('main', 'llm', 'provider', 'google.ts'), sdk: '@google/genai' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|svelte)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

/**
 * Comments removed, so prose ABOUT an import is not mistaken for one.
 *
 * Not hypothetical: `duckdb-lazy.ts`'s header draws the dependency chain it
 * exists to break, including the line `import … from '@duckdb/node-api'`, and
 * the first version of this scan read that as a real value import and failed
 * the loader against itself. `test-isolation.test.ts` (#2248) hit the same
 * thing — a config's own explanation of why NOT to set an option matched the
 * pattern looking for the option.
 *
 * Deliberately crude: it does not understand `/*` inside a string literal.
 * For a scan whose only job is finding `import … from '<pkg>'` that is a
 * trade worth making, and a false negative here fails loudly on the next
 * assertion rather than passing silently.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Static importers of `spec`, split by whether the import erases.
 *
 * Walks BACK from each `from '<spec>'` to the `import` that owns it. A forward
 * lazy match (`import\s+([\s\S]*?)from …`) looks equivalent and is not: with
 * the `m` flag it anchors at the FIRST import in the file and spans every
 * statement in between, so the captured clause never starts with `type` and
 * every importer reads as a value import. That is how the first version of
 * this scan failed against correct code (#2338).
 *
 * `await import(…)` is deliberately not matched — it is the shape this file
 * exists to encourage.
 */
function staticImporters(spec: string): { value: string[]; typeOnly: string[] } {
  const value: string[] = [];
  const typeOnly: string[] = [];
  const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`from\\s*['"]${escaped}['"]`, 'g');
  for (const file of FILES) {
    const rel = path.relative(SRC, file);
    const source = stripComments(fs.readFileSync(file, 'utf-8'));
    for (const m of source.matchAll(re)) {
      const before = source.slice(0, m.index);
      const start = before.lastIndexOf('import');
      if (start < 0) continue;
      const clause = before.slice(start + 'import'.length);
      if (/^\s*type\b/.test(clause)) typeOnly.push(rel);
      else value.push(rel);
    }
  }
  return { value, typeOnly };
}

describe.each(DEDICATED_LOADER)('$pkg loads through one dedicated loader', ({ pkg, loader, expectTypeOnly }) => {
  it('no module outside the loader imports it for its value', () => {
    const { value } = staticImporters(pkg);
    expect(
      value,
      `a static value import of ${pkg} puts it back on the pre-window boot path. `
        + `Load it through ${loader}, or use \`import type\` if only the types are needed (#2335).`,
    ).toEqual([]);
  });

  it('the loader itself imports it dynamically', () => {
    // The loader is exempted above, so its own body has to be checked or the
    // exemption is a hole: a static import there would satisfy the assertion
    // while restoring the exact defect.
    const source = fs.readFileSync(path.join(SRC, loader), 'utf-8');
    expect(source, `${loader} should reach ${pkg} via await import()`)
      .toMatch(new RegExp(`import\\(['"]${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\)`));
  });

  it('the scan still finds the type-only importers', () => {
    // Without this, deleting the package entirely — or breaking the regex —
    // would look identical to a clean result.
    if (expectTypeOnly.length === 0) return;
    const { typeOnly } = staticImporters(pkg);
    for (const rel of expectTypeOnly) expect(typeOnly).toContain(rel);
  });
});

describe.each(LAZILY_REACHED)('$module is reached lazily', ({ module, sdk }) => {
  it('nothing statically imports it', () => {
    // The edge that matters. Each provider imports its SDK statically, which
    // is fine only while nothing drags the provider itself into the entry
    // chunk — `llm/provider/index.ts` uses `await import('./openai')`.
    const base = './' + path.basename(module, '.ts');
    const { value } = staticImporters(base);
    expect(
      value,
      `${module} statically imported — that pulls ${sdk} onto the boot path. `
        + `Reach it with \`await import('${base}')\` (#2335).`,
    ).toEqual([]);
  });

  it('the provider factory reaches it dynamically', () => {
    const factory = fs.readFileSync(
      path.join(SRC, 'main', 'llm', 'provider', 'index.ts'), 'utf-8');
    const base = path.basename(module, '.ts');
    expect(factory, `provider/index.ts should await import('./${base}')`)
      .toMatch(new RegExp(`import\\(['"]\\./${base}['"]\\)`));
  });

  it('and the SDK is imported only by its own provider', () => {
    const { value } = staticImporters(sdk);
    expect(value, `${sdk} should be imported only by ${module}`).toEqual([module]);
  });
});
