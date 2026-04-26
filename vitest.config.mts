import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  // Svelte + testing-library plugins let vitest transform `.svelte`
  // imports — needed for renderer component tests (#396 / OcrProgressDialog
  // onwards). `svelteTesting` adds the browser resolve condition and
  // wires the auto-cleanup hook between tests.
  //
  // Custom no-op `style` preprocessor bypasses vite-plugin-svelte's
  // CSS preprocessing pass — under vitest 2 + vite 6 it explodes
  // inside vite's `PartialEnvironment` constructor ("Cannot create
  // proxy with a non-object as target or handler"). Component tests
  // don't care about CSS, so leaving styles raw is fine.
  plugins: [
    svelte({
      hot: false,
      preprocess: { style: ({ content }) => ({ code: content }) },
    }),
    svelteTesting(),
  ],
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
