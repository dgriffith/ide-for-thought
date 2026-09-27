/**
 * Where the bundled `resources/` directory is — for the app, the worker it
 * spawns, and the headless CLI alike (#2410).
 *
 * forge's `extraResource: ['resources']` copies the repo's `resources/` dir
 * verbatim into the packaged app, so every bundled asset (the embedding model,
 * the help-docs corpus, the Python kernel, the tutorial thoughtbase, the icons)
 * lands at `<Resources>/resources/…` — note the nesting; dropping it was #808.
 * In a checkout it is `<repo>/resources/`.
 *
 * ── Why not `app.isPackaged` ────────────────────────────────────────────────
 * This used to be `app?.isPackaged ? process.resourcesPath : process.cwd()`,
 * pasted into five modules. Two ways that is wrong for the CLI:
 *
 *   - Under `ELECTRON_RUN_AS_NODE` (how the installed `minerva` shim runs,
 *     `cli-install.ts`) there is no `app` — the CLI bundle aliases `electron`
 *     to an all-`undefined` stub — so `app?.isPackaged` reads falsy and a
 *     packaged CLI took the dev branch.
 *   - The dev branch is cwd-relative, and the CLI runs from any directory.
 *
 * The CLI therefore computed its own `<cli.js>/../../resources` (#1149), which
 * is right in a checkout and wrong once packaged: `cli.js` sits at
 * `Resources/app.asar/.vite/build/cli.js`, so that resolved to
 * `Resources/resources`… inside nothing — `ENOENT … tokenizer.json` (#2410).
 *
 * ── The signal: where this code was loaded from ─────────────────────────────
 * Packaged app code is loaded from inside the app's Resources dir
 * (`Resources/app.asar/…`; the `OnlyLoadAppFromAsar` fuse makes the archive
 * mandatory). That is true in the main process, in the embed worker, and in the
 * CLI under RunAsNode — none of which need `app` to know it. So:
 *
 *   1. `moduleDir` is inside `process.resourcesPath` → packaged, root is
 *      `<resourcesPath>/resources`. In a checkout, `process.resourcesPath` is
 *      the dev Electron's own `…/Electron.app/Contents/Resources` (or undefined
 *      under plain Node) and the bundle is in `<repo>/.vite/build`, so this
 *      never matches.
 *   2. Else `moduleDir` has an `app.asar` path segment → packaged, root is
 *      `<dir holding app.asar>/resources`. A belt-and-braces fallback in case
 *      `process.resourcesPath` is ever absent in a RunAsNode child.
 *   3. Else dev → `<moduleDir>/../../resources`. Both the built bundle
 *      (`.vite/build/*.js`) and this source file (`src/main/…`, under vitest)
 *      sit two levels below the repo root, so this is cwd-independent.
 *
 * Electron-free on purpose: it runs in the CLI, where `electron` is a stub.
 * A loose file under `src/main/` so any package can import it without a
 * package cycle (`tests/architecture/no-package-cycles.test.ts`).
 */

import path from 'node:path';

/** `path.posix` / `path.win32` share this shape. */
type PlatformPath = typeof path.posix;

export interface ResourcesEnv {
  /** Electron's `process.resourcesPath` (undefined under plain Node). */
  resourcesPath: string | undefined;
  /** Directory of the running bundle (`__dirname`). */
  moduleDir: string;
  /** Path flavour — injectable so tests can exercise win32 separators. */
  pathImpl?: PlatformPath;
}

/** Is `child` equal to or inside `parent`? */
function isWithin(p: PlatformPath, parent: string, child: string): boolean {
  const rel = p.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
}

/**
 * Resolve the bundled `resources/` root for a given environment. Pure — the
 * unit-testable half of `bundledResourcesRoot()`.
 */
export function resolveResourcesRoot(env: ResourcesEnv): string {
  const p = env.pathImpl ?? path;
  const moduleDir = p.resolve(env.moduleDir);

  if (env.resourcesPath && isWithin(p, p.resolve(env.resourcesPath), moduleDir)) {
    return p.join(env.resourcesPath, 'resources');
  }

  const parts = moduleDir.split(p.sep);
  const asarIdx = parts.indexOf('app.asar');
  if (asarIdx > 0) {
    return p.join(parts.slice(0, asarIdx).join(p.sep) || p.sep, 'resources');
  }

  return p.join(moduleDir, '..', '..', 'resources');
}

/** Absolute path to the bundled `resources/` dir for the running process. */
export function bundledResourcesRoot(): string {
  return resolveResourcesRoot({
    resourcesPath: (process as { resourcesPath?: string }).resourcesPath,
    moduleDir: __dirname,
  });
}
