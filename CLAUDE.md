# Minerva — Development Guide

## What This Is

Minerva is a desktop markdown IDE built with Electron + Svelte 5 + TypeScript. It manages knowledge bases backed by an RDF graph. (Git is only an opt-in *publish* target — see `src/main/git/` — not automatic version control; thoughtbases are not git-backed yet.) The codebase repo name is `miranda` but the app is called **Minerva**.

## Commands

- `pnpm dev` — Start the dev server (electron-forge + Vite HMR)
- `pnpm lint` — Full static-check gate: `tsc --noEmit` (`.ts` type errors), then `svelte-check --threshold error` (`.svelte` script/template drift, undefined references, wrong prop types), then `eslint .` (lint rules, incl. the renderer data-flow rule). Note `svelte-check` — not `tsc` or `eslint` — is what catches script↔template drift in `.svelte` files. Warnings (a11y, state-referenced-locally) are not fatal.
- `pnpm test` — Run tests once (vitest run). Use `pnpm test:watch` for the file-watcher loop.
- `pnpm build` — Build distributable (electron-forge make)

A **pre-push hook** (`.githooks/pre-push`, activated by the `prepare` script's
`core.hooksPath` on `pnpm install`) runs `pnpm lint` before each push so an
obvious failure is caught locally instead of in CI (#690). Bypass a single push
with `git push --no-verify` (or `SKIP_HOOKS=1 git push`).

## Architecture

Three-process Electron app with strict context isolation:

- **Main** (`src/main/`) — Node.js process. File I/O, git publishing, graph indexing, menus, window management. All file access goes through `notebase/fs.ts` which enforces path traversal protection.
- **Preload** (`src/preload/preload.ts`) — Bridges main and renderer via `contextBridge`. The renderer accesses everything through `window.api`.
- **Renderer** (`src/renderer/`) — Svelte 5 UI. State managed with runes (`$state`, `$effect`, `$derived`) in singleton stores under `src/renderer/lib/stores/*.svelte.ts` (`notebase` = project/files, `editor` = active file/content, plus source/conversation/settings/etc. stores). Stores own `api.*` mutations + event subscriptions; components call store methods (see **Renderer data flow** under Conventions).

IPC channels are defined in `src/shared/channels.ts`. Types in `src/shared/types.ts`.

## Conventions

### Svelte 5
This project uses **Svelte 5 runes** — not Svelte 4 syntax. Use `$state`, `$derived`, `$effect`, and `$props()` with `interface Props`. Do not use `export let`, `$:`, `on:click`, or `|self` event modifiers.

### Renderer data flow (#1086)

One rule for where `window.api` (`api.*`) may be called, so state changes have a
single, testable path instead of three competing ones:

> **Components may call `api.*` directly ONLY for reads and stateless OS
> side-effects. Every state mutation and every main→renderer event subscription
> goes through a store (`src/renderer/lib/stores/*.svelte.ts`) or an App ops
> handler (`src/renderer/lib/app/*-ops*`).**

- **Reads — allowed in components:** queries that return data and change nothing
  (`api.notebase.readFile`, `api.tags.list`, `api.graph.query`,
  `api.publish.listExporters`, `api.sources.listAll`, …).
- **Stateless OS side-effects — allowed in components:** actions with no
  observable in-app state change — `api.shell.*` (open/reveal/terminal),
  `api.export.csv`, `api.view.*`, and native OS pickers/reveal
  (`api.skills.revealFolder`). These are explicitly exempt.
- **Mutations — must route through a store/ops:** anything that writes
  thoughtbase / graph / source / settings state (`api.notebase.writeFile`,
  `api.sources.setReadStatus`, `api.collections.create`,
  `api.compute.saveCellOutput`, `api.tools.setSettings`, …). The store method
  owns the `api` call and updates observable state; the component calls the
  store method.
- **Event subscriptions — must live in a store:** `api.*.on*` listeners
  (`onExcerptsChanged`, `collections.onChanged`, `notebase.onRewritten`, …)
  belong in the store that owns the affected state, not in a component
  `$effect`. Components read the resulting reactive state.
- **`App.svelte` is the composition root**, not a leaf component: it wires ops
  clusters and may call `api.*` for top-level orchestration. Leaf settings
  dialogs front their config writes through a `settings-*` store.

The `no-restricted-syntax` block in `eslint.config.mjs` enforces this — a
mutation `api.*` call added outside an owner module fails `pnpm lint`. When you
add a new mutation channel, add its method name there too.

**Scope is responsibility, not file location (#2232).** The rule covers
**`src/renderer/**/*.{ts,svelte}`**, minus the paths allowed to *own* a
mutation: `lib/stores/**`, `lib/app/**`, `lib/ipc/client.ts`, and `App.svelte`.
It used to be scoped to `lib/components/**/*.svelte`, which enforced a property
of file path while this section states a property of responsibility — so every
`.ts` module outside `stores/`/`lib/app/` was invisible, as were the `.ts` files
sitting directly under `components/`. Nine real mutations lived in that gap.
The instructive one: `lib/sources/source-actions.ts` held three source
mutations extracted out of two components — *exactly* the refactor this rule
exists to survive — and extracting them silently switched the enforcement off.

The practical consequence: **a new module that owns a mutation goes in
`stores/` or `lib/app/`.** Anywhere else, lint will (correctly) reject the
`api.*` call. #2232 moved two modules for this reason —
`compute/run-cell-with-trust.ts` → `app/compute-ops.ts` (App wires it as the
editor's cell runner) and `formatter/settings.ts` →
`stores/settings-formatter.svelte.ts` (a settings cache + persistence, i.e. a
store). Adding each to an exception list instead would have rebuilt the same
decay one entry at a time.

Two tests hold the other halves. `tests/renderer/dataflow-rule-coverage.test.ts`
makes the denylist fail CLOSED (an unclassified new method fails); its
`OWNER_PATHS` mirrors the eslint `ignores`, so keep the two in step.
`tests/architecture/store-ownership.test.ts` (#1852) enforces the
POSITIVE half: every `api.<domain>` with a mutating method must have an owner
under `stores/` or `lib/app/`, and a mutation may not land only in `App.svelte`.
That's the gap #1834 fell through — history shipped four mutating channels with
no store, and the panel polled a timer instead of listening for a change event.
Note what it can't tell you: it doesn't distinguish a real store from a
passthrough, and it says nothing about whether a mutating channel ships a change
event (a main-side question).

#### Reducing prop drilling: read stores directly (#1922, #2049)

The data-flow rule above says nothing about *how many* props a component
takes to stay compliant — and a component whose host wires up a dozen
individual callback props is compliant but hard to read. `Sidebar.svelte`
(#1922) cut ~40 props to 3 this way, and it's the worked example:

- **Reads are already allowed in components** — so a component with many
  callback props can read the stores it needs directly instead
  (`Sidebar.svelte:96-100` does this for `notebase`, `editorStore`,
  `clipboard`, `dialogs`, `bookmarksStore`) rather than receiving every value
  or dialog-opener as a prop from its host.
- **Group what's left into a typed ops bag.** Callbacks that are genuine
  App-level orchestration (opening a tab, navigating, filing a proposal) can't
  be read from a store — the host still has to supply them. Rather than one
  prop per callback, group them into an interface passed as a single prop
  (`Sidebar.svelte:53-86`'s `SidebarFileOps`/`SidebarPanelOps`, `SourceDetail.svelte`'s
  `SourceDetailOps`). The host still assembles the same functions; they just
  arrive as one object literal instead of N named props (see
  `App.svelte`'s `fileOps={{ ... }}` / `panelOps={{ ... }}` /
  `ops={{ ... }}` call sites).
- **When to reach for this:** a rough guide, not a hard rule — once a
  component's callback-prop count climbs past ~15, it's worth asking whether
  each one is a store mutation in disguise (read the store instead) or real
  orchestration (goes in the ops bag) before adding a 16th.

This is a complement to the mutation-routing rule above, not an exception to
it: a component reading `dialogs.showConfirm()` directly is still "a store
owns the mutation," it's just that the *component* is the one holding the
store reference instead of threading it through a prop.

#### Testing a store: mock the module, don't add a reset API (#1944)

Store singletons under `stores/*.svelte.ts` deliberately do **not** get a
generic `reset()`/`clear()` export. Decision, not an oversight:

- **Default: `vi.mock` the whole store module.** Most components/ops tests
  don't need the store's real logic — they need it to hand back
  controllable state. Mocking the module (see
  `right-sidebar/BookmarksPanel.test.ts`) is fully isolated between tests
  with zero store-specific cleanup code, and is the pattern to reach for
  first.
- **Testing the store's own logic is the exception.** A test that imports
  the real module (`stores/bookmarks.test.ts` exercises
  `retargetSectionAnchor`) owns its own scoped reset for exactly the state
  it touches, rather than the store exporting a generic one nothing else
  needs. A blanket `reset()` API would mostly serve this one call site while
  adding a public surface every other consumer has to know is test-only.
- **Cancel any real timers a mutation arms.** A debounced-persist store
  (`bookmarks.svelte.ts`'s 500ms `schedulePersist`, mirroring
  `search/index.ts`'s pattern) can leave a live `setTimeout` armed past the
  end of whatever test triggered it, firing mid-run of a later one. Export a
  narrow `_clearPendingPersistForTests()`-style escape hatch (test-only,
  underscore-prefixed, same convention as `_setPersistDebounceMsForTests` in
  `search/index.ts`) and call it in `afterEach` — not a general reset.

#### `waitFor(...)` must be awaited — enforced by lint, not `expect.assertions` (#1947)

~200 sites across the component test suite assert inside a
`@testing-library/svelte` `waitFor(() => expect(...))` callback. `waitFor`
polls that callback on an interval; if the call itself isn't `await`ed (or
explicitly `void`ed for deliberate fire-and-forget), the test function can
return — and be marked passed — before the assertion ever gets to observe
the state it's waiting for. The audit behind this note found zero existing
offenders, but nothing was stopping a future one.

`expect.assertions(n)` — the usual defense for "did this callback actually
run" — was tried and rejected here, for a reason worth recording so it
isn't tried again: **`waitFor` invokes its callback once per retry tick**,
so the assertion inside fires a timing-dependent number of times, not once.
Measured directly: a condition that resolved after 30ms on a 5ms poll
interval ticked `expect()` 7 times. An exact `expect.assertions(n)` would be
flaky by construction — pass or fail depending on how many retries a given
run happened to need. `expect.hasAssertions()` fares no better in the other
direction: `waitFor` checks its callback once synchronously on the very
first call, before any interval fires, so even a `waitFor(...)` call with
the `await` accidentally dropped still ticks the counter at least once —
the exact bug this is meant to catch slips through it silently.

The actual fix is `no-restricted-syntax` in `eslint.config.mjs`, scoped to
`tests/**/*.ts`: it flags any `waitFor(...)` sitting as a bare
`ExpressionStatement` (i.e. not `await`ed, not `void`ed, not assigned or
returned). That's a static, deterministic check — no timing dependency, and
it catches the bug before any test runs at all, which a runtime assertion
count never could.

**Where `expect.assertions`/`expect.hasAssertions` DO earn their keep:** a
genuinely fire-and-forget async branch with no retry loop — e.g. an
assertion inside a raw `.then()` callback, or an event handler invoked by a
mocked callback the test never otherwise awaits. There, the callback runs
(at most) once, so an exact count is meaningful and won't flap. Reach for
one of those there; reach for the lint rule (already on, nothing to add)
for `waitFor`.

### UI & UX Philosophy
This is a **professional tool**. Design accordingly:

- **No danger styling.** Don't color destructive actions in red. Deleting a note is a normal operation, not a scary one.
- **Respect the user.** Every confirmation dialog must include a "Don't ask again" checkbox. Use `showConfirm(message, key, label)` in App.svelte — the `key` parameter allows each dialog type to be independently suppressed via localStorage.
- **Stay out of the way.** Prefer keyboard shortcuts and contextual actions (right-click menus) over modal UI. Don't add warnings, toasts, or interstitials unless absolutely necessary.
- **No hand-holding.** Don't add validation that prevents the user from doing what they asked. Don't add "are you sure?" unless there's genuine data loss risk — and even then, make it dismissable.

### Styling
- Catppuccin-inspired dark theme via CSS custom properties in `src/renderer/styles/global.css`
- Keep component styles scoped in `<style>` blocks
- Use the existing CSS variables (`--bg`, `--text`, `--accent`, `--border`, etc.)

### Dialogs
- `prompt()` and `confirm()` are blocked by Electron. Use the custom `showPrompt()` and `showConfirm()` functions in App.svelte.
- `showConfirm(message, key, confirmLabel)` returns `Promise<boolean>`. The `key` is used for "don't ask again" persistence in localStorage.
- Dialog components: `PromptDialog.svelte`, `ConfirmDialog.svelte`

### IPC Pattern
To add a new main-process operation:
1. Add channel constant to `src/shared/channels.ts`
2. Implement the operation in `src/main/notebase/fs.ts` (or appropriate module)
3. Register the handler in the appropriate `src/main/ipc/register-*.ts` module (`src/main/ipc.ts` is just the orchestrator that calls each `register*()`)
4. Expose it in `src/preload/preload.ts`
5. Add the type to the API interface in `src/renderer/lib/ipc/client.ts`

#### The native menu is a command surface, not an implementation (#2233)

`menu.ts` is not exempt from the five steps above. It used to be: five
long-running operations — rebuild indexes, rebuild the semantic index, interrupt
a cell, restart the kernel, export the knowledge graph — were `await`ed inline
from click handlers, so the native menu was a second command surface with no
channel, no contract entry, no preload method, no client signature, no registrar
test, and a `projectContext(rootPath)` built by hand from a raw string. Every
existing check is about imports or about IPC, and inline menu execution is
neither, so nothing saw it. The visible cost: `Export Knowledge Graph` meant two
different output files depending on whether you reached it from the menu or the
(unused) `GRAPH_EXPORT` channel — the menu's included the ontology triples, the
channel's didn't.

So a menu item does exactly one of:

- **`send()` a channel** to the renderer (most of them);
- **call a window/app-lifecycle function** — `createWindow`, `printToPDF`,
  `checkForUpdatesNow`, `shell.openExternal`, `installMinervaCommand`. These are
  genuinely window-scoped or stateless OS side-effects with no sensible IPC
  form, and they correctly stay;
- **call a command from `src/main/maintenance-commands.ts`**, which a registrar
  also exposes as a typed channel. One implementation, two surfaces.

A `no-restricted-imports` block in `eslint.config.mjs` scoped to
`src/main/menu.ts` + `src/main/menu/**` enforces this: importing `graph/`,
`search/`, `sources/`, `embeddings/`, `compute/`, `notebase/`, `llm/`, `git/`,
`maintenance`, or `project-context-types` there fails lint and points at the
command-plus-registrar route. That's what makes this durable rather than a
one-time tidy — the next menu item that wants to do work gets pushed through
the contract instead of around it.

### IPC error handling (#1631)

One convention so every caller reasons about failure the same way. Electron's
`ipcRenderer.invoke` **rejects the renderer promise when a handler throws**, and
the typed `invoke` wrapper (`src/preload/typed-invoke.ts`) surfaces it — so a
thrown error already propagates cleanly. Build on that:

1. **Default: throw.** A handler that cannot complete throws; the caller uses
   `try/catch` / `.catch`. Do **not** invent an `{ ok: false }` object or a
   `null` for a *generic* failure — throwing is the failure channel.
2. **"No project open" throws.** Use `withRootPath` / `withRootPathWin`
   (`ipc/helpers.ts`). `withRootPathOr(fallback, …)` is only for handlers whose
   project-less answer is a *legitimate value* (an empty list `[]` a UI renders
   as "nothing yet"), **not** a way to signal failure — and that fallback must
   mean the same thing as a genuinely-empty result, never "error".
3. **Discriminated `{ ok, … }` union — only when the caller must branch on an
   EXPECTED, non-exceptional outcome.** A user's malformed SQL/SPARQL, a failed
   network/auth check, or user code that errors are normal inputs the UI renders
   inline, not bugs. These legitimately return a union: tables/graph query
   results, `ConnectionCheckResult` (S3 / GitHub / model key), `PUBLISH_TO_GIT`,
   compute `CellResult` / `PythonProbeResult` / `InterruptResult`. Give the
   *failure* arm a real discriminant (`{ ok: false; error }`), and document on
   the type that the call itself does not reject.
4. **Per-item outcome catalogs are fine.** A call that succeeds while reporting
   per-item problems (`SKILLS_LIST` / `TYPES_LIST` `errors[]`, the draft-filing
   `outcomes[].error`) is not a failure channel — the call worked; the array
   describes each item. Keep these.
5. **`null` marks exactly ONE expected absence, documented on the client type.**
   Either "user cancelled a native picker" **or** "not found" — never both, and
   never "error". A corrupt store, an IO failure, or "no project" must not fold
   into the same `null`.

**Anti-patterns (do not add; migrate when you touch one):**

- **Overloaded `null`/sentinel** — one `null` meaning several of {cancelled,
  not-found, no-project, corrupt, error}. Split them: real errors throw, and the
  sentinel keeps one meaning. Use `readJsonFileOr(absPath, fallback)`
  (`ipc/helpers.ts`) for JSON stores — it returns `fallback` on ENOENT but
  **rethrows a parse/IO error** instead of masquerading corruption as "empty".
- **Swallowing** — `catch { return null | [] | fallback }` that discards a real
  error. Only catch a *specific expected* condition (e.g. ENOENT → sentinel) and
  let the rest throw.
- **In-band `error?` on an otherwise-normal payload** — prefer the discriminated
  union of rule 3 over baking an optional `error` onto the success shape.

**Migration backlog** (audited outliers, fix incrementally per the rules above).
The counts are also ratcheted by `tests/architecture/pattern-ratchets.test.ts`
(#1848) — a new instance of a listed anti-pattern fails a test, so this list
can't quietly grow while nobody re-reads it:

- `null` no-project↔not-found: *(cleared — `GRAPH_SOURCE_DETAIL`,
  `GRAPH_EXCERPT_SOURCE`, `PROPOSAL_DETAIL`, `TEMPLATES_GET` and
  `CONVERSATION_LOAD` are all `withRootPath` now, #1841.)*
- boolean overloads: proposals `APPROVE` / `REJECT` (`false` = no-project ↔
  failed). *(`NOTEBASE_FILE_EXISTS` cleared in #1862, `SOURCES_HAS_PDF` in
  #1881 — both were never listed here; the shape is worth grepping for rather
  than trusting this list to be complete.)*
- in-band `error?` → union: `GRAPH_QUERY` (`{ results, columns, error? }` should
  match the `TABLES_QUERY` `{ ok:false; error }` shape).
- swallows: `LINKS_CITATIONS_FOR_NOTE` (`.catch(()=>'')`), `CSL_REMOVE_STYLE` /
  `CSL_REMOVE_LOCALE` (unlink swallows non-ENOENT), `RUN_COMPUTE_DRAFT`
  (log-only append / audit-record). `FORMATTER_LOAD_SETTINGS` uses
  `readJsonFileOr` as of #1841.
- vestigial: `GIT_COMMIT.success` (hardcoded `true` — any failure throws).

### Config files (#1640)
- Load JSON config through the shared helper in `src/main/config/config-store.ts`
  (`loadConfigFile` / `loadConfigFileSync`), NOT a hand-rolled `try { readFile;
  JSON.parse } catch { return defaults }`. It gives one consistent behavior: a
  missing file → defaults (silent, expected); a corrupt/unreadable file → surfaced
  via `reportConfigError` (loud, not swallowed) then defaults; per-field coercion
  through the shared `as*` decoders (`asString`/`asBool`/`asFiniteNumber`/`asEnum`/
  `asRecord`/`asStringArray`), so each config's `decode(raw)` reads as its schema.
- Migrated so far: `sources/ingest-settings`, `compute/python-settings`,
  `project-config`, `config/inspection-settings`, `history/settings`,
  `recent-projects`, `session`, `privileged-sites`, `compute/consent`,
  `publish/exporters/static-site/site-config`, `llm/conversation` (`loadUIState`
  only — its other `JSON.parse`/`readFile` calls load conversation transcripts,
  a different file shape). `config/project-config-store.ts`'s
  `readRawProjectConfig` is a deliberate exception (#1913): it must THROW on a
  corrupt file rather than default, so a patch is never merged onto a silently-
  emptied file (#1891) — incompatible with `loadConfigFile`'s never-throw
  contract, so it stays hand-rolled but reports via `reportConfigError` before
  rethrowing. Still hand-rolled (migrate when you touch them): `clipper-config`
  (decrypt + lazy secret upgrade), `llm/settings` (nested providers/models),
  `menu-config-store`. `tests/architecture/config-loader-usage.test.ts` (#1913)
  ratchets this list itself — a new hand-rolled disk-read+`JSON.parse` config
  reader fails a test instead of staying invisible the way the six above did
  (`config-roots-doc.test.ts` only checks *where* a config lives, not *how* it's
  read).
- **Where each config lives** is inventoried in `docs/config-roots.md` — the
  three roots (`userData/`, `~/.minerva/`, `<thoughtbase>/.minerva/`) and which
  ones hold secrets. The `userData/` table is checked against the code by
  `tests/architecture/config-roots-doc.test.ts` (#1853), so a new
  `app.getPath('userData')` path that isn't documented fails a test.

### Logging (#1918)

Use `logger(tag)` from `src/shared/logger.ts`, never a bare `console.*` call:

```ts
import { logger } from '../../shared/logger'; // path depth varies by caller

logger('watcher').warn('indexing failed for', relativePath, err);
```

- `LOG_TAGS` in that file is the closed, documented set every call site picks
  from — add a tag there deliberately, in the PR that needs it, rather than
  typing a new bracket string inline. This replaces what used to be ~45
  ad-hoc bracket prefixes (some call sites had none at all) with one
  enforced list.
- `logger(tag)` auto-prefixes the message with `[tag]` — don't also bake the
  tag into the message string.
- `setLogLevel(level)` sets the global floor (`'debug' | 'info' | 'warn' |
  'error'`); `setTagLevel(tag, level | 'silent')` overrides one tag —
  including muting it entirely — without touching every other subsystem's
  output. Deliberately just a `console` wrapper with level control, not an
  observability platform: no transports, no batching, no remote shipping.
- `no-restricted-syntax` in `eslint.config.mjs` bans bare `console.*` in
  `src/` (the logger module itself is exempt, since it's the one file
  allowed to touch `console`). The rule is duplicated into the renderer
  data-flow block's own `no-restricted-syntax` array for
  `src/renderer/lib/components/**/*.svelte` rather than relying on it merging
  across config blocks — flat-config rule VALUES replace, not merge, when two
  blocks match the same file and set the same rule key, so a rule added only
  to the earlier, broader block silently disappears for any file a later,
  more specific block also matches.

### What ships inside the packaged app (#2243)

`forge.config.ts` copies the transitive closure of `EXTERNAL_DEP_ROOTS` into
the bundle, and used to copy each dependency **whole** — every file of every
published tarball. That put 638 `.map` files, 597 `.d.ts` and domino's 7 MB
test suite inside the `.app`.

It matters more than an unpacked-size number suggests: the ZIP maker's output
is the **Squirrel.Mac auto-update payload**, and Squirrel has no delta
mechanism, so every byte is downloaded by every installed user on every point
release.

- **Adding a root?** Only `EXTERNAL_DEP_ROOTS` needs editing; the prune filter
  applies to whatever the closure pulls in.
- **The filter lives in `scripts/lib/package-prune.mjs`**, pure and tested
  (`tests/scripts/package-prune.test.ts`), because a packaging filter that
  over-prunes fails only in a packaged build — the slowest feedback loop here.
  Three rules exist because the obvious version gets them wrong: licences ship
  regardless of extension (`LICENSE.md` is real, and stripping upstream licence
  text from a redistributed binary is a compliance problem); paths are matched
  package-relative (an absolute match prunes everything for a checkout under
  `~/docs/`); and segment equality beats substring (`testing/` is not `test/`,
  `latest.js` does not end in a dead suffix).
- **`build/artifact-size-budget.json` ratchets the DMG and ZIP**, asserted by
  `release.yml`. Same shape as the file-size budgets: it fails on growth, and
  on a shrink big enough to be a real win, so reclaimed space gets recorded
  rather than quietly becoming headroom. Budgets carry ~2% over the measured
  size, because compression output varies between runners and a gate that
  fails on noise is one people re-bless without reading.
- **Measure the compressed artifact, not the `.app`, and measure it rather
  than predicting it.** Two prunes, both measured: 30 MB of source maps and
  declarations moved the DMG by 7.6 MB (#2243); 68 MB of unused ORT WASM moved
  it by 16.0 MB (#2293). Roughly **4:1 in both cases** — #2243 predicted the
  WASM would be different, on the theory that binary barely compresses, and
  was wrong by about 4x. `.wasm` is mostly a sparse instruction encoding and
  deflates about as well as minified JS. Expect ~4:1 from anything in this
  tree, and check the DMG before quoting a number.

### The release tag is `v` + package.json's version (#2245)

Exactly, including any prerelease suffix. Two different systems read the two
values: `release.yml` builds from the **tag** and derives the GitHub
pre-release flag from it, while `update.electronjs.org` compares the **running
app's `version`** against the published release.

When they disagree nothing looks wrong. The build is signed, notarized,
stapled, `codesign --verify`'d, smoke-booted, drafted and published — and the
updater never offers it to anyone. Green at every checkpoint, delivered to
nobody.

`scripts/lib/release-version.mjs` holds the rule and both callers share it:
`tag-release.mjs` refuses to create a bad tag locally, and
`scripts/check-release-tag.mjs` asserts it on the runner for the pushed ref.
The local one alone was not enough — `git tag -a v2.0.3 && git push` never
runs it, and the workflow's `tags: ['v*']` trigger doesn't care how a tag was
made. Every other invariant in that workflow is checked server-side; this one
was checked on a laptop.

Two details worth keeping if you edit the step: it runs **before** the build,
because a signed notarized build of the wrong version costs ~15 minutes and
produces artifacts that must not be published; and the tag arrives through
`env:` rather than `${{ github.ref_name }}` interpolated into `run:`, which is
the standard Actions script-injection shape.
`tests/architecture/release-tag-gate.test.ts` pins both.
### The lockfile gate runs unconditionally (#2244)

`pnpm install --frozen-lockfile` is the only thing in the pipeline that
asserts `pnpm-lock.yaml` still matches `package.json`. It sits behind
`if: cache-hit != 'true'`, and the `node_modules` cache key hashes the
lockfile but **not** the manifest — so editing a version range in
`package.json` without regenerating the lockfile left the key unchanged,
skipped the install, and reported green against dependencies that don't match
the manifest. The drift then surfaced on the next contributor's cold clone,
which is the worst place for it precisely *because* CI was green.

Every job whose install is conditional now runs
`pnpm install --frozen-lockfile --lockfile-only` first — it resolves and
compares without installing or linking (~0.4s), and `--frozen-lockfile` makes
it fail rather than rewrite the lockfile.

Not fixed by adding `package.json` to the cache key, which was the obvious
one-liner: that busts `node_modules` on every version bump and script edit,
and still only checks on the miss path. A job that installs *unconditionally*
(`bench.yml`) needs no separate step — its `--frozen-lockfile` already is the
assertion.

`tests/architecture/lockfile-gate.test.ts` holds both halves: every
conditionally-installing job verifies first and does it with no `if:`, and the
`node_modules` cache keys stay byte-identical across all four jobs in
`ci.yml`, `release.yml` and `bench.yml` (#1638, #663, #2247). That second one
fails nothing when it breaks — the workflows just quietly stop sharing a warm
cache and pay a cold install every run, which is invisible until someone reads
the timings.

The two rules interact, and #2247 is the worked example: `bench.yml` installed
unconditionally, so its `--frozen-lockfile` *was* the gate. Giving it a cache
put the install behind `if: cache-hit` and removed the assertion — the test
caught it in the same commit, and the job grew a verify step. Add a cache to
an installing job and you owe it a verify step.

**Every workflow declares a `concurrency:` group, and decides
`cancel-in-progress` explicitly** (#2247). The value differs on purpose:
`ci.yml` cancels (a superseded PR push is waste), `release.yml` and
`bench.yml` do not — a half-notarized release and a half-finished benchmark
are both worse than a slow one. `bench.yml` is the sharp case: two overlapping
runs measure each other's CPU contention, corrupting the output of the one
workflow whose entire product is a measurement.

### Precomputed artefacts key on content, not mtimes (#2246)

`resources/help-docs/corpus.json` is ~523 doc chunks embedded through the WASM
model — 46s on a CI runner, more than `electron-forge package` (12s) and
Playwright (41s) combined. It's a pure function of committed inputs but
gitignored, so every runner built it cold.

`scripts/build-help-corpus.mjs` skips the rebuild when the corpus was already
built from exactly these inputs, and that check is a **content hash**. It used
to compare mtimes, which answers the wrong question in the two cases that
matter:

- **A restored CI cache.** `actions/checkout` stamps every source file with
  the checkout time; a restored `resources/help-docs/` keeps the older mtime
  it was written with. An mtime check rebuilds every time — so caching the
  directory reports a hit in the log and saves nothing. Verified before
  changing it: touching the inputs to simulate a checkout rebuilt all 523
  chunks.
- **Switching branches.** `git checkout` rewrites mtimes of the files it
  touches, so moving between branches cost a full rebuild even when the docs
  were byte-identical.

The digest hashes filenames alongside contents (so a rename invalidates),
sorts before hashing (so it doesn't depend on readdir order), and includes the
model identity (vectors are only comparable against the model that made them).

`ci.yml`'s cache key hashes the same set, so a cache miss and a rebuild
coincide. Keep the two in step — `tests/architecture/
out-of-band-checks-notify.test.ts` asserts both that the key covers every
input and that the script hasn't gone back to mtimes, because drift there is
silent: the corpus stays correct, the cache just quietly stops paying.

### Dependency advisories are ratcheted, not zero (#2249)

Two gates, both blocking:

- **`pnpm audit --prod`** — the shipped surface, blocking since #1455, and
  clean at high+critical. A new high on a `--prod` dependency fails CI.
- **`node scripts/check-audit.mjs`** — the full tree including build/dev
  tooling, blocking since #2249 against `build/audit-baseline.json` rather
  than against zero.

`audit:all` used to be `continue-on-error: true`, beside a comment planning to
remove it "once the full tree is clean". Nothing could report that the
precondition had been met, because the step was green whether the tree
improved or regressed.

Clean isn't reachable today. All four remaining highs are in the DMG maker's
tree and reach no user: two in `extract-zip` where **no patched version
exists**, and two in `image-size` where a patch exists at `>=2.0.3` but the
installed 0.7.5 comes via `appdmg@0.6.6`, which declares `^0.7.4` and calls
`require('image-size')(path, callback)` — 2.x is ESM-first, exports
`{ imageSize }` taking a Buffer, and has no callback form. Forcing the
override and reproducing appdmg's call gives `sizeOf is not a function`, so
the fix breaks `pnpm build`'s DMG step. Same shape as the
`plist>@xmldom/xmldom` entry in `pnpm-workspace.yaml`, but with no safe floor
— 1.x is vulnerable too.

**The baseline tracks advisory ids, not a count.** A count passes when one
advisory is fixed and another appears the same week, which is the drift this
exists to catch. It fails on growth *and* on a fix (re-bless with
`node scripts/check-audit.mjs --update` so the improvement is held).

When it fires and the advisory has a `patched` version, add a
`pnpm-workspace.yaml` override — and verify with a real build rather than with
`pnpm audit` going quiet. The `tar: '>=7.5.21'` and `plist>@xmldom/xmldom`
entries there are the worked examples of why.

**`release.yml` deliberately runs only `audit:prod`.** A build-tooling
advisory appearing between merge and tag shouldn't block shipping a
user-facing fix, and CI already gates the full tree on every PR.

### Workflow token scopes are declared in the repo (#2251)

Every workflow declares `permissions:`, the workflow-scope value is
`contents: read`, and any write is granted on the job that writes:

| workflow | workflow scope | job grant |
|---|---|---|
| `ci.yml` | `contents: read` | — |
| `bench.yml` | `contents: read` | `issues: write` on `bench` (#2242) |
| `release.yml` | `contents: read` | `contents: write` on `build-macos` |

`ci.yml` and `bench.yml` used to declare nothing, so their token scope came
from a repository settings page. That page says least-privilege today —
checked, not assumed (`gh api repos/:owner/:repo/actions/permissions/workflow`
→ `"default_workflow_permissions":"read"`) — so this was never a live hole. It
was an unpinned assumption: an org- or repo-level change would silently widen
the token with nothing in the repo to show it. A settings page is not
somewhere an invariant can live.

**Writes go on the job, not the workflow.** `release.yml` declared
`contents: write` at workflow scope, which is equivalent while there is one
job and silently wrong at two — a notarization reporter, or the Linux/Windows
builders of #2200/#2197, would have inherited repository write for no reason.
`ci.yml` keeps its read at workflow scope on purpose: `contents: read` is what
a future job *should* inherit, so there inheritance is the feature.

`tests/architecture/workflow-permissions.test.ts` holds all of it, including a
rejection of the `permissions: write-all` shorthand — one innocuous-looking
word that grants every scope there is.
### Actions are pinned to commit SHAs (#2250)

`actions/checkout@v7` is a **mutable** reference: the tag can be moved,
reverted or repointed upstream, and the next run executes different code with
no diff here to show it. A SHA cannot move. Every `uses:` across all three
workflows carries one, with the version as a trailing comment:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

The comment is load-bearing, not decoration — without it a diff is forty hex
characters and nobody can tell `v7.0.1` from a reverted `v6` by eye. It is also
the form `.github/dependabot.yml`'s `github-actions` entry reads and rewrites,
so the pins stay current at no ongoing cost. The gap #2250 closed was
mutability, never staleness.

**All three workflows, not just `release.yml`.** The issue scoped it to the one
holding Apple signing material, which is where the blast radius is, and called
the rest optional. Uniform is better here: partial pinning means a reader
hitting an unpinned `uses:` has to work out whether it was an exemption or an
oversight. It also keeps up with permission changes — `bench.yml` was assessed
as read-only when the issue was filed and gained `issues: write` in #2242.

`tests/architecture/actions-sha-pinned.test.ts` holds it: every `uses:` is a
40-char SHA, each carries a version comment, and one action resolves to one SHA
everywhere (five of the eight appear in all three workflows, so a partial
upgrade is the realistic drift).

To add or bump one:

```sh
gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha
```

Resolve an annotated tag one more hop through `git/tags/<sha>`.

### Out-of-band checks ship their notification path (#2242)

Every detector in this repo runs inside `pnpm test` — coverage floors,
file-size budgets, pattern ratchets, IPC registrar coverage, the architecture
tests — so it fails a PR in front of someone already looking. `bench.yml` is
the one that runs outside the PR loop, and it is the one that went unheard: the
regression gate exited non-zero on **seven consecutive scheduled runs**
(2026-08-03 → 2026-09-14) while a real 3-3.8× save-path regression shipped.
GitHub's only built-in signal for a failing scheduled workflow is an email to
the workflow file's last committer. CI detected the regression seven weeks
before a human did; the defect was in the notification path, not the gate.

**A check that runs out-of-band ships its notification path in the same PR**,
or it is not a check — it is a log of something nobody read.
`tests/architecture/out-of-band-checks-notify.test.ts` enforces it: a workflow
with an `on.schedule` trigger must have a step that runs on `failure()`. It
does not cover `on.push` / `on.pull_request`, which fail visibly by
construction — that asymmetry is the whole point.

Two details in `bench.yml` worth preserving if you edit it:

- **`set -o pipefail` before `pnpm bench:check | tee`.** Without it the step
  reports `tee`'s exit status, the job goes green, and the notify step never
  runs — a silent version of the original bug.
- **One issue, updated weekly**, not a new one per run. A notification path
  that files 52 issues a year becomes noise and then becomes ignored, which is
  where this started.

Scheduled runs only. A failed manual dispatch already has someone watching it;
filing at them trains everyone to skip the label.

### File-size budgets (#1854)

`tests/architecture/file-size-budgets.test.ts` carries a committed
`path → line count` map for every `src/` file over 600 lines, and fails when a
listed file **grows**. It is deliberately not a "no file over N lines" rule —
the point is the derivative, not the absolute. A 1,178-line file that stays
1,178 lines is not today's problem; one that reaches 1,300 is.

When it fires you have exactly two moves, and picking between them is the whole
value of the check:

1. **Extract a seam.** If what you added doesn't belong in the same file as the
   rest, this is the cheapest moment to notice.
2. **Raise the number in the same PR.** Sometimes the file really is the right
   home and the seam doesn't exist yet — say so in the diff and move on.

Shrinking a budgeted file also fails, asking you to lower the number (or drop
the entry once the file is under 600 lines) so reclaimed space doesn't quietly
become headroom for the next addition. Same shape as the pattern ratchets in
`tests/architecture/pattern-ratchets.test.ts` and the coverage floors in
`vitest.config.mts`.

Its sibling `tests/architecture/ipc-registrar-coverage.test.ts` makes the
"every `register-*` handler ships with a main-process test" checklist item
above executable: a **new** registrar with no test fails, and the pre-existing
untested ones sit in a `KNOWN_UNTESTED` list that may only shrink.

### File System
- All paths are relative to the project root
- `assertSafePath()` in `fs.ts` prevents path traversal — always use it//
- Hidden files (`.`) and `IGNORED_DIRS` (`.git`, `node_modules`, `.minerva`, `.obsidian`) are filtered from listings
- Empty folders are shown in the sidebar (not filtered out)

### Knowledge Graph
- Stored in `.minerva/graph.ttl` (Turtle format)
- Auto-indexed on file write
- Manual rebuild via Query menu
- Extracts: titles, tags, wiki-links, frontmatter metadata, embedded Turtle blocks, markdown tables (CSVW)
- Queryable via SPARQL through `api.graph.query()`
- Standard prefixes (minerva, thought, dc, rdf, rdfs, xsd, csvw, prov) are auto-injected into all queries

#### Per-project state goes in a `createProjectStore` slot (#2240)

Anything a subsystem holds per open thoughtbase — caches, results, timers,
subscriptions — goes in `createProjectStore<T>({ dispose })` (#1085), not a
module-level `Map`/`Set` keyed by `rootPath`. A store self-registers, so
`disposeAllProjectStores` tears it down on the last window close without
`project-context.ts` naming your subsystem.

A hand-rolled map opts out silently: nothing fails and no lint fires, it just
becomes invisible to disposal. `graph/health-checks.ts` had four (they live in
`graph/health-check-state.ts` now, #2288). Two were torn
down because the orchestrator named them; `lastResultsByProject` had no
`.delete` call anywhere, so **closing a thoughtbase left its whole inspection
list resident and reopening served last session's findings** — `getInspections`
is the `INSPECTIONS_GET` handler the panel reads. A wrong answer, not just a
leak.

`tests/architecture/project-state-registered.test.ts` finds the shape: a
collection indexed by `rootPath` that `createProjectStore` didn't build. Its
`KNOWN_UNREGISTERED` list may only shrink; the entries there are torn down by
an explicit call today, which is precisely the arrangement that let the
health-check maps go unnoticed.

**The result type is `shared/inspections.ts`'s, not the engine's** (#2288).
`Inspection` sits beside the catalog because both processes need the shape:
it had five hand-written copies (the engine, two inline in
`shared/ipc-contract.ts`, two more in `renderer/lib/ipc/client.ts`, and a local
interface in `InspectionsPanel.svelte`), and every copy had quietly widened
`severity` from the union to `string`. Import it; don't re-declare it.

Two things worth copying from how #2240 did it:

- **A read must not allocate a slot.** `getInspections` uses `store.get(ctx)?.x
  ?? []` rather than a create-on-demand helper — otherwise a panel polling a
  closed project re-registers it and the leak returns by another route.
- **State detaches on dispose, and that's the point.** `dispose` removes the
  entry before running its hook, so a run still in flight writes to an object
  nothing can reach. Check `store.get(ctx) === state` before firing a change
  event, or you wake a panel for a thoughtbase that isn't open.

Keep any explicit teardown the orchestrator already does (`stopPeriodicChecks`
/ `disarmAutoChecks` run *before* the final persist, so nothing new is
scheduled mid-teardown). The store is the net underneath it, not a replacement.

#### `graph/` does not import `notebase/` (#2238)

The dependency runs one way: **`notebase` → `graph`**. Saving a note drives the
indexer, so `write-pipeline`, `rename`, `merge` and `watch-handlers` all call
into `graph/`. Nothing goes back the other way.

It used to. Three edges made `graph ↔ notebase` a real two-way package
dependency — `indexers/rebuild.ts` → `indexable-files`/`ignored-dirs`, and
`health-checks.ts` → `asset-references`. **`no-cycles.test.ts` passed on all
three and was right to**: it checks *module* cycles, and each edge points at a
different file, so no file imports itself back. The coupling was real anyway.

`tests/architecture/no-package-cycles.test.ts` is the missing notch. It
collapses the module graph to `src/main/<package>` and fails on a two-way
dependency between packages. Its `KNOWN_PACKAGE_CYCLES` list may only shrink,
same as every other ratchet here — and its entries are findings, not noise:
nine package cycles were underneath `graph ↔ notebase` once that one was
broken (#2283 for the four that are one module in the wrong package, #2284 for
the four that are a layering decision). None is a tangle — **every entry has a
thinner direction of one or two imports**, so what a cycle reports is usually a
single misplaced module rather than two subsystems grown together. Loose files
directly under `src/main/` are deliberately excluded (the composition root
wires every package by definition; its header says why).

The three ways out when it fires — #2238 and #2283 used the first two, #2284
the third:

1. **A leaf utility belongs in `src/shared/`.** `ignored-dirs` and
   `indexable-files` moved there. Note `src/shared` is lint-enforced pure — no
   Node builtins (#668) — so `isIndexable` had to shed `node:path` first; the
   string replacements are checked against the real `path.basename`/`extname`
   by a differential test rather than assumed equivalent.
2. **Inject the collaborator.** `health-checks.ts` takes `findOrphanedAssets`
   through `HealthCheckDeps`, the same way it already takes `loadSettings`.
   **Omitting it makes the unreferenced-image check report nothing** — there is
   no graph query to fall back on — so the two production call sites
   (`project-context.ts`, `ipc/register-graph.ts`) must pass it.

3. **Inject the collaborator, or move the file that shouldn't be in the
   package.** #2284's three fixes were all an import that shouldn't have
   existed: `sources/mine-references.ts` imported `complete` only as the
   default for an injection seam it already had; `notebase/watcher.ts` took a
   `BrowserWindow` where a notifier would do (it is Electron-free now, and
   `startWatching` takes a `WatcherTarget`); `watch-handlers.ts` was
   composition-root code filed under `notebase/`, so its fan-out read as
   `notebase → compute` and `notebase → sources`.

**A cycle may also be kept deliberately.** `notebase ↔ sources` is, and the
entry says why: dropping a PDF creates a Source (`drop-import.ts` dispatches a
dropped file to whichever subsystem owns its type) and `merge-sources.ts` uses
`notebase/fs.ts`, the sandboxed file API eight packages import. Both directions
are product facts, not misplaced files, and the only route to a green result
would move a fact to a call site to satisfy a check. A cycle someone looked at
and accepted is not the same as one nobody noticed — holding that difference is
what `KNOWN_PACKAGE_CYCLES` is for, so an entry needs a reason, not just a
name.

Related: reach `graph/` through `graph/index.ts`, not past it. `DAY_MS` now
lives in `shared/time.ts` (a millisecond constant is not graph API — `llm` and
`history` were importing it from `graph/queries`), and `excerptUriFor(ctx, id)`
joins `noteUriFor` on the facade so `llm/attach-evidence.ts` no longer pulls
`getState` out of `graph/state.ts` to build one IRI.

#### The rdflib store stays inside `graph/` (#2234)

`GraphState` was an open twelve-field record; it is now six
(`rootPath`, `baseUri`, `store`, `n3Cache`, `ontologyStatements`,
`typeCatalog`). The derived caches moved to `graph/note-caches.ts` (headings,
frontmatter keys, neighborhood memo) and `graph/note-index.ts` (note paths +
frontmatter aliases), each with its own `createProjectStore` slot.

**`store` — the mutable rdflib `IndexedFormula` — belongs to the graph
package.** `tests/architecture/graph-store-encapsulation.test.ts` enforces it:
no module outside `src/main/graph/` may name `GraphState` or reach `.store` on
it. Need graph work done from elsewhere? Put the operation *in* `graph/` and
export it, the way #2234 PR 3 did with `materializeTypeClasses` — which had
been writing the graph's internal store from `src/main/types/`, and was also
half of a package cycle (`types/compile` → `graph/state`,
`graph/indexers/rebuild` → `types/compile`) that file-level cycle detection
never saw because `state.ts` imports nothing back.

Inside `graph/`, the indexers and query layer use `store` directly and that is
fine — the package working with its own data structure isn't a layering
violation, and the write guard at the `store.add`/`store.removeMatches`
chokepoint (#2231) already covers every one of those writes. The boundary is
the thing worth enforcing, not a wrapper per call site.

The one shape the test honestly cannot catch is a bare `IndexedFormula` passed
across the boundary — lexically indistinguishable from the private scratch
`$rdf.graph()` that `sources/import-zotero-rdf.ts` legitimately builds. Its
header says so. What prevents a repeat there is structural: no module outside
the package holds the store to pass on.

### Thought Ontology
- Defined in `src/shared/ontology-thought.ttl`
- Separate namespace: `thought:` (`https://minerva.dev/ontology/thought#`)
- Models epistemic structure: claims, grounds, warrants, hypotheses, questions, and 30+ component types
- Includes epistemic defects: fallacies, biases, rhetorical moves, structural problems
- Proposals and conversations aligned with W3C PROV-O provenance model

#### Two representations of one claim, and the fragments that know both (#2230)

A thought component reaches the graph two ways, and a query written against
only one of them is a silent wrong answer, not an obvious bug:

- **Hand-authored Turtle** — an embedded ` ```turtle ` block, the `crystallize`
  skill, the tutorial thoughtbase — asserts `a thought:Claim` with a
  `thought:label`.
- **A typed note** — what every claim the app itself files looks like since
  #2036. `type: claim` frontmatter asserts `a types:Claim`, which
  `types/compile.ts` declares `rdfs:subClassOf thought:Claim` (deliberately not
  `owl:equivalentClass` — the store does no OWL entailment), and the title
  lands as `dc:title`. Neither `a thought:Claim` nor `thought:label` matches it.

So **query components through `src/main/graph/argument-patterns.ts`**, not by
hand: `isA(v, cls)` (the `rdf:type/rdfs:subClassOf*` path), `labelOf(v)`
(`thought:label` preferred, `dc:title` fallback), `supportedBy` / `unsupported`
(`thought:supports` from frontmatter and the Claim type, `minerva:supports`
from a `[[supports::note]]` wiki-link — both mean support). `health-checks.ts`
and `register-graph.ts`'s grounding query both build from it.

`unsupported` emits one `FILTER NOT EXISTS` per predicate rather than one over
their alternation *on purpose*: Comunica evaluates
`FILTER NOT EXISTS { ?x (a|b) ?y }` — and the equivalent inner `UNION` — as
matching nothing when neither predicate appears anywhere in the store, which
inverts to excluding every row. That reports zero unsupported claims on exactly
the thoughtbase most likely to have them. A single-predicate `NOT EXISTS` is
fine, and so is an alternation in positive position.

#### The ontology is executable, not decorative (#2230)

`tests/architecture/ontology-terms.test.ts` parses `ontology.ttl` and
`ontology-thought.ttl` and asserts every `thought:X` / `minerva:X` named
anywhere in `src/` — prose, skill bodies and `THOUGHT('x')` call sites included
— is a term one of them declares. Adding a predicate to the code means adding
it to the ontology in the same PR.

This matters beyond tidiness: `describe_graph_schema` hands both files to the
LLM verbatim and tells it the contents are authoritative before it writes
SPARQL. Nothing checked that claim until this test, and `ontology.ttl` had been
shipping *unparseable* (a stray `;x`) for an unknown length of time, with ~17
load-bearing predicates undeclared. The test is deliberately not a
SHACL/reasoner layer — see #2241's scope notes.

What it does **not** check: the reverse direction (a declared term nothing
uses — normal for vocabulary users author by hand), or whether a term's
`rdfs:domain`/`rdfs:range` match how the code uses it. Only the name.

### Tools for Thought (Skills)

The Learning / Research / Analysis menus are populated by **skills** — markdown
files (YAML frontmatter + a template body), not hardcoded `.ts` tools. There is
no longer a `definitions/` tool registry; do not add one.

- **Stock skills** live in `src/main/skills/stock/*.md` (bundled at build time
  via `import.meta.glob`). **User skills** live in `~/.minerva/skills/` (bare
  `.md` or a folder with `SKILL.md`), loaded at runtime; user skills are
  additive — they can't shadow stock.
- Pipeline (all in `src/main/skills/`): `parse.ts` → `loader.ts` (catalog) →
  `compile.ts` (→ `ThinkingToolDef`) → `register.ts` (into `shared/tools/registry.ts`).
  `template.ts` is the non-executing prompt language (`{{var}}`, `{{x | filter}}`,
  `{{#if}}…{{else}}…{{/if}}`), rendered in main at prepare/execute time.
- The renderer never sees prompt bodies — it gets serializable `SkillInfo` via
  `api.skills.list()` and registers it into its own copy of the registry.
- **Menu config** (`~/.minerva/menu-config.json`, per machine): enable/disable,
  reassign among the three menus, and order. Pure logic in
  `src/shared/skills/menu-config.ts` (`applyMenuConfig`) is applied identically
  by the native menu, the renderer registry, and the Settings → Skills UI.
- **Grouping** (#525): a skill's optional `group:` field renders thematic
  nested submenus within a menu (pure logic in `src/shared/tools/grouping.ts`;
  applied in `menu.ts`). A menu stays flat until one of its skills sets a group.
- **Source scope** (#103): `scope: source` routes a skill to the Source
  viewer's Tools menu (excluded from the note menus + editor right-click via
  `isSourceScoped` in `shared/tools/types.ts`) and feeds it `sourceMetadata` /
  `sourceBody` context (`{{source.*}}`). Source skills write back via the
  approval-gated `propose_source_properties` tool → `meta.ttl` upsert
  (`sources/source-meta-write.ts`). Worked example: `propose-source-summary.md`.
  Claim mining (#104): `propose_claims` files `thought:Claim` notes + anchored
  `thought:Excerpt` nodes (the approval engine's `excerpt` payload kind is now
  wired) via `extract-key-claims.md`.
- Authoring reference: `docs/authoring-skills.md`. To change a stock skill,
  disable it and author your own — don't edit bundled files.

## LLM Integration Principles

### The Trust Principle

> **The LLM proposes, the human confirms.** Conversation outputs are evidence to be evaluated and filed, not authoritative updates to the graph. This is the most important design decision in the system.

All LLM-originated graph mutations **must** go through the approval engine (`src/main/llm/approval.ts`). The LLM never writes directly to the knowledge graph. Instead:

1. LLM operations produce `thought:Proposal` nodes with status `thought:pending`
2. The user reviews proposals via the diff view and approves/rejects with a single keystroke
3. Only approved proposals mutate the graph
4. Proposals that aren't reviewed auto-expire after a configurable window

### One tier: everything is proposed

Every LLM-originated write is filed as a **pending** `thought:Proposal` and
applied only when the user approves it — there is no lower-trust tier. An
operation's `operationType` (new_claim, note_rewrite, component_creation,
note_refactor, note_delete, source_properties, …) is descriptive metadata for
the review UI, **not** a trust level. Even the "quiet" paths conform: auto-tag,
for instance, files a normal `note_rewrite` proposal and self-approves it only
after the user accepted the tags on the conversation card.

> **Historical note:** earlier designs sketched `notify_only` (apply + audit)
> and `autonomous` (apply silently) tiers, with an established-node escalation to
> pull them up to `requires_approval`. No write path ever used them, so the tiers
> and their orphan operation types (tag_addition, staleness_flag,
> confidence_update, status_change) were removed. If a genuine lower-trust
> operation is ever needed, re-introduce a tier deliberately rather than assuming
> one exists.

### Code Review Checklist for LLM/Graph PRs

When reviewing PRs that touch LLM integration or graph write paths:

- [ ] Does the code path go through the approval engine? If not, justify why.
- [ ] Are `thought:Component` nodes created with `thought:extractedBy` and `thought:proposedAt` provenance?
- [ ] Does the code create `thought:Proposal` nodes for operations that require approval?
- [ ] Is there a SPARQL integrity check that could detect if this write bypassed approval?
- [ ] Are there tests that verify the approval gate cannot be skipped?
- [ ] Does every new `register-*` IPC handler ship with a main-process test, and is its module covered by a `vitest.config.mts` threshold? An untested handler is how the `CONVERSATION_SEND` gap slipped in (#1612) — a new handler needs both a test and threshold enrollment so it can't silently regress.

### Coverage floors (#2239)

Every `src/main/**` subsystem now carries a per-area floor in
`vitest.config.mts`, so the checklist item above is answerable rather than
rhetorical — until #2239 fifteen of them sat under the 45%-lines global
backstop alone, which catches a wholesale collapse and nothing smaller. Each
floor was measured, not chosen: 3-5 points below the real number for the larger
trees, 8-10 for single-file ones where one new file swings the aggregate. **A
new subsystem directory under `src/main/` needs its own entry** — otherwise it
inherits the backstop and can rot to 46% unnoticed.

Two shapes worth knowing:

- **A glob cannot fail on account of one file.** `src/main/mcp-client/**` sits
  at 99%, so a new OAuth module landing at 0% would be carried by the 24 around
  it. That's why `oauth/**` has a floor of its own, and why `ipc/helpers.ts`,
  `register-proposals.ts` and friends have per-file entries. Add one whenever a
  single file inside a well-covered tree is its own trust boundary.
- **A floor can record a weakness.** `src/main/formatter/**` is fenced at 50/34
  — its real numbers. That fixes nothing, but it stops the gap widening and
  puts it in the same file as its neighbours in the 80s and 90s, which is where
  someone will notice it.

### Write Guard

The graph module exposes `enterLLMContext()` / `exitLLMContext()` (and the
`withLLMContext(fn)` wrapper) to mark call paths originating from LLM operations.
Any graph write while in LLM context that doesn't go through the approval engine
(which marks its own writes with `enterTrustedContext()`, applied across the
whole `applyBundle`) trips `checkLLMWriteGuard`.

**The guard is fatal under test and non-fatal in dev/prod (#944):** under the
test runner it **throws**, so an accidental approval-engine bypass fails CI —
the invariant "every LLM-originated write goes through
`proposeWrite()`/`approveProposal()`" is *enforced*, not merely observed. In dev
and production it stays a `console.warn` (a development guardrail must never
crash the user's app; it's not a runtime security boundary).

For the guard to catch a bypass, the offending write must run in LLM context.
The converged LLM apply paths — auto-tag, auto-link (out/inbound),
`set_properties`, `propose_source_properties`, and the note-body rewrite — wrap
themselves in `withLLMContext` (or `enterLLMContext`) so a regression that writes
directly instead of via the approval engine is caught. **Wrap any new
LLM-originated apply path the same way.**

#### The guard lives at the store chokepoint (#2231)

`instrumentStoreMirror` (`graph/state.ts`) wraps `store.add` and
`store.removeMatches` for the N3 mirror, and **every triple mutation in the
system goes through one of them** — `$rdf.parse` calls `store.add` per
statement, so bulk Turtle loads are covered too. That is where
`checkStoreWriteGuard` runs, which makes coverage total rather than opt-in.

It used to be fourteen hand-pasted `checkLLMWriteGuard(...)` calls in the
indexer facades, and they missed seven store-mutating functions —
`indexAllNotes`, `reloadTypeCatalog`, `addOntologyToStore`, `initGraph`,
`persistGraph`, `setBaseUri`, and `materializeTypeClasses`, that last one
writing the graph's internal store from a different package. So the promise
above was conditional on which function the write happened to arrive through.
**Don't add `checkLLMWriteGuard` to a new indexer — it is already covered.**

Two consequences worth knowing:

- **Never swallow a `TrustGuardError`.** The guard now throws from *inside*
  the `try` blocks around `$rdf.parse` that exist to tolerate malformed
  Turtle, so a bare `catch` turns a caught bypass into a logged parse error
  and nothing else. Every such catch calls `rethrowIfTrustGuard(e)` first; do
  the same in any new one. (It matches the wrapped form too — rdflib re-raises
  whatever `store.add` throws as its own `Error`, discarding the class.)
- **The message names the store op and subject** (`store.add(<https://…>)`),
  not the facade, which the chokepoint can't know. Under test the guard throws,
  so the stack names the facade and everything above it; in dev/prod the subject
  IRI identifies the write.

`persistGraph` wraps its ontology strip/restore in `withTrustedContext` — it is
serialization bookkeeping that leaves the store byte-identical, and it is
genuinely called from LLM context. `initGraph` is deliberately **not** wrapped:
nothing calls it from an LLM path today, and blanket-trusting a bulk load of
whatever is on disk would be a permanent hole.

### Integrity Query

The integrity-check SPARQL below detects `thought:Component` nodes attributed to an LLM that lack a corresponding approved proposal. Run it (Graph > Query) after any LLM integration work to verify the trust principle holds. It used to ship as the "Trust: Unreviewed LLM writes" stock query, but the `Trust:` / `Claims:` / `Compute:` stock queries were pulled from the default set as too confusing for end users — keep this one handy for development.

It's also promoted to an automated gate (#1101): `findUnreviewedLLMWrites` in `src/main/graph/integrity.ts` is the canonical executable copy, asserted on every PR by `tests/main/graph/trust-integrity.test.ts` (honest path → empty; bypass / pending-only proposal → flagged). Keep the query below in sync with `UNREVIEWED_LLM_WRITES_QUERY` there.

```sparql
PREFIX thought: <https://minerva.dev/ontology/thought#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?component ?label ?extractedBy WHERE {
  ?component rdf:type/rdfs:subClassOf* thought:Component .
  ?component thought:extractedBy ?extractedBy .
  FILTER(CONTAINS(LCASE(?extractedBy), "llm"))
  OPTIONAL { ?component thought:label ?label }
  FILTER NOT EXISTS {
    ?proposal rdf:type thought:Proposal .
    ?proposal thought:affectsNode ?component .
    ?proposal thought:proposalStatus thought:approved .
  }
}
ORDER BY ?component
```
