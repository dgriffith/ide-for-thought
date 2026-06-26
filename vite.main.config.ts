import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Stamp the build with the current commit + date so the About dialog (#803)
// can show what's running. Resolved at config-eval time (Node); a packaged
// build has no git, so these are baked in here. Falls back gracefully in a
// checkout without git / a shallow clone.
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
  build: {
    rollupOptions: {
      // Kept as runtime `require`s rather than bundled:
      // - `canvas`: linkedom's optional canvas integration tries
      //   `require('canvas')` and falls back to an internal shim when it's
      //   absent. Bundling both branches collapses the try/catch into a
      //   synthetic throw, crashing at load — keep the require runtime.
      // - DuckDB bindings: Rollup can't bundle the `.node` binary. The plugin
      //   ships no node_modules, so forge.config's `afterPrune` hook copies the
      //   binding's runtime closure into the packaged app.
      // - `vega` / `vega-lite` (#831, headless chart export): the plugin builds
      //   main as a single-file CJS lib, and bundling these large ESM trees
      //   (with their internal dynamic imports) makes rollup code-split the
      //   entry so `main.js` is never emitted and packaging fails. Externalize
      //   them — Electron 42 / Node 22 can `require()` ESM — and ship their
      //   closure via forge.config's `EXTERNAL_DEP_ROOTS`.
      external: [
        'canvas',
        /^@duckdb\/node-bindings/,
        'vega',
        'vega-lite',
      ],
    },
  },
});
