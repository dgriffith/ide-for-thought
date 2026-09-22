/**
 * What not to ship inside the packaged app (#2243).
 *
 * `forge.config.ts` copies the transitive closure of `EXTERNAL_DEP_ROOTS` into
 * the bundle whole — every file of every published tarball, because a
 * `cpSync(..., { recursive: true })` with no filter has no opinion. That put
 * 313 MB of `node_modules` inside a 696 MB `.app`, shipped as a 242 MB ZIP.
 *
 * The ZIP is the Squirrel.Mac auto-update payload and Squirrel has no delta
 * mechanism, so **every installed user downloads all of it for every point
 * release**. Files that never execute are the cheapest possible thing to stop
 * sending: 638 `.map` files, 597 `.d.ts`, domino's 7 MB test suite.
 *
 * Kept as a pure predicate, separate from the forge plumbing, because the risk
 * here is not "does it build" — it is "does it still build in six months when
 * someone adds a root whose runtime files happen to match one of these
 * patterns". `tests/scripts/package-prune.test.ts` pins every rule, including
 * the three exceptions below, which exist because each of them was a real
 * mistake waiting in the obvious version of this filter.
 */
import path from 'node:path';

/**
 * Licence and notice files, which ship regardless of extension.
 *
 * The obvious filter excludes `*.md` and silently strips
 * `get-caller-file/LICENSE.md` — the one dependency in the current closure
 * that ships its licence as markdown. Dropping upstream licence text from a
 * redistributed binary is a compliance problem rather than a size win, so
 * name-matching wins over extension-matching here.
 */
const LICENCE_RE = /^(licen[cs]e|copying|notice|patents)([.-].*)?$/i;

/** Directories that are never part of a package's runtime surface. */
const DEAD_DIRS = new Set(['test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples', 'coverage', '.github']);

/**
 * Extensions that cannot execute in a packaged Electron app.
 *
 * `.map` is read only by devtools, which are not open in a production build.
 * `.d.ts`/`.d.mts`/`.d.cts` are compile-time only — TypeScript is long gone by
 * the time this artifact runs. Neither is loadable by `require`/`import`.
 */
const DEAD_SUFFIXES = ['.map', '.d.ts', '.d.mts', '.d.cts', '.ts.map'];

/**
 * ONNX Runtime ships four mutually-exclusive WASM builds; exactly one runs
 * (#2293, Phase 2 of #2243).
 *
 * Which one is a RUNTIME capability decision, not a static reference —
 * `ort.node.min.mjs` names none of them, it probes the environment and picks.
 * So this list is the output of an instrumented run rather than a reading of
 * the source: every `fs` read path hooked, then a real
 * `InferenceSession.create`, which loaded `ort-wasm-simd-threaded.wasm` and
 * its `.mjs` glue and nothing else. `embed-worker.ts` runs in a
 * `node:worker_threads` worker, so that Node-context detection is the one the
 * shipped app gets: jsep wants WebGPU/WebNN (no adapter in a Node worker),
 * jspi wants a V8 feature, asyncify wants the async proxy path.
 *
 * 66 MB unpacked, which is 16 MB off the DMG — measured, not predicted. #2243
 * guessed this one would compress badly because it is binary and be worth most
 * of its 66 MB in the download; it deflates about 4:1, the same as the text
 * pruned there. Still the single largest prune available here, and still worth
 * having on a payload every user downloads for every release.
 *
 * **What makes this safe to keep:** `tests/e2e/embeddings.spec.ts` runs a real
 * semantic search in the PACKAGED app. If an Electron upgrade ever changes the
 * capability detection to want a build that is no longer shipped, that test
 * fails — which is the only reason this list is allowed to exist. Do not add
 * to it without extending that test.
 */
const DEAD_ORT_VARIANTS = ['jsep', 'asyncify', 'jspi'];

const DEAD_ORT_FILES = new Set(
  DEAD_ORT_VARIANTS.flatMap((v) => [
    `ort-wasm-simd-threaded.${v}.wasm`,
    `ort-wasm-simd-threaded.${v}.mjs`,
  ]),
);

/**
 * Package-scoped prune rules, applied on top of the generic ones.
 *
 * Separate from `isPrunablePath` because these are facts about one dependency,
 * not about file types. A generic "one `.wasm` per package" rule would be
 * wrong for the next dependency that legitimately ships several.
 */
export function isPrunableForPackage(packageName, relativePath) {
  if (packageName !== 'onnxruntime-web') return false;
  const segments = relativePath.split('/').filter(Boolean);
  if (segments[0] !== 'dist' || segments.length !== 2) return false;
  return DEAD_ORT_FILES.has(segments[1]);
}

/**
 * True when a path inside a copied dependency should be left out.
 *
 * `relativePath` is POSIX-style and relative to the package root
 * (`dist/ort.wasm`, `test/fixtures/a.html`), so a rule can't accidentally
 * match a user's checkout path — `/Users/someone/docs/minerva/...` matching
 * `docs` was a live hazard in the first version of this.
 */
export function isPrunablePath(relativePath, { isDirectory = false } = {}) {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  const base = segments[segments.length - 1];

  // Licences win over every other rule, including a `docs/LICENSE` path.
  if (LICENCE_RE.test(base)) return false;

  // A dead directory anywhere in the path takes its whole subtree.
  const dirSegments = isDirectory ? segments : segments.slice(0, -1);
  if (dirSegments.some((s) => DEAD_DIRS.has(s))) return true;
  if (isDirectory) return DEAD_DIRS.has(base);

  const lower = base.toLowerCase();
  if (DEAD_SUFFIXES.some((ext) => lower.endsWith(ext))) return true;

  // Markdown that isn't a licence is upstream prose: READMEs, changelogs,
  // contributing guides. Nothing reads them at runtime.
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return true;

  return false;
}

/**
 * The `filter` callback `fs.cpSync` wants: `(src, dest) => boolean`, where
 * `true` means copy. Bound to one package root so the predicate above always
 * sees a package-relative path.
 */
export function makeCopyFilter(packageRoot, { statSync, packageName } = {}) {
  const stat = statSync ?? ((p) => require('node:fs').statSync(p));
  return (src) => {
    const relative = path.relative(packageRoot, src).split(path.sep).join('/');
    if (relative === '') return true; // the package root itself
    if (packageName && isPrunableForPackage(packageName, relative)) return false;
    let isDirectory = false;
    try {
      isDirectory = stat(src).isDirectory();
    } catch {
      isDirectory = false;
    }
    return !isPrunablePath(relative, { isDirectory });
  };
}

/**
 * True for a package that exists only to carry type declarations.
 *
 * These reach the closure because some upstream packages list `@types/*` in
 * `dependencies` rather than `devDependencies`; `@types/node` alone is 2 MB of
 * `.d.ts` in a runtime artifact. Skipped at the closure level rather than
 * file-by-file so the empty directory doesn't ship either.
 */
export function isTypesOnlyPackage(name) {
  return name === '@types' || name.startsWith('@types/');
}
