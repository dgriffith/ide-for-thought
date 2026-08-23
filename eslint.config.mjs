// ESLint flat config (#349). Adds floating-promise + dead-import + a few
// other "would have caught a bug" rules on top of the existing tsc +
// svelte-check pass. Type-checked rules require the TS project, so we
// hand the parser our tsconfig and let it pick up types per-file.
//
// Adoption rule per the issue: don't blow up the dev. We disable any
// recommended rule that produces a wall of existing warnings and file
// per-rule cleanup follow-ups instead.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

// ── Renderer data-flow rule (#1086 / #1674) ─────────────────────────────────
// Method names that mutate graph/thoughtbase/settings state or subscribe to a
// main→renderer event. A component calling one directly — as either
// `api.<domain>.<method>()` or `window.api.<domain>.<method>()` — fails lint;
// route it through a store (src/renderer/lib/stores/*.svelte.ts) or an App ops
// handler. When you add a new mutation channel, add its method name here.
//
// The #1626 guard test (tests/renderer/dataflow-rule-coverage.test.ts) parses
// this const, so keep it a plain `'a|b|c'` series of single-quoted fragments.
const DATAFLOW_MUTATION_METHODS =
  // notebase writes + file-change subscriptions
  'writeFile|writeBinary|createFile|deleteFile|createFolder|deleteFolder|copy|' +
  'replaceInNotes|renameAnchor|renameSource|renameExcerpt|setOnboardingDismissed|' +
  'onRewritten|onFileChanged|onFileCreated|onFileDeleted|onRenamed|onHeadingRenameSuggested|' +
  // sources + collections mutations + change subscriptions
  'ingestUrl|ingestIdentifier|ingestFile|ingestSmart|createExcerpt|finishPdfOcr|' +
  'setReadStatus|setReadDueBy|setTitle|addTag|removeTag|stripUpstreamTags|mineReferences|' +
  'createReferenceStubs|resolveStub|applyStubResolution|setIngestSettings|setExcerptNoteFolder|' +
  'onExcerptsChanged|onChanged|createSmart|renameSmart|removeSmart|updateSmartPredicate|' +
  'addSource|removeSource|' +
  // queries / templates / formatter
  'setGroup|setOrder|saveAs|formatFile|formatFolder|saveSettings|' +
  // settings: clipper / tools / bibliography / csl / sites / skills / compute
  'setEnabled|regenerateSecret|setSettings|setStyle|generate|importStyle|importLocale|' +
  'removeStyle|removeLocale|login|logout|setMenuConfig|setPythonSettings|restartPythonKernel|' +
  'interruptPythonKernel|saveCellOutput|grantConsent|revokeConsent|runCell|' +
  // publish / proposals / graph / refactor actions
  'runExport|toGit|upsertTarget|removeTarget|approve|reject|expire|runInspections|' +
  'setInspectionSettings|' +
  'applySuggestedLink|attachExcerptEvidence|' +
  // local per-note history (#1158): restore + labeling are mutations
  // (list/getRevision are reads)
  'restore|setLabel|labelNotes|' +
  // conversations
  'setModel|setEffort|compact|saveUIState|askUserReply|append|archive|send|' +
  'fileDraft|fileSourceDraft|filePropertyDraft|fileSourcePropertyDraft|fileClaimsDraft|' +
  'runComputeDraft|insertComputeDraft|fileRefactorDraft|fileReorgDraft|fileDeleteDraft|fileNoteBodyDraft|' +
  // generic mutation verbs (mutations only — no read shares these names)
  'merge|rename|remove|create|add|delete|save|move|import|reload|execute|cancel';

const DATAFLOW_MESSAGE =
  'Renderer data-flow rule (#1086): components must not call mutating/subscribing `api.*` methods directly. ' +
  'Route this through a store (src/renderer/lib/stores/*.svelte.ts) or an App ops handler. ' +
  'Reads and stateless OS side-effects (shell/export/view/pickers) are allowed.';

export default tseslint.config(
  {
    ignores: [
      '.vite/**',
      // Agent worktrees (`git worktree add .claude/worktrees/…`) are full
      // checkouts of this repo. Without this, `eslint .` type-checks the whole
      // source tree once per worktree and runs the process out of heap — which
      // presents as an unexplained OOM in the pre-push hook, not as anything
      // to do with worktrees.
      '.claude/**',
      'dist/**',
      'out/**',
      'coverage/**',
      'node_modules/**',
      '**/*.d.ts',
      // The fixture project is a hand-authored Minerva thoughtbase, not
      // app source — linting its bundled TS / JS dust isn't useful.
      'tests/fixtures/**',
      // The eslint config itself isn't covered by the TS project, so the
      // type-aware parser would error trying to load it. Linting our own
      // config is low value anyway. Same for svelte.config.mjs.
      'eslint.config.mjs',
      'svelte.config.mjs',
      // CLI scripts run by `pnpm new-tool` (#511). Plain Node ESM, not
      // part of the TS project; lint via `node --check` if needed.
      'scripts/**',
      // The browser-clipper extension (#792) is a separate build target with
      // its own tsconfig (DOM + chrome globals) and esbuild bundle — not part
      // of the app's Node/Electron TS project. Type-check via
      // `pnpm typecheck:clipper`; its pure logic is covered by tests/clipper.
      'clipper/**',
      // The marketing/docs site and its Playwright screenshot harness are a
      // separate concern from app source — the harness runs under Playwright's
      // own TS transpile, not the app's TS project, so the type-aware parser
      // has no tsconfig for it. Not linted here.
      'website/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // tsconfig.eslint.json widens the main tsconfig to include
        // tests + vite configs so eslint's project service can type-check
        // every file we lint.
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // ── Rules we're keeping on ────────────────────────────────────────
      // Floating promises: was warn during #349 adoption while the
      // existing ~80 offenders got cleaned up; promoted to `error` after
      // #381 audited every site (most became `void api.*()` for
      // intentional fire-and-forget UI handlers, with main-process
      // sites individually reviewed). New floating promises now fail
      // the build.
      '@typescript-eslint/no-floating-promises': 'error',
      // Unused-vars/imports as warnings, with the standard `_`-prefix
      // escape hatch so tests/handlers can name args they intentionally
      // ignore.
      // Promoted to `error` after #401 swept the existing 22 sites —
      // fresh dead imports/vars now fail the build.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-unused-vars': 'off', // superseded by the TS variant above

      // ── Rules deferred to follow-up issues ────────────────────────────
      // Each rule below produces a wall of existing warnings on the
      // current codebase. Per the issue, ship with them off and track
      // per-rule cleanup separately — better than stalling adoption on
      // a hundred-line PR that mixes lint setup with real fixes.
      // Re-enable each in its own PR after the underlying cleanups land.
      // no-unsafe-* family is on as `error` for `.ts` files. The Svelte
      // override (below) flips them off for `**/*.svelte` because
      // svelte-eslint-parser doesn't propagate `bind:this` ref types
      // through into runes-mode component instances — the ~150 false
      // positives in the Svelte tree don't reflect real type holes
      // (tsc + svelte-check pass cleanly). Tests-block override below
      // also flips them off (test fixtures legitimately reach into
      // unknown shapes).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/require-await': 'error',
      // checksVoidReturn.arguments off: the "Promise returned where void
      // was expected" check fires on every `setTimeout(async () => …)` /
      // `el.on('event', async () => …)` — common, harmless patterns the
      // framework discards on purpose. The rule's other detections
      // (Promise in conditional, in boolean spread, etc.) are the real
      // bug-finders and stay on.
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: { arguments: false },
      }],
      // Re-enabled (#382) — small-count rules cleaned up site-by-site
      // and now catch new offenders.
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      'no-useless-escape': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },
  {
    // Tests are looser by design — vitest's expect chains and mocking
    // patterns intentionally tickle some of the strictness we keep on
    // for app code.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      // Test mocks routinely satisfy Promise-returning interfaces with
      // `async () => stub` bodies that have nothing to await. That's the
      // whole point of the mock — the production interface IS async.
      '@typescript-eslint/require-await': 'off',
      // Tests legitimately reach into `unknown`-typed query results and
      // mock-returned shapes without re-typing every field; the
      // strictness pays off in production code, not tests.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // vitest spy assertions (`expect(deps.fn).toHaveBeenCalled()`)
      // necessarily reference mock functions unbound; there's no real
      // `this`-binding hazard with vi.fn() mocks, so the rule is noise here.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // Svelte block. eslint-plugin-svelte handles the .svelte parsing
    // (which also gives us script-block type info via svelte-eslint-parser).
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
    plugins: { svelte },
    rules: {
      // Svelte 5's rune dependency-tracking idiom uses bare expression
      // statements (`messages;`, `revision;`) to register reactive deps
      // inside `$effect(() => { ... })`. The TS parser flags those as
      // unused expressions; they aren't.
      '@typescript-eslint/no-unused-expressions': 'off',
      // svelte-eslint-parser doesn't propagate `bind:this` ref types
      // through into runes-mode component instances — every
      // `editorComponent?.foo()` becomes an unsafe-call on `any`. The
      // ~150 false positives in the Svelte tree don't reflect real
      // type holes (tsc + svelte-check pass cleanly), so the rules
      // are off here. They stay on for `.ts` files where they catch
      // genuine `any` leaks. Re-enable selectively if/when the
      // svelte-eslint-parser closes the gap.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // svelte-check already covers the core a11y + reactivity rules.
      // Keep eslint-plugin-svelte off here for now and re-enable
      // selectively as the project standardizes on rules we want.
    },
  },
  // ── Layer-boundary enforcement (#668) ──────────────────────────────────
  // The four-layer topology (pure `shared`, `main`, `preload`, `renderer`)
  // was previously maintained by convention alone — and one main→renderer
  // import had already slipped through. These rules freeze it. The
  // type-aware `no-restricted-imports` also catches `import type` crossings,
  // which the base rule misses. In-repo cross-layer imports are always
  // relative (`../main/…`, `../../renderer/…`); external packages are bare
  // specifiers, so the path globs don't catch them.
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/main/**', '**/renderer/**', '**/preload/**', 'node:*'],
          message: 'src/shared must stay pure — no imports from main, renderer, preload, or Node builtins (#668).',
        }],
      }],
    },
  },
  {
    files: ['src/main/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/renderer/**'],
          message: 'main must not import renderer code — move shared logic to src/shared (#668).',
        }],
      }],
    },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.svelte'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/main/**'],
          message: 'renderer must not import main-process code — go through the IPC bridge (#668).',
        }],
      }],
    },
  },
  // ── CLI boundary (#1839, epic #1145 — Substrate) ───────────────────────
  // `src/cli` is the fifth layer and the only one that runs OUTSIDE Electron:
  // `node .vite/build/cli.js …` (and the same bundle under
  // ELECTRON_RUN_AS_NODE inside the packaged app). It deliberately DOES import
  // `src/main` — the read engine reuses the app's graph / search / tables /
  // proposal modules rather than forking them — so there is no cli→main rule to
  // add here. What it must never reach for is a window: `src/renderer` is
  // Svelte + DOM (there is no DOM in this process) and `src/preload` is a
  // contextBridge shim that only means anything inside a BrowserWindow;
  // importing either would evaluate Electron-only code at module load and turn
  // a headless run into a crash. `electron` itself is out too — the CLI build
  // aliases it to the all-undefined `src/cli/electron-stub.ts` precisely so no
  // `require('electron')` survives into a bundle the packaged app can't
  // resolve, and CLI code written against that stub would be reading
  // `undefined`. Runtime counterpart: tests/cli/electron-free.test.ts.
  {
    files: ['src/cli/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/renderer/**', '**/preload/**'],
            message:
              'src/cli runs under plain Node — it must not import renderer (DOM/Svelte) or preload ' +
              '(contextBridge) code, which only exist inside an Electron window (#1839).',
          },
          {
            group: ['electron'],
            message:
              'src/cli must not import electron — the CLI build aliases it to an all-undefined stub, ' +
              'so anything read from it is undefined at runtime (#1839).',
          },
        ],
      }],
    },
  },
  // ── Module-level import rules within a layer (#1849) ───────────────────
  // The blocks above fix the DIRECTION between layers. These fix a handful of
  // edges *inside* a layer, where the layering rules have nothing to say and a
  // wrong import is invisible until someone reads the file. Each one is a
  // decision the codebase already documents in prose; freezing it here means
  // the prose can't quietly stop being true.
  //
  // This list is deliberately short. It is not an attempt to describe the
  // whole design — only the edges whose absence something else depends on.
  {
    files: ['src/main/llm/approval.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          // Matched against the specifier as WRITTEN, not the resolved path —
          // approval.ts imports it as './conversation', so a `**/llm/…` glob
          // alone would never fire. (Found by probing the rule rather than
          // trusting it.)
          group: ['./conversation', '**/llm/conversation'],
          message:
            'approval.ts owns approval-tier policy and the proposal lifecycle — it should not read ' +
            'conversation storage. Ask `llm/proposal-cause.ts` for a label instead (#1843).',
        }],
      }],
    },
  },
  {
    files: ['src/main/history/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/notebase/**'],
          message:
            'history/ sits BELOW notebase/: `notebase/fs` calls the capture hooks, and restore ' +
            'orchestration composes the two in the IPC layer. Importing back the other way is the ' +
            'cycle that arrangement exists to avoid (#1849).',
        }],
      }],
    },
  },
  {
    files: ['src/main/graph/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/llm/**'],
          message:
            'The graph is the substrate; the LLM is one of its clients. A graph module that reaches ' +
            'into llm/ has the dependency backwards — and the approval engine, which is what would ' +
            'want it, already depends on graph/ (#1849).',
        }],
      }],
    },
  },
  // ── Renderer data-flow rule (#1086 / #1674) ────────────────────────────
  // Components may call `api.*` only for reads + stateless OS side-effects.
  // A mutation `api.<domain>.<method>(…)` (or an `api.*.on*` event
  // subscription) inside a component fails lint — route it through a store
  // (src/renderer/lib/stores/*.svelte.ts) or an App ops handler instead. The
  // rule is scoped to components/; stores, `lib/app/*-ops`, and App.svelte
  // (the composition root) are exempt. The mutation method list lives in the
  // DATAFLOW_MUTATION_METHODS const above. Two selectors below cover both call
  // forms — the typed `api` client and the raw `window.api` bridge (#1674).
  {
    files: ['src/renderer/lib/components/**/*.svelte'],
    rules: {
      'no-restricted-syntax': ['error',
        // Imported client: api.<domain>.<method>()
        {
          selector:
            "CallExpression[callee.object.object.name='api']" +
            '[callee.property.name=/^(' + DATAFLOW_MUTATION_METHODS + ')$/]',
          message: DATAFLOW_MESSAGE,
        },
        // Preload bridge: window.api.<domain>.<method>() — here callee.object.object
        // is the `window.api` MemberExpression, so anchor on window↑ + the `api`
        // property rather than an `api` identifier (#1674).
        {
          selector:
            "CallExpression[callee.object.object.object.name='window']" +
            "[callee.object.object.property.name='api']" +
            '[callee.property.name=/^(' + DATAFLOW_MUTATION_METHODS + ')$/]',
          message: DATAFLOW_MESSAGE,
        },
      ],
    },
  },
);
