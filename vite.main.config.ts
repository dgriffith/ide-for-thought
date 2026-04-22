import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': '/src/shared',
    },
  },
  build: {
    rollupOptions: {
      // linkedom has an optional `canvas` integration: it tries
      // `require('canvas')` and falls back to an internal shim when the
      // native module isn't installed. Bundling both branches eagerly
      // collapses the try/catch — rollup emits a synthetic throw for
      // the unresolvable `canvas` and the app crashes at load. Mark
      // `canvas` external so the `require` stays runtime and the
      // fallback branch actually runs.
      //
      // DuckDB ships a platform-specific `.node` binary per arch via
      // `require('@duckdb/node-bindings-<platform>-<arch>/duckdb.node')`.
      // Rollup can't resolve `.node` files — keep the whole bindings
      // family external so the require stays runtime.
      external: [
        'canvas',
        /^@duckdb\/node-bindings/,
      ],
    },
  },
});
