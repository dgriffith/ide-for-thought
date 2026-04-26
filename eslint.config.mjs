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

export default tseslint.config(
  {
    ignores: [
      '.vite/**',
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
      '@typescript-eslint/no-unused-vars': ['warn', {
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
      // Still off — sites > 0; tracked in #382, batched separately.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',             // 77 sites
      '@typescript-eslint/no-unsafe-member-access': 'off',          // 108 sites
      '@typescript-eslint/no-unsafe-call': 'off',                   // 99 sites
      '@typescript-eslint/no-unsafe-argument': 'off',               // 79 sites
      '@typescript-eslint/no-unsafe-return': 'off',                 // 23 sites
      '@typescript-eslint/require-await': 'off',                    // 37 sites
      '@typescript-eslint/no-misused-promises': 'off',              // 45 sites
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
      // svelte-check already covers the core a11y + reactivity rules.
      // Keep eslint-plugin-svelte off here for now and re-enable
      // selectively as the project standardizes on rules we want.
    },
  },
);
