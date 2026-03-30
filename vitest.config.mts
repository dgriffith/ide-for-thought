import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': '/src/shared',
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
