import { defineConfig } from 'vite';

export default defineConfig({
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
      external: [
        'canvas',
        /^@duckdb\/node-bindings/,
      ],
    },
  },
});
