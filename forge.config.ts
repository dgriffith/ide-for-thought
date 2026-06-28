import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// @electron-forge/plugin-vite bundles the main process and ships NO node_modules
// in the package. That's fine for everything Rollup can bundle — but a few deps
// it CAN'T (native `.node` binaries, dynamic `require()`s) get externalized and
// then have nowhere to resolve at runtime. The packaged app died at first use of
// each: "cannot find @duckdb/node-bindings" (DuckDB's native binary), then
// "cannot find @mixmark-io/domino" (turndown's DOM impl, required eagerly so it
// crashed at launch). Rather than chase them one by one, we ship the *transitive
// closure* of the known unbundleable roots. The packaged-app e2e (tests/e2e)
// opens a real project and so fails loudly if this list ever goes stale again. #
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
  // Headless chart export (#831). Externalized in vite.main.config (large ESM
  // trees that break the single-file main bundle), so their runtime closure
  // must be shipped for `require('vega')` / `require('vega-lite')` to resolve.
  'vega',
  'vega-lite',
  // Anki .apkg writer (#853). sql.js reads its `sql-wasm.wasm` from disk, so
  // the package (incl. the .wasm) must ship for `import('sql.js')` to resolve.
  'sql.js',
  // Local embeddings (#834). onnxruntime-web is externalized in vite.main.config
  // (it loads its ORT `.wasm` from disk), so its closure — incl. the `.wasm` —
  // must ship for the bundled `embed-worker.js` to `import('onnxruntime-web')`.
  'onnxruntime-web',
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

// macOS code signing + notarization (#661/#662). Signing runs only on macOS;
// notarization additionally requires the App Store Connect API-key env vars, so a
// plain local `pnpm build` (no creds) still signs but skips notarization instead
// of erroring. Credentials are read from the environment and never committed:
//   APPLE_API_KEY     — path to the AuthKey_XXXX.p8 file
//   APPLE_API_KEY_ID  — the key's Key ID (10 chars)
//   APPLE_API_ISSUER  — the App Store Connect Issuer ID (UUID)
// The Developer ID Application identity is auto-detected from the login keychain;
// set OSX_SIGN_IDENTITY to disambiguate if more than one is installed.
const isDarwin = process.platform === 'darwin';
const hasNotarizeCreds = Boolean(
  process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER,
);
// Only sign for real release builds. Otherwise `electron-forge package` (used by
// `pnpm build:e2e`) would try to sign on every dev/CI run and fail wherever no
// Developer ID cert is installed. Signing turns on when notarize creds are present
// (the release path), or when OSX_SIGN_IDENTITY is set to force sign-without-notarize.
const wantSign = isDarwin && (hasNotarizeCreds || Boolean(process.env.OSX_SIGN_IDENTITY));

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Minerva',
    // Hardened runtime + entitlements (auto-detected Developer ID Application cert).
    // @electron/osx-sign applies the hardened runtime and signs nested binaries
    // (the DuckDB .node, dylibs) automatically; entitlements come from the plist.
    osxSign: wantSign
      ? {
          optionsForFile: () => ({
            entitlements: path.resolve(process.cwd(), 'build', 'entitlements.mac.plist'),
          }),
          ...(process.env.OSX_SIGN_IDENTITY ? { identity: process.env.OSX_SIGN_IDENTITY } : {}),
        }
      : undefined,
    osxNotarize:
      isDarwin && hasNotarizeCreds
        ? {
            appleApiKey: process.env.APPLE_API_KEY as string,
            appleApiKeyId: process.env.APPLE_API_KEY_ID as string,
            appleApiIssuer: process.env.APPLE_API_ISSUER as string,
          }
        : undefined,
    // App icon (#805). Base path without extension — electron-packager picks
    // `.icns` on macOS and `.ico` on Windows. Linux has no embedded app icon,
    // so the window/taskbar icon is set at runtime from resources/icons.
    icon: path.resolve(process.cwd(), 'assets', 'Minerva'),
    // macOS shows this string in the system microphone-permission prompt the
    // first time dictation (#voice) calls getUserMedia. Without it, the
    // hardened-runtime app is denied the mic outright.
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Minerva uses the microphone for on-device voice dictation. Audio is transcribed locally and never leaves your computer.',
    },
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
        {
          // Off-thread embedder (#834). Emitted as `embed-worker.js` beside
          // `main.js` so it shares the externalized node_modules; spawned by
          // embedder-service.ts via `new Worker(__dirname/embed-worker.js)`.
          entry: 'src/main/embeddings/embed-worker.ts',
          config: 'vite.main.config.ts',
          target: 'main',
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
  hooks: {
    // Forge signs + notarizes + staples the .app during the package step, but the
    // DMG maker wraps that app WITHOUT stapling the .dmg itself. An un-stapled DMG
    // still works online (Gatekeeper checks notarization on mount) but fails to
    // open offline. Notarize + staple each produced DMG here so the wrapper is
    // self-contained. Runs only for release builds (notarize creds present); a
    // plain dev `pnpm build` with no creds produces an unsigned DMG and skips this.
    postMake: (_forgeConfig, makeResults) => {
      if (!(isDarwin && hasNotarizeCreds)) return makeResults;
      const dmgs = makeResults.flatMap((r) => r.artifacts).filter((a) => a.endsWith('.dmg'));
      for (const dmg of dmgs) {
        execFileSync(
          'xcrun',
          [
            'notarytool', 'submit', dmg,
            '--key', process.env.APPLE_API_KEY as string,
            '--key-id', process.env.APPLE_API_KEY_ID as string,
            '--issuer', process.env.APPLE_API_ISSUER as string,
            '--wait',
          ],
          { stdio: 'inherit' },
        );
        execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
      }
      return makeResults;
    },
  },
};

export default config;
