import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseVersion } from '@electron/fuses';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
// What not to ship (#2243). Pure predicates, tested by
// tests/scripts/package-prune.test.ts — a packaging filter that over-prunes
// fails only in a packaged build, which is the slowest feedback loop here.
import { makeCopyFilter, isTypesOnlyPackage } from './scripts/lib/package-prune.mjs';
import { forgeFuseSettings } from './scripts/lib/electron-fuses.mjs';
import { resolveSigningPolicy, forgeSigningConfig } from './scripts/lib/signing-policy.mjs';

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
  // must ship for the bundled `embed-worker.cjs` to `import('onnxruntime-web')`.
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
    // `@types/*` is `.d.ts` and nothing else — compile-time only, and 2.7 MB of
    // it was shipping. It reaches this walk because some upstream packages
    // declare type packages in `dependencies` rather than `devDependencies`.
    if (isTypesOnlyPackage(name)) continue;
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
    const from = path.join(root, 'node_modules', dep);
    fs.cpSync(
      from,
      path.join(buildPath, 'node_modules', dep),
      {
        recursive: true,
        dereference: true,
        // Source maps, type declarations, upstream test suites and prose (#2243).
        // The ZIP this ends up in is the Squirrel.Mac auto-update payload, and
        // Squirrel has no delta mechanism — every byte here is downloaded by
        // every user on every point release. Licences are kept deliberately;
        // see scripts/lib/package-prune.mjs.
        // `dep` enables the package-scoped rules too — the three ONNX Runtime
        // WASM builds that never run (#2293): 66 MB unpacked, 16 MB off the
        // DMG. Which build IS live is a runtime capability decision, verified
        // by an instrumented run rather than read off the source, and
        // `tests/e2e/embeddings.spec.ts` keeps it true in the packaged app.
        filter: makeCopyFilter(from, { statSync: fs.statSync, packageName: dep }),
      },
    );
  }
}

// Stage the headless CLI (#1437) into the packaged app next to `main.cjs`, so it
// resolves the same shipped `node_modules` (the native roots `copyExternalDeps`
// stages) — `cli.js` is self-contained JS otherwise (vite.cli.config.ts). At
// runtime it's launched via the app's own Electron binary under
// ELECTRON_RUN_AS_NODE (the "Install minerva Command" action writes the shim),
// so no separate `node` ships.
//
// We build cli.js HERE rather than in a `generateAssets` hook: that runs before
// the Vite plugin, which then empties `.vite/build` and deletes it. By afterPrune
// the plugin's builds are done, and `vite.cli.config`'s `emptyOutDir:false` keeps
// `main.cjs` intact. The build runs against the repo's node_modules (unaffected by
// the app prune), and afterPrune is before signing, so the addition is signed.
function copyCliBundle(buildPath: string): void {
  execFileSync('pnpm', ['cli:build'], { stdio: 'inherit' });
  const src = path.join(process.cwd(), '.vite', 'build', 'cli.js');
  if (!fs.existsSync(src)) {
    throw new Error('[forge] cli:build did not produce .vite/build/cli.js');
  }
  const destDir = path.join(buildPath, '.vite', 'build');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, 'cli.js'));
}

// macOS code signing + notarization (#661/#662) — gated behind an explicit
// release flag. The policy lives in `scripts/lib/signing-policy.mjs`; read its
// header before changing this. In short:
//
//   - Nothing signs unless MINERVA_RELEASE=1 (`pnpm build:release`, and
//     release.yml's signed build step). Apple credentials in the shell are NOT
//     enough — they used to be, which made every `pnpm build:e2e` / `package`
//     on the maintainer's machine notarize under their Developer ID.
//   - With the flag set, missing or incomplete credentials throw here, so a
//     "release" build can never come out quietly unsigned.
//   - Credentials present without the flag print one line saying signing was
//     skipped and how to turn it on.
//
// Credentials are read from the environment and never committed:
//   APPLE_API_KEY     — path to the AuthKey_XXXX.p8 file
//   APPLE_API_KEY_ID  — the key's Key ID (10 chars)
//   APPLE_API_ISSUER  — the App Store Connect Issuer ID (UUID)
// The Developer ID Application identity is auto-detected from the login keychain;
// set OSX_SIGN_IDENTITY to disambiguate (or, alone, to sign without notarizing).
const signingDecision = resolveSigningPolicy({ platform: process.platform, env: process.env });
if (signingDecision.message) console.log(signingDecision.message);
const signing = forgeSigningConfig(signingDecision, {
  entitlements: path.resolve(process.cwd(), 'build', 'entitlements.mac.plist'),
});

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Minerva',
    // Pack the app into `app.asar` (#2366). This is what lets the fuses below
    // mean anything: `OnlyLoadAppFromAsar` refuses to boot from a loose
    // `Resources/app/` directory (which is what the packager emits when this is
    // unset), and `EnableEmbeddedAsarIntegrityValidation` checks the archive
    // against the header hash packager writes into Info.plist
    // (`ElectronAsarIntegrity`) — so the code that runs is the code that was
    // signed, not whatever a local process later dropped next to it.
    //
    // Native code can't be dlopen()ed out of an archive, so the DuckDB binding
    // (`duckdb.node` + the `libduckdb.dylib` it links by rpath) is unpacked to
    // `app.asar.unpacked/`; Electron redirects the `.node` require there
    // itself. Everything else loads from inside the archive — including
    // `cli.js` under ELECTRON_RUN_AS_NODE, the `embed-worker.cjs` worker thread
    // and the ORT / sql.js `.wasm` reads — which the packaged e2e specs
    // (smoke + embeddings) and the CLI shim check in #2366 exercise.
    asar: {
      unpack: '**/*.{node,dylib}',
    },
    // Hardened runtime + entitlements + notarization — both undefined unless
    // the release flag is set (see signing-policy.mjs above).
    osxSign: signing.osxSign,
    osxNotarize: signing.osxNotarize,
    // App icon (#805). Base path without extension — electron-packager picks
    // `.icns` on macOS and `.ico` on Windows. Linux has no embedded app icon,
    // so the window/taskbar icon is set at runtime from resources/icons.
    icon: path.resolve(process.cwd(), 'assets', 'Minerva'),
    // macOS shows these strings in its permission prompts. Without the mic
    // one, the hardened-runtime app is denied the mic outright (dictation,
    // recordings). Without the audio-capture one, a meeting recording's
    // system audio (#2731) comes back as a silent stream with no error.
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Minerva uses the microphone for voice dictation and audio recordings. Audio stays on your computer and is transcribed locally.',
      NSAudioCaptureUsageDescription:
        'Minerva records the sound your Mac plays — the other side of a call — into meeting recordings in your notes. It stays on your computer.',
    },
    // Stage `resources/python/minerva_kernel.py` (and anything else
    // we drop under `resources/`) next to the main bundle in the
    // packaged app, so process.resourcesPath finds it (#241).
    extraResource: ['resources'],
    afterPrune: [
      // @electron/packager 20 (forge 8) dropped callback hooks: a hook takes
      // `{ buildPath, … }` and a throw fails the package step.
      ({ buildPath }) => {
        copyExternalDeps(buildPath);
        copyCliBundle(buildPath);
      },
    ],
  },
  // macOS arm64 only — matching the actual release matrix in release.yml
  // (deliberate single-arch today, #962). This used to declare ZIP makers
  // for linux/win32 too, which release.yml never builds and which would
  // need their own maker (win32 needs MakerSquirrel, not MakerZIP) and
  // update feed to be real; narrowed rather than left implying a
  // cross-platform release that doesn't exist (#1636).
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG({ icon: path.resolve(process.cwd(), 'assets', 'Minerva.icns') }),
  ],
  plugins: [
    // Electron fuses (#2366): bits baked into the Electron binary while
    // packaging (before signing), which no env var or CLI switch can undo at
    // runtime. The policy — every fuse, with the reason for its value — is
    // scripts/lib/electron-fuses.mjs; tests/architecture/electron-fuses.test.ts
    // pins it, and scripts/check-electron-fuses.mjs reads it back off the built
    // .app in ci.yml's e2e job and release.yml.
    //
    // Headline: RunAsNode stays ENABLED because the `minerva` CLI shim
    // (src/main/cli-install.ts) runs this binary with ELECTRON_RUN_AS_NODE=1 —
    // it is the CLI and the MCP server. The NODE_OPTIONS / --inspect doors are
    // shut, and app code loads only from the integrity-checked `app.asar`.
    //
    // `strictlyRequireAllFuses` makes the plugin refuse to package unless the
    // policy sets every fuse @electron/fuses knows — possible since fuses 2.x
    // (plugin-fuses 8) names the ninth, WasmTrapHandlers, which 1.x couldn't
    // write. The read-back stays: it checks the built binary, and fails on a
    // fuse the policy does not name even if this library doesn't know it yet.
    new FusesPlugin({
      version: FuseVersion.V1,
      strictlyRequireAllFuses: true,
      ...forgeFuseSettings(),
    }),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          // Off-thread embedder (#834). Emitted as `embed-worker.cjs` beside
          // `main.cjs` so it shares the externalized node_modules; spawned by
          // embedder-service.ts via `new Worker(__dirname/embed-worker.cjs)`.
          entry: 'src/main/embeddings/embed-worker.ts',
          config: 'vite.main.config.mts',
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
    // self-contained. Runs only when the signing policy chose sign-and-notarize —
    // i.e. MINERVA_RELEASE=1 with full creds. Creds alone never reach here.
    postMake: (_forgeConfig, makeResults) => {
      const notarize = signing.osxNotarize;
      if (!notarize) return makeResults;
      const dmgs = makeResults.flatMap((r) => r.artifacts).filter((a) => a.endsWith('.dmg'));
      for (const dmg of dmgs) {
        execFileSync(
          'xcrun',
          [
            'notarytool', 'submit', dmg,
            '--key', notarize.appleApiKey,
            '--key-id', notarize.appleApiKeyId,
            '--issuer', notarize.appleApiIssuer,
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
