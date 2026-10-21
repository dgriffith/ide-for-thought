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
 */
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

const id = process.env.CORE_PLUGIN;
if (!id || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
  throw new Error('vite.core-plugins.config.mts: set CORE_PLUGIN to a built-in plugin id');
}
const root = path.resolve(import.meta.dirname, 'plugins', id);
const outDir = process.env.CORE_PLUGIN_OUT ?? path.resolve(import.meta.dirname, '.vite', 'core-plugins', id);

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
      external: ['/@minerva/plugin-api.js'],
    },
  },
});
