import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import path from 'node:path';
import fs from 'node:fs';

// @electron-forge/plugin-vite bundles the main process and ships NO node_modules
// in the package. That's fine for everything Rollup can bundle — but a few deps
// it CAN'T (native `.node` binaries, dynamic `require()`s) get externalized and
// then have nowhere to resolve at runtime. The packaged app died at first use of
// each: "cannot find @duckdb/node-bindings" (DuckDB's native binary), then
// "cannot find @mixmark-io/domino" (turndown's DOM impl, required eagerly so it
// crashed at launch). Rather than chase them one by one, we ship the *transitive
// closure* of the known unbundleable roots. The packaged-app e2e (tests/e2e)
// opens a real project and so fails loudly if this list ever goes stale again.
//
// `afterPrune` runs after the plugin strips node_modules, so the copies survive.
//
// Roots = the bundle's external `require()`s that aren't Node built-ins, minus
// `canvas` (not installed; linkedom intentionally falls back to a shim). The
// DuckDB platform binary is an *optional* dep of @duckdb/node-bindings (not in
// its `dependencies`), so it's named explicitly.
const EXTERNAL_DEP_ROOTS = [
  '@duckdb/node-bindings',
  `@duckdb/node-bindings-${process.platform}-${process.arch}`,
  '@mixmark-io/domino',
  'encoding', // node-fetch's optional charset path → require('encoding') → iconv-lite
];

/** BFS the `dependencies` graph from each root; skips absent optionals. */
function depClosure(roots: string[]): Set<string> {
  const root = process.cwd();
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    const pkgJson = path.join(root, 'node_modules', name, 'package.json');
    if (!fs.existsSync(pkgJson)) continue; // optional/peer not installed
    seen.add(name);
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8')) as { dependencies?: Record<string, string> };
    queue.push(...Object.keys(pkg.dependencies ?? {}));
  }
  return seen;
}

function copyExternalDeps(buildPath: string): void {
  const root = process.cwd();
  const closure = depClosure(EXTERNAL_DEP_ROOTS);
  // The required roots must resolve — a missing native binding is a broken
  // build, not an optional we can shrug off.
  for (const required of ['@duckdb/node-bindings', `@duckdb/node-bindings-${process.platform}-${process.arch}`, '@mixmark-io/domino']) {
    if (!closure.has(required)) {
      throw new Error(`[forge] required external dep not installed: ${required}`);
    }
  }
  for (const dep of closure) {
    fs.mkdirSync(path.dirname(path.join(buildPath, 'node_modules', dep)), { recursive: true });
    fs.cpSync(
      path.join(root, 'node_modules', dep),
      path.join(buildPath, 'node_modules', dep),
      { recursive: true, dereference: true },
    );
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Minerva',
    // App icon (#805). Base path without extension — electron-packager picks
    // `.icns` on macOS and `.ico` on Windows. Linux has no embedded app icon,
    // so the window/taskbar icon is set at runtime from resources/icons.
    icon: path.resolve(process.cwd(), 'assets', 'Minerva'),
    // Stage `resources/python/minerva_kernel.py` (and anything else
    // we drop under `resources/`) next to the main bundle in the
    // packaged app, so process.resourcesPath finds it (#241).
    extraResource: ['resources'],
    afterPrune: [
      (buildPath, _electronVersion, _platform, _arch, done) => {
        try {
          copyExternalDeps(buildPath);
          done();
        } catch (err) {
          done(err instanceof Error ? err : new Error(String(err)));
        }
      },
    ],
  },
  makers: [
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    new MakerDMG({ icon: path.resolve(process.cwd(), 'assets', 'Minerva.icns') }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
  ],
};

export default config;
