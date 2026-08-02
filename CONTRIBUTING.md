# Contributing to Minerva

Thanks for your interest in Minerva! Bug reports, feature ideas, and pull
requests are all welcome. This guide covers how to get set up, the conventions
the codebase follows, and what a good pull request looks like.

> Minerva is an Electron · Svelte 5 · TypeScript desktop app. The repository is
> named `ide-for-thought`; the product is **Minerva**. If you only want to
> understand the architecture, [`CLAUDE.md`](CLAUDE.md) is the fullest map of how
> the pieces fit together.

## Ways to contribute

- **Report a bug** — open an [issue](https://github.com/dgriffith/ide-for-thought/issues)
  with steps to reproduce, what you expected, and what happened. Screenshots or a
  short screen recording help a lot for UI issues. Include your OS and, if you
  built from source, the commit you're on.
- **Suggest a feature** — open an issue describing the problem you're trying to
  solve, not just the solution you have in mind. Minerva is an opinionated,
  professional tool (see [Design philosophy](#design-philosophy)); framing the
  underlying need helps us find the fix that fits. Please check
  [Scope and non-negotiables](#scope-and-non-negotiables) first — some
  directions (groupware, telemetry) are out of scope and will be declined
  regardless of implementation quality.
- **Author a skill** — the Learning / Research / Analysis menus are populated by
  markdown *skill* files, not code. You can add one without touching TypeScript;
  see [`docs/authoring-skills.md`](docs/authoring-skills.md).
- **Send a pull request** — fixes, tests, docs, and features are all fair game.
  For anything large, please open an issue first so we can agree on the approach
  before you invest the time.

## Getting set up

You need **Node 24+** (see [`.nvmrc`](.nvmrc)) and **pnpm 10**. Minerva uses
`corepack`/pnpm — do not use `npm` or `yarn`.

```bash
git clone https://github.com/dgriffith/ide-for-thought.git
cd ide-for-thought
pnpm install        # also activates the pre-push lint hook (see below)
pnpm dev            # start the app with Vite HMR
```

The first `pnpm dev`/`pnpm build` runs a `predev` step that downloads the local
embedding model and builds the in-app help corpus — the initial start is slower
than later ones.

### Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server (electron-forge + Vite HMR) |
| `pnpm lint` | `tsc --noEmit`, then `svelte-check --threshold error`, then `eslint .` |
| `pnpm test` | Run the test suite once (Vitest). `pnpm test:watch` for the watch loop |
| `pnpm test <path>` | Run a single test file |
| `pnpm coverage` | Full suite with coverage thresholds — this is what CI runs |
| `pnpm test:e2e` | Package the app and run the Playwright end-to-end journeys |
| `pnpm package` | Build an unpackaged app for local testing |
| `pnpm build` | Build a distributable |

A **pre-push hook** (`.githooks/pre-push`, activated by `pnpm install`) runs the
lint gate before each push so obvious failures are caught locally instead of in
CI. Bypass a single push with `git push --no-verify` (or `SKIP_HOOKS=1 git push`)
if you need to.

> **Gotcha:** in a `.svelte` file it's `svelte-check` — not `tsc` or `eslint` —
> that catches script↔template drift (a template referencing a renamed/removed
> binding, a wrong prop type). If a `.svelte` change looks fine but `pnpm lint`
> still fails, read the `svelte-check` section of the output.

## Architecture in one screen

Three processes with strict context isolation:

- **Main** (`src/main/`) — Node process: file I/O, the RDF knowledge graph, git
  publishing, menus, windows. All file access goes through `notebase/fs.ts`,
  which enforces path-traversal protection.
- **Preload** (`src/preload/preload.ts`) — the `contextBridge`. The renderer
  reaches everything through `window.api`.
- **Renderer** (`src/renderer/`) — the Svelte 5 UI. State lives in singleton
  stores under `src/renderer/lib/stores/*.svelte.ts`.

IPC channels are declared in `src/shared/channels.ts` and typed in
`src/shared/ipc-contract.ts`. **Adding a main-process operation** touches five
files in a fixed order — channel constant → main handler → `register-*.ts`
handler registration → `preload.ts` → the `api` interface in
`src/renderer/lib/ipc/client.ts`. The recipe is spelled out in
[`CLAUDE.md`](CLAUDE.md) under *IPC Pattern*.

## Conventions

These are the ones most likely to trip up a first PR. [`CLAUDE.md`](CLAUDE.md)
has the complete list.

- **Svelte 5 runes, not Svelte 4.** Use `$state`, `$derived`, `$effect`, and
  `$props()` with an `interface Props`. Do **not** use `export let`, `$:`,
  `on:click`, or `|self` event modifiers.
- **Renderer data flow.** Components may call `window.api` (`api.*`) directly
  **only** for reads and stateless OS side-effects. Every *state mutation* and
  every main→renderer *event subscription* goes through a store
  (`src/renderer/lib/stores/*.svelte.ts`) or an App ops handler. This is enforced
  by ESLint — a mutation `api.*` call added to a component fails `pnpm lint`.
- **Dialogs.** `prompt()` and `confirm()` are blocked by Electron. Use the custom
  `showPrompt()` / `showConfirm(message, key, label)` from `App.svelte`.
- **Styling.** Catppuccin-inspired dark theme via CSS custom properties in
  `src/renderer/styles/global.css`. Use the existing variables (`--bg`, `--text`,
  `--accent`, `--border`, `--font-mono`, …); keep component styles scoped in
  `<style>` blocks.
- **TypeScript is strict** (including `exactOptionalPropertyTypes`). Don't reach
  for `any` or `as` to get past the type checker — the type is usually telling
  you something real.

### The Trust Principle (LLM / graph changes)

The single most important rule in the codebase:

> **The LLM proposes, the human confirms.** No AI-generated change touches the
> knowledge graph directly.

Every LLM-originated write is filed as a pending `thought:Proposal` through the
approval engine (`src/main/llm/approval.ts`) and applied only when the user
approves it. If your change adds an AI write path, it **must** route through the
approval engine, and you should wrap the apply path in `withLLMContext` so the
write guard can catch a regression. Under the test runner the guard *throws*, so
an accidental bypass fails CI. See the *LLM Integration Principles* and *Code
Review Checklist for LLM/Graph PRs* sections of [`CLAUDE.md`](CLAUDE.md) before
touching this area.

## Scope and non-negotiables

Some things about Minerva are settled and not up for a PR to change. Please read
these before investing in a large contribution — a PR that crosses one of these
lines will be declined regardless of how well it's built.

- **Not groupware.** Minerva is a single-user, local-first tool for one person's
  thinking. It is **not** collaboration software, and we are **not** accepting
  contributions that add groupware functionality of any kind — real-time
  co-editing, shared servers, multi-user accounts, presence, comments,
  server-side sync-as-a-service, and the like. (Publishing to a target you own,
  and future device-to-device sync for a *single* user, are different things and
  remain in scope.)
- **Security-first.** Every potentially dangerous capability must be **warned
  about, guarded, and sandboxed** — never on by default and never silent. Code
  execution (Python / SQL cells), file-system access, network fetches, and
  publishing all run behind explicit boundaries: path-traversal protection in
  `notebase/fs.ts`, the approval engine for anything an LLM originates, a strict
  CSP in the renderer, and context isolation across the process boundary. A PR
  that adds a capability which can touch the disk, the network, or run code must
  keep it inside those boundaries — don't widen a trust boundary for
  convenience, and call out the security implications in the PR.
- **Privacy-first.** Minerva runs on the user's machine and keeps their data
  there — voice, embeddings, and search all run on-device. **Any PR that adds
  telemetry, analytics, tracking, "phone-home" behavior, or that silently
  exfiltrates _any_ user data will be summarily rejected.** Network access
  happens only for actions the user explicitly took (fetching a source they
  asked to import, publishing to a target they configured, calling an LLM they
  set up) — never in the background, never for us.

## Design philosophy

Minerva is a **professional tool**, and the UI is opinionated about it. When in
doubt:

- **No danger styling.** Deleting a note is a normal operation, not a scary one —
  don't color destructive actions red.
- **Every confirmation is dismissable.** Any confirm dialog must include a
  "Don't ask again" option (that's what the `key` argument to `showConfirm` is
  for). Don't add "are you sure?" unless there's genuine data-loss risk.
- **Stay out of the way.** Prefer keyboard shortcuts and contextual (right-click)
  actions over modal UI, warnings, toasts, and interstitials.
- **No hand-holding.** Don't add validation that stops the user from doing what
  they asked.

## Tests

- New behavior should come with a test. Bug fixes should come with a test that
  fails before the fix and passes after, **when that's practical** — some
  surfaces (notably `App.svelte`, the composition root) are covered by the
  Playwright e2e journeys rather than unit tests. If a unit test would be
  disproportionate, say so in the PR rather than skipping the question.
- Tests live under `tests/`, mirroring `src/` (`tests/main/`, `tests/renderer/`,
  `tests/preload/`, `tests/e2e/`).
- Some changes need a snapshot refresh — e.g. adding a `window.api` method
  requires `pnpm test tests/preload/preload-bridge.test.ts -u`, and the change
  won't be caught by lint alone. If a snapshot test fails, read *why* before
  regenerating it.
- CI runs `pnpm coverage` and the Playwright e2e suite on every PR; run
  `pnpm lint` and `pnpm test` locally first — the pre-push hook does the lint
  half for you.
- **The e2e suite runs on macOS only, by design.** The chokidar file-watcher
  tests exercise macOS `fsevents` semantics, and the Playwright run needs a
  darwin Electron bundle — a Linux/Windows runner would need different timing
  tolerances and per-platform package targets. So the end-to-end journeys (app
  boot, the smoke path) are *not* exercised on Windows/Linux. If Minerva ever
  ships those platforms (#962 tracks x64/universal packaging), this boundary is
  where cross-platform e2e coverage would need to be added.

## Pull requests

1. **Branch** off `main` — don't commit to `main` directly.
2. **Keep it focused.** One logical change per PR; small PRs get reviewed faster.
3. **Write a clear commit message.** We use a light
   [Conventional Commits](https://www.conventionalcommits.org/) style —
   `fix(tools): …`, `feat(publish): …`, `docs: …`, `test(search): …`,
   `refactor(...): …`. The subject says what changed; the body says why.
4. **Reference the issue** — put `Closes #123` in the PR description when it fixes
   a tracked issue.
5. **Green before review.** `pnpm lint` and `pnpm test` must pass; include any
   updated snapshots in the same PR.
6. **Describe testing.** Say what you ran and, for UI changes, what you verified
   by hand. Screenshots/recordings welcome.

A maintainer will review and, once it's ready, squash-merge it.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
