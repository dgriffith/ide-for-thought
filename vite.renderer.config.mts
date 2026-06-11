import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { sharedAlias } from './vite.shared';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: sharedAlias,
  },
});
