/**
 * Build ONE built-in plugin's view (#2828): `CORE_PLUGIN=<id> vite build
 * --config vite.core-plugins.config.mts`, run per plugin by
 * `scripts/build-core-plugins.mjs`. Its own build, not a Forge renderer entry:
 * a renderer entry is served from the Vite dev server under `pnpm dev`, which
 * a plugin frame's `script-src 'self'` can't load. The output is served from
 * `.vite/core-plugins/<id>/` on the plugin's own origin, in dev and packaged.
 *
 * - `base: './'`: every asset is relative, so it resolves on
 *   `minerva-plugin://<id>/`, never the app's origin.
 * - The plugin API is NOT bundled: `/@minerva/plugin-api.js` is external, the
 *   copy Minerva serves, so it always matches the host (#2826).
 * - A plugin with logic (#2643) has `src/logic.ts`, built to `logic.js` beside
 *   the page — the module its worker host runs (`code.worker`). A plugin may
 *   have a page, logic, or both.
 */
import fs from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

const id = process.env.CORE_PLUGIN;
if (!id || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
  throw new Error('vite.core-plugins.config.mts: set CORE_PLUGIN to a built-in plugin id');
}
const root = path.resolve(import.meta.dirname, 'plugins', id);
const outDir = process.env.CORE_PLUGIN_OUT ?? path.resolve(import.meta.dirname, '.vite', 'core-plugins', id);
const input: Record<string, string> = {};
if (fs.existsSync(path.join(root, 'index.html'))) input.index = path.join(root, 'index.html');
if (fs.existsSync(path.join(root, 'src', 'logic.ts'))) input.logic = path.join(root, 'src', 'logic.ts');

export default defineConfig({
  root,
  base: './',
  plugins: [svelte()],
  build: {
    outDir,
    emptyOutDir: true,
    // The frame's CSP is script-src 'self': no inline module preload polyfill.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input,
      external: ['/@minerva/plugin-api.js'],
      // The logic module keeps its name: the manifest's `code.worker` says "logic.js".
      output: { entryFileNames: (chunk) => (chunk.name === 'logic' ? 'logic.js' : 'assets/[name]-[hash].js') },
    },
  },
});
