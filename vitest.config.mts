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
        // Ratcheted 2026-08-26 (#1932): measured 95.9% L / 86.1% B, set to 91% / 82%.
        // Added missing branch floor; lines tightened from 70 (3-5 pt margin).
        'src/shared/**': {
          lines: 91,
          functions: 70,
          statements: 70,
          branches: 82,
        },
        // Trust path — proposals, approval gate, tool dispatch, turtle. Branch
        // floor tightened 38 → 45 once the expiry/auto-reject + malformed-bundle
        // branches got tests (#1000); measured ~51% branch now.
        // Ratcheted 2026-08-26 (#1932): measured 85.1% L / 70.5% B, set to 81% / 66%
        // (3-5 points below to avoid flap on small refactors but fail on real regressions).
        'src/main/llm/**': {
          lines: 81,
          functions: 58,
          statements: 55,
          branches: 66,
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
        // Local note history (#1158) — capture, retention, labels, the limits.
        // Measured at floor-time: 92% L / 100% F / 91% S / 88% B; floors ~10
        // points below so a refactor won't flap but new untested code fails.
        'src/main/history/**': {
          lines: 82,
          functions: 88,
          statements: 80,
          branches: 75,
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
        // Embeddings — the local semantic-search subsystem, previously
        // unfenced (#1925: `haveModel`-gated real-embedder tests skipped
        // silently in CI because nothing fetched the model before `pnpm
        // test`/`coverage`; this layer's own lack of a floor was part of why
        // that regression went unnoticed — it fell under the 45% global
        // backstop instead of a gate tuned to it). Measured with the model
        // staged (`pnpm fetch:model`, now wired as pretest/precoverage): 90%
        // L / 87% F / 86% S / 73% B; floors ~10pts below. `embed-worker.ts`
        // (0%, the worker-thread entry point) drags the aggregate down —
        // deliberately not excluded, since covering it is real future work,
        // not noise to filter out.
        'src/main/embeddings/**': {
          lines: 80,
          functions: 77,
          statements: 76,
          branches: 63,
        },
        // git publish — the isomorphic-git push engine + gh/HTTPS-token auth
        // (#254). Was 0% at the stale baseline; live is well-covered by the
        // publish-git / auth / push suites. Measured ~74% L / 74% F / 73% S /
        // 78% B; floors ~10pts below so a refactor won't flap but new untested
        // code fails. Remaining gaps in publish-git.ts are the real-remote push
        // paths, best left to integration rather than unit tests (#1614).
        // Ratcheted 2026-08-26 (#1932): measured 90.8% L, set to 86% (3-5 pt margin).
        'src/main/git/**': {
          lines: 86,
          functions: 62,
          statements: 62,
          branches: 66,
        },
        // IPC registrars — channel→module glue that was entirely unfenced
        // (QA C1 / #1612), then covered registrar by registrar until #1840
        // finished the job: all 24 now have a direct handler test, and
        // `tests/architecture/ipc-registrar-coverage.test.ts` keeps it that way
        // (a new registrar without one fails). That took the layer from ~33 L /
        // 18.7 F / 30.7 S / 14.3 B to ~75.8 L / 76.5 F / 74.7 S / 61.7 B.
        //
        // The branch floor is the one that earns its keep: this layer owns the
        // `withRootPath` vs `withRootPathOr` decision, so a #1631 no-project
        // conflation now regresses into a test failure instead of passing in
        // silence. Floors sit ~10 points below measured so a refactor won't
        // flap. No longer a backstop — a real gate.
        'src/main/ipc/**': {
          lines: 65,
          functions: 66,
          statements: 64,
          branches: 51,
        },
        // Two per-file floors below, for the same reason twice: the glob above
        // is an aggregate, and an aggregate cannot fail on account of one file.
        // Both of these were comfortably carried by their neighbours while
        // sitting at 0% branches themselves.
        //
        // `PROPOSAL_APPROVE` is the single channel through which a human
        // confirms an LLM write — the Trust Principle's enforcement point. The
        // glob was met by the other 23 registrars while this file sat at 25%
        // statements / 0% branches, its only test reference being the shared
        // no-project contract (#1924). Now 100% across the board via
        // `tests/main/ipc/register-proposals.test.ts`; floors sit just under so
        // a new defensive branch won't flap, but the approve/reject arms cannot
        // quietly go untested again.
        'src/main/ipc/register-proposals.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 90,
        },
        // `helpers.ts` is the sharper case: sixteen registrar tests `vi.mock`
        // this module, so the aggregate was satisfied by the very tests that
        // mocked it out, while the module that *implements* the `withRootPath`
        // vs `withRootPathOr` policy sat at 6.55% statements / 0% branches —
        // the exact conflation the glob's own comment says the branch floor
        // exists to catch (#1926). It also owns `reindexFile`, whose
        // graph/search/vectors fan-out is the one that drifted in #1892. Now
        // 100% across the board via `tests/main/ipc/helpers.test.ts`.
        'src/main/ipc/helpers.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 90,
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
        // Ratcheted 2026-08-26 (#1932): measured 57.8% L, set to 53% (3-5 pt margin).
        'src/renderer/**': {
          lines: 53,
          functions: 40,
          statements: 42,
          branches: 34,
        },
        // Per-file floors on the 1000+-line renderer components (#1613). The
        // `src/renderer/**` aggregate above is met by the many small, well-
        // tested files, so a large component sitting near 0% — or silently
        // rotting from a real number back toward it — never trips the aggregate
        // net. These per-file gates catch that: each is a genuine defect surface
        // (the editor, the markdown preview, the source browser, the settings
        // shell, the frontmatter editor) whose own coverage can't regress
        // unnoticed. Files matching a specific path here are still counted in the
        // `src/renderer/**` aggregate — this only adds a stricter per-file check.
        // Baselines established by the render/smoke tests added in #1613 (the
        // #1597 SourceDetail test is the template); floors sit ~8-10pts below the
        // measured-at-floor-time v8 numbers (in parens) so a small refactor won't
        // flap but a real regression fails. Ratchet upward as these gain tests.
        //
        // Editor.svelte ~31.2 L / 28.6 S / 27.7 F / 20.8 B. Retuned down from
        // the original #1613 floor (38.6 L): #1625 extracted the ~225-line
        // right-click menu into EditorContextMenu.svelte, moving Editor's most
        // testable interactive surface (now floored separately below) out, so
        // its own ratio dropped — floors sit ~6pts under the new measured.
        'src/renderer/lib/components/Editor.svelte': {
          lines: 25,
          statements: 22,
          functions: 18,
          branches: 12,
        },
        // EditorContextMenu.svelte — the extracted right-click menu (#1625),
        // exercised end-to-end by the Editor render test. ~56.3 L / 45.2 S /
        // 20.0 F / 26.5 B; floors ~6-8pts below.
        'src/renderer/lib/components/EditorContextMenu.svelte': {
          lines: 48,
          statements: 38,
          functions: 12,
          branches: 18,
        },
        // Preview.svelte ~40.3 L / 38.9 S / 35.0 F / 23.4 B.
        'src/renderer/lib/components/Preview.svelte': {
          lines: 30,
          statements: 30,
          functions: 25,
          branches: 14,
        },
        // SourceDetail.svelte ~40.2 L / 33.7 S / 27.0 F / 25.8 B (#1597).
        'src/renderer/lib/components/SourceDetail.svelte': {
          lines: 30,
          statements: 24,
          functions: 18,
          branches: 16,
        },
        // SourcesPanel.svelte ~43.4 L / 41.9 S / 35.3 F / 30.0 B.
        'src/renderer/lib/components/SourcesPanel.svelte': {
          lines: 34,
          statements: 32,
          functions: 26,
          branches: 20,
        },
        // SettingsDialog.svelte ~77.1 L / 80.8 S / 58.1 F / 47.8 B (the shell;
        // extracted panels carry their own tests + the #999/#1094 aggregate).
        'src/renderer/lib/components/SettingsDialog.svelte': {
          lines: 68,
          statements: 70,
          functions: 48,
          branches: 38,
        },
        // PropertiesPanel.svelte ~89.9 L / 86.2 S / 88.8 F / 59.5 B.
        'src/renderer/lib/components/right-sidebar/PropertiesPanel.svelte': {
          lines: 80,
          statements: 76,
          functions: 78,
          branches: 50,
        },
      },
    },
  },
});
