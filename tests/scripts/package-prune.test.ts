/**
 * The packaged-app prune filter (#2243).
 *
 * `forge.config.ts` copied every dependency whole, so the auto-update ZIP
 * carried 638 `.map` files, 597 `.d.ts`, and domino's 7 MB test suite —
 * ~44 MB that cannot execute, downloaded by every user for every point
 * release, because Squirrel.Mac has no delta mechanism.
 *
 * A build filter is a bad thing to get wrong in the quiet direction: over-prune
 * and the app dies at runtime in a packaged build nobody runs locally, which is
 * the slowest possible feedback loop in this repo. So the rules are pinned
 * here, and in particular the three cases where the obvious filter is wrong:
 *
 *   - `LICENSE.md` must ship. Excluding `*.md` strips upstream licence text
 *     from a redistributed binary — a compliance problem, not a size win, and
 *     `get-caller-file` in the current closure does exactly this.
 *   - Paths are matched package-relative. Matching absolute paths means a
 *     checkout under `~/docs/` prunes the entire dependency.
 *   - A file called `testing.js` is not a test directory, and `latest.js` does
 *     not end with a dead suffix. Substring matching eats both.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  isPrunablePath,
  isPrunableForPackage,
  isTypesOnlyPackage,
  makeCopyFilter,
} from '../../scripts/lib/package-prune.mjs';

describe('files that cannot execute are pruned', () => {
  it.each([
    'dist/ort.min.js.map',
    'lib/index.d.ts',
    'lib/index.d.mts',
    'lib/index.d.cts',
    'README.md',
    'CHANGELOG.md',
    'CONTRIBUTING.markdown',
  ])('prunes %s', (relativePath) => {
    expect(isPrunablePath(relativePath)).toBe(true);
  });

  it.each([
    'dist/ort.min.js',
    'lib/index.js',
    'lib/index.mjs',
    'package.json',
    'dist/ort-wasm-simd-threaded.wasm',
    'build/Release/duckdb.node',
    'lib/libduckdb.dylib',
  ])('keeps %s', (relativePath) => {
    expect(isPrunablePath(relativePath)).toBe(false);
  });

  it('keeps a .ts file that is not a declaration', () => {
    // Some packages ship sources beside their build. `.ts` is not `.d.ts`, and
    // a rule that conflates them would prune real files from a package that
    // points `main` at one.
    expect(isPrunablePath('src/index.ts')).toBe(false);
  });
});

describe('dead directories take their subtree', () => {
  it.each([
    'test/fixtures/page.html',
    'tests/unit/a.js',
    '__tests__/b.js',
    'docs/api.html',
    'doc/guide.html',
    'example/demo.js',
    'examples/demo.js',
    'coverage/lcov.info',
    '.github/workflows/ci.yml',
  ])('prunes %s', (relativePath) => {
    expect(isPrunablePath(relativePath)).toBe(true);
  });

  it('prunes the directory itself, so the whole subtree is skipped', () => {
    expect(isPrunablePath('test', { isDirectory: true })).toBe(true);
    expect(isPrunablePath('lib/docs', { isDirectory: true })).toBe(true);
  });

  it('keeps a directory whose name merely contains a dead name', () => {
    // `contest/`, `testing/`, `documents/` are not test or doc directories.
    // Segment equality, not substring.
    expect(isPrunablePath('contest/a.js')).toBe(false);
    expect(isPrunablePath('testing/a.js')).toBe(false);
    expect(isPrunablePath('documents/a.js')).toBe(false);
    expect(isPrunablePath('testing', { isDirectory: true })).toBe(false);
  });

  it('keeps a FILE named like a dead directory', () => {
    expect(isPrunablePath('lib/test.js')).toBe(false);
    expect(isPrunablePath('lib/docs.js')).toBe(false);
  });

  it('keeps a file whose name merely ends with a dead-suffix substring', () => {
    // `latest.js` ends with "test.js"; `roadmap.js` ends with "map.js".
    expect(isPrunablePath('lib/latest.js')).toBe(false);
    expect(isPrunablePath('lib/roadmap.js')).toBe(false);
  });
});

describe('licences ship regardless of extension', () => {
  it.each([
    'LICENSE',
    'LICENSE.md',
    'LICENCE',
    'LICENSE.txt',
    'LICENSE-MIT',
    'COPYING',
    'NOTICE',
    'PATENTS',
    'license.md',
  ])('keeps %s', (relativePath) => {
    expect(isPrunablePath(relativePath)).toBe(false);
  });

  it('keeps a licence even inside an otherwise-pruned directory', () => {
    // The rule order that makes this work is the point: a licence check that
    // ran after the directory check would drop `docs/LICENSE`.
    expect(isPrunablePath('docs/LICENSE')).toBe(false);
    expect(isPrunablePath('test/LICENSE.md')).toBe(false);
  });

  it('does not mistake a prose file for a licence', () => {
    expect(isPrunablePath('licensing-guide.md')).toBe(true);
  });
});

describe('@types packages are skipped whole', () => {
  it.each(['@types/node', '@types/estree', '@types/geojson'])('skips %s', (name) => {
    expect(isTypesOnlyPackage(name)).toBe(true);
  });

  it.each(['typescript', 'vega-lite', 'my-types', '@scope/types-helper'])(
    'keeps %s',
    (name) => {
      expect(isTypesOnlyPackage(name)).toBe(false);
    },
  );
});

describe('makeCopyFilter — paths are package-relative', () => {
  const ROOT = path.join('/tmp', 'docs', 'checkout', 'node_modules', 'some-pkg');
  const dirs = new Set([ROOT, path.join(ROOT, 'test'), path.join(ROOT, 'lib')]);
  const statSync = (p: string) => ({ isDirectory: () => dirs.has(p) });

  const filter = makeCopyFilter(ROOT, { statSync });

  it('does not prune a package because the CHECKOUT path contains "docs"', () => {
    // The live hazard in the obvious implementation: this root is under
    // `/tmp/docs/…`, so an absolute-path match would refuse to copy anything.
    expect(filter(path.join(ROOT, 'lib', 'index.js'))).toBe(true);
    expect(filter(path.join(ROOT, 'package.json'))).toBe(true);
  });

  it('copies the package root itself', () => {
    expect(filter(ROOT)).toBe(true);
  });

  it('still prunes a real dead directory under that root', () => {
    expect(filter(path.join(ROOT, 'test'))).toBe(false);
    expect(filter(path.join(ROOT, 'lib', 'index.d.ts'))).toBe(false);
  });
});

/**
 * The ONNX Runtime WASM prune (#2293).
 *
 * Four mutually-exclusive builds ship; one runs. Which one is a RUNTIME
 * capability decision — nothing names it statically — so the list came from an
 * instrumented run rather than reading the source, and
 * `tests/e2e/embeddings.spec.ts` is what keeps it true in the packaged app.
 * These cases pin the scoping, which is where a rule like this goes wrong: too
 * broad and it eats the live build, or another package's WASM.
 */
describe('onnxruntime-web: three dead WASM builds (#2293)', () => {
  it.each([
    'dist/ort-wasm-simd-threaded.jsep.wasm',
    'dist/ort-wasm-simd-threaded.asyncify.wasm',
    'dist/ort-wasm-simd-threaded.jspi.wasm',
    'dist/ort-wasm-simd-threaded.jsep.mjs',
    'dist/ort-wasm-simd-threaded.asyncify.mjs',
    'dist/ort-wasm-simd-threaded.jspi.mjs',
  ])('prunes %s', (relativePath) => {
    expect(isPrunableForPackage('onnxruntime-web', relativePath)).toBe(true);
  });

  it('KEEPS the build that actually runs', () => {
    // The whole risk of this rule in one case. `ort-wasm-simd-threaded.wasm`
    // is what the instrumented run loaded; pruning it kills semantic search in
    // the packaged app and nowhere else.
    expect(isPrunableForPackage('onnxruntime-web', 'dist/ort-wasm-simd-threaded.wasm')).toBe(false);
    expect(isPrunableForPackage('onnxruntime-web', 'dist/ort-wasm-simd-threaded.mjs')).toBe(false);
  });

  it('keeps the JS runtime entry points', () => {
    for (const f of ['ort.node.min.mjs', 'ort.mjs', 'ort.js', 'ort.all.mjs']) {
      expect(isPrunableForPackage('onnxruntime-web', `dist/${f}`)).toBe(false);
    }
  });

  it('is scoped to this package — another dependency keeps its WASM', () => {
    // `sql.js` ships `sql-wasm.wasm` and reads it from disk. A rule that
    // matched on filename shape rather than package name would break the Anki
    // exporter (#853).
    expect(isPrunableForPackage('sql.js', 'dist/ort-wasm-simd-threaded.jsep.wasm')).toBe(false);
    expect(isPrunableForPackage('sql.js', 'dist/sql-wasm.wasm')).toBe(false);
  });

  it('is scoped to dist/ at the top level, not any nested path', () => {
    // A vendored copy under another directory is not the one being resolved.
    expect(isPrunableForPackage('onnxruntime-web', 'vendor/dist/ort-wasm-simd-threaded.jsep.wasm')).toBe(false);
    expect(isPrunableForPackage('onnxruntime-web', 'dist/sub/ort-wasm-simd-threaded.jsep.wasm')).toBe(false);
  });

  it('applies through makeCopyFilter only when the package name is given', () => {
    const root = path.join('/tmp', 'node_modules', 'onnxruntime-web');
    const statSync = () => ({ isDirectory: () => false });
    const dead = path.join(root, 'dist', 'ort-wasm-simd-threaded.jsep.wasm');
    const live = path.join(root, 'dist', 'ort-wasm-simd-threaded.wasm');

    const scoped = makeCopyFilter(root, { statSync, packageName: 'onnxruntime-web' });
    expect(scoped(dead)).toBe(false);
    expect(scoped(live)).toBe(true);

    // Without the name the generic rules still apply, but the package-scoped
    // ones don't — so a caller that forgets it copies everything rather than
    // silently pruning something it shouldn't.
    const unscoped = makeCopyFilter(root, { statSync });
    expect(unscoped(dead)).toBe(true);
  });
});
