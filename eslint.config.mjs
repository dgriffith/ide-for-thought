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
      // Floating promises: the headline ask in #349. Set to `warn`, not
      // `error`, because the codebase has ~80 existing offenders (mostly
      // intentional fire-and-forget `api.*()` calls in Svelte event
      // handlers). Editor + CI will surface them, future code gets
      // caught, and the cleanup is tracked in its own follow-up.
      '@typescript-eslint/no-floating-promises': 'warn',
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
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/await-thenable': 'off',
      // 30 sites, mostly `(x as Y).foo` in tests. Cosmetic.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // 15 sites of `\.` / `\[` / `\-` inside character classes — safe
      // either way, but touching parsers and editor regexes carries
      // surface-area risk. Defer to a focused regex audit.
      'no-useless-escape': 'off',
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
