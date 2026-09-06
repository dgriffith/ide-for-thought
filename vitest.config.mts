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
    // Unified timeout for both `pnpm test` and `pnpm coverage`. Some tests
    // (e.g., watcher, chokidar waits, network probes) need >5s to avoid flakes;
    // 30s provides enough headroom without being overly lenient (#1942).
    testTimeout: 30000,
    // Pin the ambient zone for the whole suite (#1943) — without this, any
    // local-time assertion that doesn't explicitly pin its own clock/TZ
    // inherits whatever zone the runner happens to be in, so the same test
    // passes on a US laptop and fails in UTC CI (or vice versa). Phoenix
    // never observes DST, so this is a fixed, year-round offset rather than
    // a zone whose UTC delta shifts depending on which day the suite runs.
    // Individual tests that specifically need to probe a *different* zone
    // (e.g. a UTC-vs-local-date bug) still set and restore `process.env.TZ`
    // themselves — see `refactor/extract.test.ts`.
    env: {
      TZ: 'America/Phoenix',
    },
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
        // The `tools/` subtree (the LLM tool-call surface itself) sat far
        // below the `llm/**` aggregate above: 7 of its ~25 modules were
        // effectively untested (#1935), including `set_properties` — an
        // LLM-originated graph write whose write-guard fatality only holds
        // on paths a test actually exercises. (`set_properties` here is the
        // tool that emits the draft; the apply path it drafts for is
        // `src/main/llm/set-properties.ts`, covered separately by
        // `set-properties-apply.test.ts`.) Now covered by
        // `set-properties-tool.test.ts`, `propose-compute-tool.test.ts`,
        // `ask-user-tool.test.ts`, `query-graph-tool.test.ts`,
        // `search-notes-tool.test.ts`, `fetch-properties-tool.test.ts`, and
        // `describe-graph-schema-tool.test.ts`. Measured: 95.7% L / 100% F /
        // 92.5% S / 84.2% B; floors ~8-10pts below so a refactor won't flap
        // but a new untested tool fails.
        'src/main/llm/tools/**': {
          lines: 88,
          functions: 90,
          statements: 84,
          branches: 74,
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
        // A third case of the same shape: six of this file's eleven
        // approve-and-apply draft handlers had ZERO test references anywhere
        // (#1900) — exactly the "does it go through the approval engine, and
        // can the gate be skipped" path CLAUDE.md's LLM/Graph checklist asks
        // about. Aggregate coverage from `register-conversation.test.ts`
        // mocking this module out (to test its OWN two handlers) hid that the
        // module implementing those six handlers was itself barely exercised.
        // Now 100% L / 100% F / 100% S / 87.75% B via
        // `register-conversation-drafts.test.ts` (channel-level coverage for
        // all 11 handlers) and `register-conversation-drafts-write-guard.test.ts`
        // (the one handler that arms `withLLMContext`, against the real graph
        // module). Floors sit just under so a regression can't quietly widen
        // the gap again.
        'src/main/ipc/register-conversation-drafts.ts': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 78,
        },
        // A fourth case of the same shape (#1901): 10 of this file's 12
        // channels had ZERO test references anywhere, including
        // REFACTOR_AUTO_TAG_APPLY / REFACTOR_AUTO_LINK_INBOUND_APPLY — the two
        // that delegate to the LLM apply paths CLAUDE.md's Write Guard section
        // names as arming `withLLMContext`. That guard now has its own
        // dedicated test against a real graph
        // (`tests/main/llm/auto-tag-auto-link-write-guard.test.ts`); this file
        // is the shallow delegation coverage for all 12 IPC channels
        // (`register-refactor.test.ts`). 100% across the board; floors sit
        // just under.
        'src/main/ipc/register-refactor.ts': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 74,
        },
        // The other #1901 gap `ipc-registrar-coverage.test.ts` named:
        // TEMPLATES_LIST / TEMPLATES_SAVE_AS had no test anywhere (only
        // TEMPLATES_GET was covered, by the shared no-project contract test).
        // Now 100% across the board via `register-templates.test.ts`
        // (TEMPLATES_LIST / TEMPLATES_SAVE_AS) plus `no-project-contract.test.ts`
        // (TEMPLATES_GET's null/found/error branches); floors sit just under.
        'src/main/ipc/register-templates.ts': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
        // A fifth case of the same shape (QA #2055): SHELL_OPEN_EXTERNAL's
        // protocol allowlist ("don't let anyone coerce us into opening
        // file://, javascript:, etc") had ZERO test references — not the
        // allow path, not the reject path, not a malformed URL. The
        // path-traversal-guarded handlers (SHELL_REVEAL_FILE et al.) had
        // decent coverage from `register-shell.test.ts`, which hid that the
        // file sat at 42.85% statements / 27.27% branches overall — this file
        // has no directory of its own to share an aggregate with, so nothing
        // surfaced the gap. Now 100% across the board via the expanded
        // `register-shell.test.ts` (protocol allowlist, all three
        // SHELL_OPEN_IN_TERMINAL platform branches including the Linux→xterm
        // spawn-error fallback, and EXPORT_CSV's save-dialog + write path);
        // floors sit just under.
        'src/main/ipc/register-shell.ts': {
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
        // Editor.svelte ~40.4 L / 37.9 S / 33.0 F / 25.5 B. Retuned UP from the
        // #1625 floor (25 L): #1903 extracted the ~150-line imperative
        // view-command API (openFind, gotoLineColumn, insertText, etc.) into
        // `editor/view-commands.ts`, which — unlike the extraction above —
        // wasn't itself exercised by Editor.test.ts (0% there too, both
        // before and after: the coverage gap moved file, it didn't close).
        // Removing that untested block raised Editor.svelte's own ratio, so
        // per this block's own "ratchet upward as these gain tests" rule the
        // floor moves up too — floors sit ~7-8pts under the new measured.
        'src/renderer/lib/components/Editor.svelte': {
          lines: 33,
          statements: 30,
          functions: 25,
          branches: 18,
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
        // Preview.svelte ~54.8 L / 50.3 S / 41.6 F / 37.1 B. Retuned UP from
        // the #1597-era floor (30 L): #1904 extracted the ~240-line click-
        // routing table (handleClick + its per-selector handlers, plus the
        // fence-run pipeline) into `preview/click-routing.ts`, which raised
        // Preview.svelte's own ratio the same way #1903's Editor.svelte
        // extraction did — floors sit ~7-8pts under the new measured.
        // click-routing.ts itself gets no floor entry: Preview.test.ts
        // exercises it only lightly (~14% L/S/F/B, via simulated clicks),
        // matching the accepted gap on other extracted-but-thin editor/
        // preview Ops modules (context-menu.ts, build-extensions.ts).
        'src/renderer/lib/components/Preview.svelte': {
          lines: 47,
          statements: 43,
          functions: 34,
          branches: 29,
        },
        // SourceDetail.svelte ~40.2 L / 33.7 S / 27.0 F / 25.8 B (#1597).
        'src/renderer/lib/components/SourceDetail.svelte': {
          lines: 30,
          statements: 24,
          functions: 18,
          branches: 16,
        },
        // SourcesPanel.svelte ~52.4 L / 47.4 S / 40.4 F / 42.2 B. Retuned UP
        // (issue #2048): split the collections/smart-collections tree and the
        // reading-queue section out into CollectionsTree.svelte and
        // ReadingQueueSection.svelte (1298 → 789 lines). Neither extraction was
        // itself exercised by SourcesPanel.test.ts's black-box render test at
        // the time — same shape as #1903/#1904's Editor.svelte/Preview.svelte
        // extractions — removing the untested code raised the remaining file's
        // own ratio; floors sit ~8pts under the new measured.
        'src/renderer/lib/components/SourcesPanel.svelte': {
          lines: 44,
          statements: 39,
          functions: 32,
          branches: 34,
        },
        // The two extractions above got their own dedicated tests (#2057),
        // closing the gap #2057 named: a large split-out component with no
        // per-file floor is exactly the "hides inside the aggregate" shape
        // this whole block exists to catch.
        //
        // CollectionsTree.svelte ~89.5 L / 89.5 S / 92.9 F / 71.2 B (measured
        // as % Stmts/Branch/Funcs/Lines above: 89.53/71.15/92.85/90.19). Was
        // 27.19% statements / 13.46% branches before `CollectionsTree.test.ts`
        // — the create/rename/delete flows for both manual and smart
        // collections, and the smart-collection editor dialog (mounted for
        // real, not mocked), had zero coverage of their own.
        'src/renderer/lib/components/CollectionsTree.svelte': {
          lines: 80,
          statements: 78,
          functions: 82,
          branches: 60,
        },
        // ReadingQueueSection.svelte: 100% across the board via
        // `ReadingQueueSection.test.ts` (was 93.18/37.5/92.3/92.3 from
        // SourcesPanel.test.ts's incidental queue-view-click coverage alone;
        // the collapse/expand toggle had no direct test). Floors sit just
        // under so a regression can't quietly widen the gap again.
        'src/renderer/lib/components/ReadingQueueSection.svelte': {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 90,
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
