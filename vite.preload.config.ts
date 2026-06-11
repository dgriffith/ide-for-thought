import { defineConfig } from 'vite';
import { sharedAlias } from './vite.shared';

export default defineConfig({
  resolve: {
    alias: sharedAlias,
  },
});
