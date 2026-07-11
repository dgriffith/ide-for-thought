import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

/**
 * Standalone Node build of the headless CLI (#1149, epic #1145 — Substrate).
 *
 * `ssr: true` externalizes node builtins + everything in node_modules and
 * bundles only our own `src/**`, so the emitted `cli.js` is small and resolves
 * heavy/native deps (rdflib, comunica, DuckDB, onnxruntime) from node_modules at
 * runtime — the same way the app does. The explicit `external` list additionally
 * pins the native packages that must never be bundled (mirrors
 * vite.main.config) and adds `electron`: the read core imports it transitively
 * (notebase/fs's picker, llm/settings), but the CLI never calls those, so in
 * plain Node `require('electron')` harmlessly yields the binary-path string.
 *
 * Build:  vite build --config vite.cli.config.ts   (→ .vite/build/cli.js)
 * Run:    node .vite/build/cli.js query "SELECT ..." --project /path/to/vault
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
  build: {
    ssr: true,
    outDir: '.vite/build',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/cli/main.ts',
      output: { entryFileNames: 'cli.js', format: 'cjs' },
      external: [
        'electron',
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
