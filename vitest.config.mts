import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': '/src/shared',
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      // v8 is the only provider we need; istanbul is slower and adds a
      // dep we don't have. text-summary lands in stdout for the baseline
      // report; html is the human-readable view; lcov-only feeds future
      // CI integrations (Codecov, etc.) without bloating reports/ now.
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: ['src/**/*.{ts,svelte}'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        // Generated UI shells / electron-forge output / vite dust.
        '.vite/**',
        'dist/**',
        'out/**',
        // The fixture project is hand-authored markdown + ttl, no app code.
        'tests/fixtures/**',
        // Hand-bundled CSL XML/JSON aren't source we author.
        'src/main/publish/csl/bundled/**',
        // Ontology turtle blobs aren't code.
        '**/*.ttl',
      ],
      // Soft floor: src/shared/ should already comfortably exceed this
      // (pure logic, well-tested). The point isn't a CI gate elsewhere
      // until we've looked at the numbers (#353) — src/main/llm/ at
      // ~15% is the real gap and now has dedicated coverage from #342.
      thresholds: {
        'src/shared/**': {
          lines: 70,
          functions: 70,
          statements: 70,
        },
      },
    },
  },
});
