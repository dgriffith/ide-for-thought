import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Standalone Node build of the headless CLI (#1149, epic #1145 — Substrate).
 *
 * `build.ssr` targets Node (builtins external, CJS out); `ssr.noExternal: true`
 * then *bundles* the JS dep tree (rdflib, comunica, n3, …) INTO `cli.js`,
 * exactly like `main.js` does — so the emitted bundle is self-contained and
 * needs only the handful of native/wasm roots at runtime. That's what lets the
 * CLI ship inside the packaged app (#1437): the app bundles those same JS deps
 * into `main.js` and never stages them as node_modules, so a CLI that
 * externalized them would fail to resolve them in the `.app`. The `external`
 * list pins the packages that must NOT be bundled — the native/wasm roots that
 * load `.node`/`.wasm` from disk (mirrors vite.main.config, and forge.config's
 * `EXTERNAL_DEP_ROOTS` ships their closure) — plus `electron`: the read core
 * imports it transitively (notebase/fs's picker, llm/settings) but never calls
 * it, so under `ELECTRON_RUN_AS_NODE` (or plain Node) `require('electron')`
 * harmlessly yields the binary-path string.
 *
 * Build:  vite build --config vite.cli.config.ts   (→ .vite/build/cli.js)
 * Run:    node .vite/build/cli.js query "SELECT ..." --project /path/to/vault
 *         (packaged: ELECTRON_RUN_AS_NODE=1 Minerva.app/…/cli.js …)
 */
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // Bundle the JS dep tree into cli.js (leaving only `external` out), so the
  // packaged CLI needs no node_modules beyond the shipped native roots (#1437).
  ssr: { noExternal: true },
  resolve: {
    // `electron` is never called on the CLI path; alias it to an all-undefined
    // stub so the bundle carries no runtime `require('electron')` (which the
    // packaged app can't resolve — it ships no npm electron package). #1437
    alias: {
      electron: fileURLToPath(new URL('./src/cli/electron-stub.ts', import.meta.url)),
    },
  },
  build: {
    ssr: true,
    outDir: '.vite/build',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/cli/main.ts',
      // `noExternal` above only stops deps from being externalized — it doesn't
      // stop Rolldown from giving a dynamically-imported module (e.g. the AWS
      // SDK pieces pulled in for S3 publish) its own chunk under `assets/`.
      // `codeSplitting: false` is what actually forces everything into the one
      // `cli.js` file the rest of this config's docstring promises (#1437's
      // packaged install only ever staged that single file — see
      // forge.config.ts's copyCliBundle — so a split build silently produced a
      // CLI that crashed on its first dynamic import once installed).
      output: { entryFileNames: 'cli.js', format: 'cjs', codeSplitting: false },
      external: [
        'canvas',
        /^@duckdb\/node-bindings/,
        'vega',
        'vega-lite',
        'sql.js',
        /^onnxruntime-web/,
        /^onnxruntime-common/,
      ],
    },
  },
});
