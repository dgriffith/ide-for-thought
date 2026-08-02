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
        // Global backstop (#1598): a coarse aggregate net over the whole
        // `include` set, so a wholesale coverage regression fails CI even in
        // trees without their own tuned floor below. Deliberately modest — the
        // per-glob floors are the real per-area gates; this only trips on a
        // broad drop. Measured aggregate at floor-time: ~65% S / 58% B / 58% F /
        // 67% L, so these sit well below and won't flap on a small change.
        statements: 45,
        branches: 40,
        functions: 40,
        lines: 45,
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
        // git publish — the isomorphic-git push engine + gh/HTTPS-token auth
        // (#254). Was 0% at the stale baseline; live is well-covered by the
        // publish-git / auth / push suites. Measured ~74% L / 74% F / 73% S /
        // 78% B; floors ~10pts below so a refactor won't flap but new untested
        // code fails. Remaining gaps in publish-git.ts are the real-remote push
        // paths, best left to integration rather than unit tests (#1614).
        'src/main/git/**': {
          lines: 64,
          functions: 62,
          statements: 62,
          branches: 66,
        },
        // IPC registrars — mostly thin channel→module glue that was entirely
        // unfenced (QA C1 / #1612). The layer is deliberately low-covered (the
        // underlying modules carry the real tests), so this is a BACKSTOP, not a
        // target: it locks in the conversation-handler coverage (#1612) and
        // stops a new registrar shipping at 0%. Measured ~27.6 L / 12.5 F /
        // 25.3 S / 7.3 B; floors sit a few points below so a small change
        // won't flap. Ratchet up as more handlers get direct tests.
        'src/main/ipc/**': {
          lines: 24,
          functions: 10,
          statements: 22,
          branches: 5,
        },
        // Neglected top-level main modules — previously unfenced (#1100 / QA
        // H1). These sit at `src/main/*.ts` (no directory of their own), so
        // each gets its own per-file floor set ~10pts below the measured-at-
        // floor-time numbers (in parens). The security trio is a genuine
        // remote-content trust boundary, so its floors run high.
        // security.ts ~100 L / 100 F / 100 S / 86 B.
        'src/main/security.ts': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 72,
        },
        // security-helpers.ts ~100 across the board.
        'src/main/security-helpers.ts': {
          lines: 92,
          functions: 90,
          statements: 92,
          branches: 88,
        },
        // privileged-sites.ts ~97 L / 100 F / 96 S / 92 B (#1100 added the test).
        'src/main/privileged-sites.ts': {
          lines: 88,
          functions: 90,
          statements: 86,
          branches: 80,
        },
        // auto-update.ts ~85 L / 89 F / 82 S / 69 B (the Squirrel apply path
        // can't run without two published releases, hence the lower floors).
        'src/main/auto-update.ts': {
          lines: 75,
          functions: 78,
          statements: 72,
          branches: 58,
        },
        // Renderer tree — 93 components + both reactive stores, the largest
        // user-facing defect surface and previously the least-gated (#1094 /
        // QA C1). Floors sit below the measured-at-floor numbers with extra
        // headroom because this tree is volatile (a single new component moves
        // the needle): a mass test deletion or a large untested addition still
        // fails CI. Ratcheted at #1451 after unit-testing bucket A (pure-lib
        // helpers: preview/markdown-config + hydrate, editor/formatting +
        // sparql-autocomplete, tools/context, find-excerpt-range) lifted the
        // measured numbers to ~42% L / ~41% F / ~43% S / ~35% B (from ~36/39/
        // 35/31). Ratchet upward again as bucket B (store/ops spine, #1452) and
        // the approval-proposal UI gain tests.
        //
        // NOTE: src/preload is deliberately NOT given a line-coverage floor.
        // It's a declarative contextBridge passthrough (~326 lines of
        // `invoke(Channels.X, …)` arrows); its correct gate is the shape +
        // full-surface snapshot contract test (tests/preload/preload-bridge.test.ts,
        // #676), not line execution. Calling every passthrough to hit a line
        // floor would verify nothing the snapshot doesn't already pin.
        'src/renderer/**': {
          lines: 42,
          functions: 40,
          statements: 42,
          branches: 34,
        },
      },
    },
  },
});
