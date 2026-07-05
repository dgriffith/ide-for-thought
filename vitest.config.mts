import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  // Svelte + testing-library plugins let vitest transform `.svelte`
  // imports — needed for renderer component tests (#396 / OcrProgressDialog
  // onwards). `svelteTesting` adds the browser resolve condition and
  // wires the auto-cleanup hook between tests.
  //
  // (The no-op `style` preprocessor that used to live here worked around a
  // vitest-2 + vite-6 crash in vite's `PartialEnvironment` constructor; it's
  // no longer needed under vite 7 + vitest 4 and was removed.)
  plugins: [
    svelte({
      hot: false,
    }),
    svelteTesting(),
  ],
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
      // Floors per area (#679). Set below the current numbers with headroom
      // so a small refactor won't flap CI, but a real regression on the trust
      // (llm) and security (notebase) paths fails. Measured at floor-time:
      // shared ~? , llm ~74% lines / 51% branch, notebase ~89% lines. CI runs
      // `pnpm coverage`, so these gate on every PR.
      thresholds: {
        'src/shared/**': {
          lines: 70,
          functions: 70,
          statements: 70,
        },
        // Trust path — proposals, approval gate, tool dispatch, turtle. Branch
        // floor tightened 38 → 45 once the expiry/auto-reject + malformed-bundle
        // branches got tests (#1000); measured ~51% branch now.
        'src/main/llm/**': {
          lines: 55,
          functions: 58,
          statements: 55,
          branches: 45,
        },
        // Security path — fs sandbox, write pipeline, rename/merge link rewrites.
        'src/main/notebase/**': {
          lines: 80,
          functions: 78,
          statements: 78,
          branches: 65,
        },
        // Feature trees — well-tested today but previously unfenced (#999).
        // Floors set ~10 points below the measured-at-floor-time numbers (in
        // parens) so a small refactor won't flap, but new untested code fails.
        // publish ~93% L / 92% F / 89% S / 75% B.
        'src/main/publish/**': {
          lines: 82,
          functions: 82,
          statements: 80,
          branches: 65,
        },
        // sources ~89% L / 91% F / 87% S / 75% B.
        'src/main/sources/**': {
          lines: 80,
          functions: 80,
          statements: 78,
          branches: 65,
        },
        // graph ~90% L / 90% F / 86% S / 73% B.
        'src/main/graph/**': {
          lines: 80,
          functions: 80,
          statements: 78,
          branches: 62,
        },
        // compute ~86% L / 83% F / 83% S / 70% B.
        'src/main/compute/**': {
          lines: 75,
          functions: 74,
          statements: 74,
          branches: 60,
        },
      },
    },
  },
});
