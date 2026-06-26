import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  optimizeDeps: {
    // Scope the dev dependency-scan to the renderer entry. Vite otherwise
    // auto-discovers every `*.html` in the project root — including the browser
    // extension's `clipper/popup.html` / `clipper/options.html`, whose relative
    // `popup.js` / `options.js` scripts (built separately by clipper/build.mjs)
    // it can't resolve, producing a noisy "Failed to run dependency scan" on any
    // re-optimize (e.g. after a lockfile change).
    entries: ['index.html'],
  },
  resolve: {
    // vega-embed pulls in d3-shape@3, which imports the `Path` class from
    // d3-path@3. mermaid (already a dep) drags in an old d3-path@1 via
    // d3-sankey → d3-shape@1, and pnpm's hoisted linker nests that 1.x copy
    // inside d3-shape@3's node_modules — so rollup resolves d3-shape@3's
    // `import {Path} from 'd3-path'` to the 1.x copy, which has no `Path`
    // export, and the production build fails. Deduping forces a single
    // d3-path (the hoisted 3.1.0); 3.x is a superset of 1.x's API, so the
    // mermaid path keeps working too.
    dedupe: ['d3-path'],
  },
});
