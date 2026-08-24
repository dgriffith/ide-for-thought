/**
 * Temp-dir cleanup for `*.bench.ts` files (#1933).
 *
 * Benchmarks seed via a top-level `await`, ahead of any `describe`/`bench`
 * call — vitest's benchmark runner doesn't reliably await an async
 * `beforeAll` before a `bench`'s iterations *start* (perf #1109 finding, see
 * the header comment in `n3-cold-rebuild.bench.ts`). Five bench files then
 * generalized that into "no lifecycle hook is trustworthy here" and skipped
 * `afterAll` too, `mkdtempSync`-ing a root and never removing it — leaving
 * thousands of stale directories after repeated `pnpm bench` runs.
 *
 * That generalization doesn't hold. Verified empirically: `afterAll` fires
 * reliably *after* every `bench` iteration in a file has completed — the
 * #1109 finding was specifically that `beforeAll` isn't awaited before
 * iterations begin, a setup-ordering problem with no bearing on teardown
 * ordering. (`process.on('exit')` was tried first here and rejected for the
 * same reason in reverse: vitest tears benchmark workers down without a
 * process-level `'exit'`, so that hook silently never fired at all.)
 */
import { afterAll } from 'vitest';
import fs from 'node:fs';

/**
 * Register a temp dir for removal once this bench file's iterations finish.
 * Returns `dir` unchanged, so it composes with `mkdtempSync` inline.
 */
export function trackTempDir(dir: string): string {
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
