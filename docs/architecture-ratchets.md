# The architecture ratchets

`tests/architecture/` holds the tests that check the **shape of the codebase**
rather than the behavior of any feature: import cycles, file sizes, config
loading, store ownership, CI workflow hygiene, whether a doc still matches the
code it describes. They run inside `pnpm test` like everything else, which is
the whole point — a detector that runs where someone is already looking fails
in front of a human, and one that runs on a schedule fails into a log
(`out-of-band-checks-notify.test.ts` is that lesson, ratcheted).

**Read the entry for the test that failed before you edit the test.** Almost
all of these are *budgets, not verdicts*: a committed baseline that may only
shrink, so the failure message is "you added a new one", not "this is
forbidden". Adding yourself to a baseline list is sometimes the right answer —
it is never the answer that needs no reason in the diff.

CLAUDE.md documents about a dozen of these in the convention sections that
motivated them, and those sections carry the *why* at length. This file is the
complete inventory: one entry per test, what it enforces, what makes it fire,
what to do about it. `architecture-ratchets-doc.test.ts` keeps the two sides in
step — a new test in `tests/architecture/` with no entry here fails, and an
entry here naming a test that no longer exists fails too (#2262).

Written up as of 2026-09-23, 38 tests.

---

## Layering and module structure

### `no-cycles.test.ts`

**No import cycle anywhere in `src/`** (#1847). Layer *directions* are eslint's
job (`shared ↛ main/renderer/preload`, `main ↛ renderer`, `renderer ↛ main`,
`cli ↛ renderer`); cycles are the orthogonal property, and nothing checked them
until this landed — a cycle *within* a layer (`llm/a → llm/b → llm/a`) passed
lint, `tsc` and the whole suite. It matters because the codebase leans on
acyclicity deliberately and says so in comments (`graph/indexers.ts` imports
`./state` and "never from `./index`, to keep the package acyclic";
`history/index.ts` spells out its one-way chain). Uses `dependency-cruiser`, not
a regex over import lines — it resolves tsconfig paths, extensionless imports,
`.svelte` files and type-only imports, because a cycle detector that silently
misses edges is worse than none, since it reads as a guarantee. **When it
fires:** it prints the chain that closes the cycle. Break the thinnest edge —
usually one import that shouldn't exist.

### `no-package-cycles.test.ts`

**No two-way dependency between `src/main/<package>` directories** (#2238).
The notch above `no-cycles`: collapse the module graph to packages and look for
mutual dependence. `graph ↔ notebase` was a real two-way package dependency
that `no-cycles` passed on, correctly — the three edges pointed at three
different files, so no *module* imported itself back. `KNOWN_PACKAGE_CYCLES` may
only shrink, and its entries are findings rather than noise: every one has a
thinner direction of one or two imports, so what a cycle reports is usually a
single misplaced module, not two subsystems grown together. Loose files directly
under `src/main/` are excluded — the composition root wires every package by
definition. **When it fires:** three ways out, in preference order — move a leaf
utility to `src/shared/` (which is lint-enforced pure, no Node builtins);
inject the collaborator instead of importing it; or move the file that is filed
under the wrong package. A cycle may also be *kept* deliberately
(`notebase ↔ sources` is), but the entry then needs a reason, not just a name.
See CLAUDE.md, *`graph/` does not import `notebase/`*.

### `graph-store-encapsulation.test.ts`

**The mutable rdflib `IndexedFormula` stays inside `src/main/graph/`** (#2234).
No module outside the package may name `GraphState` or reach `.store` on it.
Inside `graph/`, the indexers and query layer use `store` directly and that is
fine — a package working with its own data structure isn't a layering violation,
and the write guard at the `store.add`/`store.removeMatches` chokepoint already
covers every one of those writes. **When it fires:** put the operation *in*
`graph/` and export it, the way `materializeTypeClasses` was (it had been
writing the graph's internal store from `src/main/types/`). The one shape the
test honestly cannot catch is a bare `IndexedFormula` passed across the
boundary — lexically indistinguishable from the private scratch `$rdf.graph()`
that `sources/import-zotero-rdf.ts` legitimately builds.

### `project-state-registered.test.ts`

**Per-project state lives in a `createProjectStore` slot, not a module-level
`Map` keyed by `rootPath`** (#2240). A store self-registers, so
`disposeAllProjectStores` tears it down on the last window close without
`project-context.ts` naming your subsystem; a hand-rolled map opts out silently.
This is not a tidiness rule — `graph/health-checks.ts` had four, and
`lastResultsByProject` had no `.delete` anywhere, so closing a thoughtbase left
its whole inspection list resident and reopening served last session's findings.
A wrong answer, not just a leak. `KNOWN_UNREGISTERED` may only shrink; its
entries are torn down by an explicit call today, which is precisely the
arrangement that let the health-check maps go unnoticed. **When it fires:** use
`createProjectStore<T>({ dispose })`. Two details worth copying: a read must not
allocate a slot (`store.get(ctx)?.x ?? []`, not create-on-demand), and check
`store.get(ctx) === state` before firing a change event, since `dispose`
detaches state deliberately.

---

## Renderer data flow and UI

### `store-ownership.test.ts`

**Every `api.<domain>` with a mutating method has an owner under `stores/` or
`lib/app/`** (#1852) — the positive half of the renderer data-flow rule, whose
negative half is the eslint `no-restricted-syntax` denylist. A mutation may not
land only in `App.svelte`. This is the gap #1834 fell through: four mutating
channels shipped with no store, and the panel polled a timer instead of
listening for a change event. **When it fires:** add the store, don't add an
exception. Note what it *can't* tell you — it doesn't distinguish a real store
from a passthrough (that's the next test), and it says nothing about whether a
mutating channel ships a change event, which is a main-side question.

### `store-state-ownership.test.ts`

**Names every store that calls `api.*` but owns no `$state`/`$derived` of its
own** (#2051). `store-ownership` checks a mutation *has* an owner; this checks
the owner *owns something*. Two real stores proved the gap wasn't hypothetical —
`publish.svelte.ts` and `review.svelte.ts` are pure forwards whose own doc
comments say "Thin passthroughs", and they satisfy #1852 completely. It does not
ban the shape: a pure passthrough is legitimate when the calling component does
its own read-refresh, which is what every entry in the baseline relies on.
**When it fires:** either give the store the reactive state its callers are
hand-rolling, or add the entry with the reason — the baseline is a budget, and
each entry's string is the rationale a reviewer re-checks before a seventh one
lands.

### `ui-dialog-adoption.test.ts`

**A new `*Dialog.svelte` adopts the shared `ui/Dialog.svelte` shell** (#2047) —
backdrop, escape-to-close, focus trap, instead of hand-rolling each. #1888
introduced the shell and migrated 18 of 32 dialogs; unlike every comparable
migration in this repo it shipped with no fitness function, so the two shapes
could drift apart indefinitely rather than the holdout count shrinking toward
zero. `UNMIGRATED_BASELINE` names each holdout individually so a reviewer
re-affirms it rather than watching a count grow. A third assertion fails on
*stale* entries, so a migrated dialog has to be removed from the list. **When it
fires:** import `ui/Dialog.svelte`. If the dialog genuinely needs a custom
shell, add it with a reason.

### `argument-map-read-only.test.ts`

**The `:::argument` embed is a view of the graph and never mutates it** (#907) —
its files may call exactly `api.graph.query` and nothing else on the `api.*`
surface, and no method the data-flow rule classifies as a mutation. Reuses the
same lexical `api.<domain>.<method>(` scanner as the data-flow coverage tests
(`tests/helpers/renderer-api-surface.ts`) so "mutation" can't come to mean
something different here than elsewhere. **When it fires:** the embed is trying
to write. That's the acceptance criterion it was built against; route it
through a store and a proposal like any other write.

### `scoped-css-duplication.test.ts`

**No new byte-identical CSS rule body copied across component `<style>`
blocks** (#2101). Svelte scopes a component's styles to that component, so a
shared class name carries no CSS with it and each file restates the rule —
`CollectionsTree.svelte` and `ReadingQueueSection.svelte` had carried an
identical ~40-line `.coll-row` block. Only *byte-identical* bodies (selector and
declarations) count: two components that happen to both have a `.field` with
different CSS is not a bug. Baselines go down as well as up — centralizing a
shape asks you to lower its number so the win doesn't become headroom for the
next copy-paste. Lexical, not a CSS parser; a rule nested in `@media` folds the
condition into the "selector", which under-matches rather than false-failing.
**When it fires:** promote the shape to `global.css` (leaving genuinely
per-instance one-liners local), or make the copies diverge on purpose.

---

## Documentation parity

### `config-roots-doc.test.ts`

**`docs/config-roots.md` names every `userData/` config path built in
`src/main`** (#1853) — the original worked example of a doc checked against the
code, and the model for the two below. It covers root 1 only, because
`getPath('userData')` is the one machine-checkable spelling; `~/.minerva/` and
`<thoughtbase>/.minerva/` are still hand-maintained and can still drift. It
checks *presence*, not accuracy: a row whose description is wrong still passes,
because naming the file was the part actually being forgotten. **When it
fires:** add the row, and if the file holds a secret list it under "Secrets, at
a glance" too. A companion assertion fails on a call site written in a shape the
regex can't read, so an unreadable path can't quietly become an undocumented
one.

### `claude-md-accuracy.test.ts`

**Six CLAUDE.md claims checked against the code they describe** (#2257, #2258,
epic #2268): that the `pnpm lint` description matches whether `scripts/lint.mjs`
actually runs its checks in parallel; that every concrete repo path named in
CLAUDE.md, `docs/development.md` or this file exists on disk; that the dialogs
section points at the module where `showPrompt`/`showConfirm` are defined and
lists their real parameters; that the documented SPARQL prefix list equals
`STANDARD_PREFIXES`; that the integrity-query code block matches
`UNREVIEWED_LLM_WRITES_QUERY` modulo the `PREFIX` lines; and that the IPC-channel
recipe names every file a channel addition must touch — including the
`ChannelMap` entry and the two snapshots the old five-step version omitted
(#2258), backed by a check that `ipcMain.handle` still has exactly one call site,
which is what makes the `ChannelMap` step compile-blocking rather than advisory.
All six were wrong or incomplete
when the test was written, and the lint one is the epic's own worked example of
how fast this drifts: a PR titled *"docs: fix dev-doc lint-description drift"*
was obsoleted **49 minutes after merging** by a same-day change to the exact
thing it had just described, and stayed wrong for seven weeks in two documents.
**When it fires:** the code moved and a sentence didn't. Fix the sentence — or,
if the code regressed, fix the code; each assertion's message says which
direction it expects.

### `architecture-ratchets-doc.test.ts`

**This file has an entry for every test in `tests/architecture/`, and no entry
for a test that doesn't exist** (#2262). Bidirectional on purpose: forward, so a
new ratchet ships its own "what to do when this fires"; backward, so a deleted
or renamed test doesn't leave instructions pointing at nothing. **When it
fires:** add the section, keeping the `` ### `name.test.ts` `` heading shape the
test parses.

### `docs-parity.test.ts`

**Hand-maintained counts in the docs match the code that owns them** (#2255,
#2261) — typed link types, stock skills, user-manual pages, the Analysis menu's
size, the Settings dialog's tabs. Nine findings of the 2026-09-20 doc review
were this one shape: a document restates a number some file already owns
authoritatively, then drifts. `src/shared/link-types.ts` opens with *"To add a
new link type, add an entry here. Everything else derives from this list"* —
everything except the README, which said 11 against 12. "Nearly 50 skills"
against 56; `authoring-skills.md`'s "the Analysis menu has 20" against 29; and
`website/docs/_content/settings.html` carried **four different counts of the
same thing** against a real 16. Every assertion computes the expected value from
`src/` and scrapes the actual one out of literal prose, and each scrape is
asserted to have matched *before* its value is compared — a parity test that
derives both sides from one place passes vacuously and forever. **When it
fires:** update the number in the document; if the sentence was reworded so the
scrape stopped matching, fix the pattern in the same PR rather than deleting the
assertion, or the count silently stops being checked.

### `cli-docs-parity.test.ts`

**`docs/cli.md` and the CLI's own `--help` name every command the dispatch
table runs** (#2263), plus every tool the MCP server exposes. Three places have
to agree — the `switch (args.command)` in `src/cli/run.ts` (what runs), the
`HELP` string above it (what `--help` prints), and the doc (what a reader is
told) — and two of the three are hand-maintained prose about the first. Both had
drifted: `grep` and `eval` were implemented and missing from the doc's command
table, the MCP tool list named 7 of 8, and the doc still called MCP "the
forthcoming MCP subcommand" forty lines after documenting it as shipped (a
separate assertion now fails on that phrasing). It checks that each command is
*named*, not that what is said about it is true. **When it fires:** add the row
to `docs/cli.md` and the line to `HELP`. An anchor test fails loudly if the
shapes it parses stop being found, so a refactor of the dispatch can't quietly
switch the check off.

### `docs-url.test.ts`

**Help → Documentation points at the user manual, and the Command Palette is a
real menu item** (#2254, #2256). `DOCS_URL` pointed at the repository's
*developer* docs folder — a GitHub file listing of `releasing.md`,
`packaging.md` and friends — while the actual 118-page manual built from
`website/docs/` had no route from the app at all. It was wrong because it was
written down **nowhere**: no second copy existed for anyone to keep the first in
step with. So the URL is recorded in `docs/releasing.md` beside the deploy-script
row and the two copies check each other, and further assertions pin it under the
host that serves the built site and confirm the manual it names is the one this
repo builds. The Command Palette half checks the item is in the template, on the
accelerator the renderer actually binds, and dispatches a channel rather than
doing work inline (#2233). **When it fires:** change both copies of the URL, or
add the menu item back. What it cannot do is confirm the site is *up* — that
needs a network call, which doesn't belong in a unit suite.

### `authoring-types-doc.test.ts`

**`docs/authoring-types.md` names every key, property type and prefix the type
format actually supports** (#2265). The `.md`-with-frontmatter object-type
format had no documentation outside its parser: `externalClass:` — the #2036 key
that makes `type: claim` answer a query about `thought:Claim` — appeared in zero
files under `docs/` or `website/docs/`. Five inventories, each read from its own
authority: the frontmatter keys `types/parse.ts` reads, the per-property keys,
`PROPERTY_TYPES`, `STANDARD_PREFIXES`, and the stock type files. The prefix list
is the load-bearing one — it's the closed set a CURIE can resolve against, and
the one thing a type author cannot discover by experiment, because an
unrecognized prefix fails **silently**. **When it fires:** document the new key
or prefix in the same PR that adds it.

### `thought-ontology-doc.test.ts`

**`docs/thought-ontology.md` names every class, property and individual the
thought ontology declares, and names nothing it doesn't** (#2264).
`ontology-thought.ttl` was the best-commented artifact in the repository and the
least discoverable — 92 classes and 104 properties, every one carrying an
`rdfs:comment`, with not one inbound prose reference. Bidirectional, and the
sibling division is deliberate: `ontology-terms.test.ts` scans `src/` and asks
whether the code names an undeclared term; this scans one doc and asks both
directions, because a confident document describing an ontology that has moved
on is the other failure mode. Direction 2 checks presence, not accuracy — the
alternative would duplicate the Turtle byte for byte or be unfalsifiable.
**When it fires:** add a class to the overview, or fix the CURIE you invented in
prose. It covers `ontology-thought.ttl` only; `ontology.ttl` has no prose
overview yet.

### `mcp-servers-doc.test.ts`

**The MCP Servers settings page names every transport and every connection
status the code actually has** (#2259). The page documents Minerva as an MCP
*client* — consuming third-party servers — and two of the things it tells a
reader are facts the code already owns: the configurable transports
(`shared/mcp-servers.ts`) and the connection states a row can show
(`McpServersSettings.svelte`). A new transport or a sixth status would ship
with the page still listing the old set, and nothing would say so; the page
would simply be wrong, confidently, in the one place a confused reader goes.
Further assertions keep it *reachable* (named on the settings page, listed in
`_nav.json`) and keep the cross-link to `connecting-mcp.html`, which is the
confusion it exists to fix — before #2259 the only page mentioning MCP
described the opposite direction, Minerva as a *server*. **When it fires:** add
the transport or status to the page. Presence and spelling, not accuracy — a
status whose description is wrong still passes, because naming every state is
the part that drifts.

### `ontology-terms.test.ts`

**Every `thought:X` / `minerva:X` named anywhere in `src/` is declared in
`ontology.ttl` or `ontology-thought.ttl`** (#2230) — prose, skill bodies and
`THOUGHT('x')` call sites included. Both files are parsed, which matters beyond
tidiness: `describe_graph_schema` hands them to the LLM verbatim and tells it
the contents are authoritative before it writes SPARQL, and nothing checked that
claim until this test — `ontology.ttl` had been shipping *unparseable* (a stray
`;x`) for an unknown length of time, with ~17 load-bearing predicates
undeclared. **When it fires:** add the term to the ontology in the same PR.

It also fails when one term is **declared twice with contradictory meanings**
(#2345) — two different `rdfs:range`s, domains, labels or comments for a single
IRI. `thought:archivedAt` was a source's archival-copy PATH (`xsd:string`) in
one declaration and a conversation's archival TIMESTAMP (`xsd:dateTime`) in
another, both live, both written by real code. That is worse than an undeclared
term: the schema handed to the LLM as authoritative asserts two incompatible
things, so a `FILTER(?archivedAt > "…"^^xsd:dateTime)` silently drops or admits
rows depending on which side wrote them. **When that half fires:** one of the
two meanings needs its own predicate — renaming the side with fewer writers is
usually right.

What it does **not** check: the reverse direction (a declared term nothing uses
is normal for vocabulary authored by hand), or whether a term's
`rdfs:domain`/`rdfs:range` match how the code *uses* it — only that the ontology
does not contradict itself.

---

## Size, coverage and anti-pattern budgets

### `file-size-budgets.test.ts`

**A committed `path → line count` map for every `src/` file over 600 lines,
failing when a listed file grows** (#1854). Deliberately not a "no file over N
lines" rule — the point is the derivative. A 1,178-line file that stays 1,178
lines is not today's problem; one that reaches 1,300 is. Shrinking also fails,
asking you to lower the number (or drop the entry once under 600) so reclaimed
space doesn't quietly become headroom. **When it fires** you have exactly two
moves, and picking between them is the whole value of the check: extract a seam
if what you added doesn't belong in that file, or raise the number in the same
PR and say so in the diff. Some files grow by construction — the four IPC-surface
files gain a line per channel — and raising those is routine.

### `pattern-ratchets.test.ts`

**Per-file counts of six known-bad shapes, which may go down and may not go
up** (#1848): `catch { return [] | null | … }` swallows, `.catch(() => …)`
swallows, `withRootPathOr(null, …)`, `withRootPathOr(false, …)` boolean
overloads, `withRootPathOr(undefined, …)`, and in-band `error?` on an otherwise
normal payload. Written because prose doesn't fail a build and it showed:
CLAUDE.md's migration backlog moved by one item in three weeks while brand-new
code introduced two fresh instances of the very shapes it names. Nothing here
claims every listed site is wrong — several are deliberate. Lexical scanning, so
it *undercounts* (a `console.warn` before the empty return isn't matched, nor a
swallow written across an intermediate variable); the blind spots are listed in
the file's own header rather than discovered later. **When it fires:** write the
code the way CLAUDE.md's *IPC error handling* section describes — throw, or
return a discriminated union — rather than raising the budget.

### `coverage-floor-enrollment.test.ts`

**Every directory directly under `src/main/` is matched by some threshold key in
`vitest.config.mts`** (#2239). CLAUDE.md's LLM/Graph review checklist asks
whether a new module is covered by a threshold; that was a good question with no
way to answer it, and the answer was *no* for fifteen subsystems — including a
2,977-line hand-rolled MCP protocol implementation with a full OAuth 2.1 flow —
all sitting under the 45%-lines global backstop, which is a net against
wholesale collapse and not a per-area gate. A low bar on purpose, and the header
is precise about what it does *not* check: calibration (a floor of `lines: 1`
passes), nested subtrees, and loose `src/main/*.ts` modules. **When it fires:**
add an entry, measured — 3-5 points below the real number for a larger tree,
8-10 for a single-file one where one new file swings the aggregate.

---

## Test-suite hygiene

### `test-isolation.test.ts`

**`isolate: false` stays off** (#2248). Vitest prints "at least ~14.01s faster
with isolate: false" at the end of every local run; it is an inviting suggestion
and it is wrong for this suite, which is genuinely filesystem- and
process-stateful (chokidar watchers, DuckDB handles, Python kernels, a real temp
project per test, module-level `createProjectStore` singletons living for a
worker's lifetime). Dropping isolation leaks all of that between files and
produces order-dependent failures nobody can attribute — the worst flake to
inherit for ~14 seconds of a ~9-minute run. Not a claim the settings are optimal
forever: a claim that turning isolation off is a decision, not a speed-up.
**When it fires:** you changed the setting. Bring the analysis, and update this
test in the same PR — that is what it's for.

### `waitfor-must-be-awaited.test.ts`

**Coverage for the `waitFor(...)`-must-be-awaited eslint rule** (#1947). An
unawaited `waitFor(() => expect(...))` lets the test function return — and be
marked passed — before the assertion ever observes the state it waits for.
`expect.assertions(n)` was tried and rejected: `waitFor` invokes its callback
once per retry tick, so an exact count is flaky by construction (measured: 7
ticks for a condition resolving after 30ms on a 5ms interval), and
`expect.hasAssertions()` misses the bug entirely because the first synchronous
check ticks the counter even when the call is never awaited. The fix is a
`no-restricted-syntax` rule; this test **extracts that real rule config** out of
`eslint.config.mjs` and runs it against fixtures, so a future edit weakening the
selector fails here rather than silently reopening the hole. **When it fires:**
either you weakened the rule, or the config's shape changed and the extractor
can't find the `tests/**/*.ts` block.

### `graph-tests-use-temp-project-fixture.test.ts`

**No file in `tests/main/graph/` hand-rolls `mkdtempSync`** (#1902) instead of
`useGraphProject()` / `makeGraphProject()` / `useTempDir()` from
`tests/helpers/temp-project.ts`. 51 of 56 files carried the same
`mkdtempSync → projectContext → initGraph → afterEach rm` boilerplate; that got
fixed in one pass, and this is what stops it drifting back one file at a time.
Six benchmarks and `tutorial-thoughtbase-staleness.test.ts` are exempt with
stated reasons — the fixture's per-test lifecycle genuinely doesn't fit them.
The list may only shrink. **When it fires:** convert the new test to the
fixture. Adding an entry is not the intended way to change this file.

### `llm-tests-use-temp-project-fixture.test.ts`

**The same, for `tests/main/llm/`** (#1996) — the largest directory still
hand-rolling the pattern when #1902 landed. `EXEMPT` is empty today: every file
that needed a temp dir fit one of the three fixture shapes. **When it fires:**
same answer as the sibling. If a file genuinely can't fit (mirroring the
bench/`beforeAll` exceptions documented there), add it with a one-line reason.

### `e2e-launch-hygiene.test.ts`

**Every e2e spec boots Minerva through `tests/e2e/helpers/launch.ts`** (#1928).
`smoke.spec.ts` called `electron.launch` with no `--user-data-dir`, so it ran
against the developer's real Electron profile — writing `Preferences` and
`Session Storage` on the way out, and turning its own "a fresh launch yields the
Open Thoughtbase shell" premise into a race against session restore that it
happened to win. Eight sibling launch sites got it right; the ninth was
invisible, green in CI (empty profile) and green locally (the assertion lands
before restore completes). *A convention that eight of nine call sites follow is
not a convention, it's a coincidence.* `launchMinerva` makes `userDataDir`
required so omitting it is a type error; this closes the other route, where a
new spec reaches for `electron.launch` and never learns the helper exists.
**When it fires:** use the helper.

### `embedding-model-gate.test.ts`

**Under CI, the embedding model files the fetch script promises are actually on
disk and hash-correct** (#1925). Four test files gate on
`haveModel = fs.existsSync(...)` and skip when the `.onnx` weights are missing —
right for an offline dev checkout, but skip is silent, and nothing distinguished
"chose not to run this" from "should have run this and something broke". Seven
tests were silently skipping in CI because `fetch:model` was wired to
`predev`/`prebuild` only; it is now `pretest`/`precoverage` too, and this is the
backstop against that regressing. (The header also records that the original
review's count of 12 was wrong and the true number is 7 — `wordpiece.test.ts`
gates on a committed `tokenizer.json`, so it was never actually skipping.) Off
CI it only checks the four gate sites still exist and still gate on
`haveModel`. **When it fires in CI:** the `pretest` hook stopped firing or the
fetch script started failing soft.

---

## Startup and runtime cost

### `startup-window-not-gated.test.ts`

**No `await` runs before `createWindow()` in `main.ts`** (#2223).
`registerSkillsAtStartup()` used to sit there — ~50ms of stock-skill parsing in
front of the one step that produces something for the user to look at, behind a
comment ("before any menu is built") that was true of the *menu*, which is built
after. Structural rather than a boot-timing assertion on purpose: "how many ms
did startup take" on a loaded dev box measures the box, while "no `await` before
`createWindow`" is a property of the file that holds identically on every
machine — and it catches the general case, so the next subsystem that wants to
load something at startup gets stopped whether or not it is skills. The other
half of the original comment is asserted too: skills must still be registered
before `buildMenu`, or the Learning / Research / Analysis menus come up empty.
**When it fires:** move the work after `createWindow`, or behind a lazy load.

### `lazy-boot-modules.test.ts`

**The expensive modules stay off the boot path** (#2335) — `@duckdb/node-api`,
`@comunica/query-sparql-rdfjs`, and the three vendor LLM SDKs. `main.ts` pulls
its whole dependency graph at module scope, and the heaviest single edge was a
native binding reached for a `before-quit` handler: `libduckdb.dylib` is 107MB
packaged and a cold import measures 2,896ms, ahead of `@comunica` at 732ms and
`openai`/`@google/genai`/`@anthropic-ai/sdk` at 242/164/132ms. Warm they are a
few milliseconds each, so this is a first-launch and post-reboot cost — the
launch a new user judges the app on — paid by every user regardless of what they
did next.

Two shapes, checked differently. **A dedicated loader:** DuckDB and Comunica are
reached through `await import(pkg)` in exactly one module, so the check is "no
other module has a value import" *plus* "that module's own import really is
dynamic" — otherwise exempting the loader by path would be a hole. **A lazily
reached module:** each LLM provider imports its SDK statically, which is fine
only because nothing statically imports the provider — `llm/provider/index.ts`
uses `await import('./openai')` — so the assertion is on the edge *into* the
provider, not out of it. Checking "only `openai.ts` imports openai" would pass
while `provider/index.ts` dragged all three into the entry chunk.

A source-level check because the property that matters is about the built bundle
and building takes minutes; what *can* be checked cheaply is the cause. Vite
follows static value imports into the entry chunk, `import type` is erased
before the bundler sees it, and `await import()` becomes a separate chunk. **A
ratchet on the cause, not an assertion about the artifact** — the header says so
rather than implying it proves more. It strips comments before scanning, because
`duckdb-lazy.ts`'s own header draws the dependency chain it exists to break and
the first version read that prose as a real import (#2248 hit the same shape).
**When it fires:** make it `import type`, or route it through the loader.

---

## Release, CI and workflows

### `node-version.test.ts`

**`.nvmrc` names an even (LTS) major, at or above the `engines` floor, and every
workflow resolves its runtime from it** (#2252). Node ships LTS on even majors
only; odd ones are *Current*, never promoted, EOL about six months after
release. Not a detail: #2252 proposed bumping `.nvmrc` to 25 to close a
local/CI skew, and Node 25 reached end-of-life on 2026-06-01 — the bump would
have put every build and release on a dead runtime. Also pins that the pre-push
hook's skew check *warns* rather than blocks: a hook that blocks a push over an
advisory is a hook people disable, and the lint gate goes with it. **When it
fires:** pick the next even LTS line (26, from 2026-10-28), and update
`engines` and the workflows together.

### `lockfile-gate.test.ts`

**Every conditionally-installing CI job verifies the lockfile first, with no
`if:`, and the four `node_modules` cache keys stay byte-identical** (#2244,
#2247). `pnpm install --frozen-lockfile` is the only thing asserting
`pnpm-lock.yaml` still matches `package.json`, and it sat behind
`if: cache-hit != 'true'` while the cache key hashed the lockfile but not the
manifest — so editing a version range without regenerating the lockfile left the
key unchanged, skipped the install, and reported green against dependencies that
don't match. Fixed with a `--lockfile-only` verify step (~0.4s), *not* by adding
`package.json` to the cache key, which busts `node_modules` on every version
bump and still only checks on the miss path. The second half fails nothing when
it breaks — the workflows just quietly stop sharing a warm cache, invisible
until someone reads the timings. **When it fires:** you gave an installing job a
cache; it now owes a verify step.

### `workflow-permissions.test.ts`

**Every workflow declares `permissions:`, the workflow scope is
`contents: read`, and any write is granted on the job that writes** (#2251).
`ci.yml` and `bench.yml` used to declare nothing, so their token scope came from
a repository settings page — which says least-privilege today (checked, not
assumed) but is not somewhere an invariant can live. `release.yml` declared
`contents: write` at workflow scope: equivalent with one job, silently wrong at
two, since a notarization reporter or a Linux/Windows builder would inherit
repository write for no reason. Also rejects the `permissions: write-all`
shorthand — one innocuous-looking word that grants every scope there is. **When
it fires:** put the write on the job.

### `actions-sha-pinned.test.ts`

**Every `uses:` across all three workflows is a 40-character commit SHA with a
version comment, and one action resolves to one SHA everywhere** (#2250).
`actions/checkout@v7` is a *mutable* reference — the tag can be moved, reverted
or repointed upstream and the next run executes different code with no diff here
to show it. The trailing `# v7.0.1` comment is load-bearing, not decoration:
without it a diff is forty hex characters and nobody can tell a version from a
reverted one by eye, and it is the form `.github/dependabot.yml` reads and
rewrites. Uniform across all three workflows rather than only the one holding
Apple signing material, because partial pinning makes a reader work out whether
an unpinned `uses:` was an exemption or an oversight. **When it fires:** resolve
the SHA with `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha`
(one more hop through `git/tags/<sha>` for an annotated tag), and update all
three workflows together — five of the eight actions appear in all three, so a
partial upgrade is the realistic drift.

### `release-tag-gate.test.ts`

**The release tag is `v` + `package.json`'s version, exactly, prerelease suffix
included** (#2245) — and `release.yml` asserts it **before** the build. Two
systems read the two values: `release.yml` builds from the *tag* and derives the
GitHub pre-release flag from it, while `update.electronjs.org` compares the
running app's *`version`*. When they disagree nothing looks wrong — the build is
signed, notarized, stapled, verified, smoke-booted, drafted and published, and
the updater never offers it to anyone. Green at every checkpoint, delivered to
nobody. The local check in `tag-release.mjs` was not enough: `git tag -a v2.0.3
&& git push` never runs it, and the workflow's `tags: ['v*']` trigger doesn't
care how a tag was made. This test pins both that the gate runs before the build
(a signed notarized build of the wrong version costs ~15 minutes and must not be
published) and that the tag arrives through `env:` rather than interpolated into
`run:`. **When it fires:** the tag and the manifest disagree, or someone moved
the gate.

### `out-of-band-checks-notify.test.ts`

Three checks under one filename, all about a signal nobody would otherwise
hear. **A workflow with an `on.schedule` trigger has a step that runs on
`failure()`** (#2242); **neither audit step is `continue-on-error`, and the
full-tree one runs `scripts/check-audit.mjs` rather than a bare `pnpm audit`**
(#2249 — `audit:all` used to be `continue-on-error: true` beside a comment
planning to remove it "once the full tree is clean", which nothing could ever
report, because the step was green whether the tree improved or regressed);
and **`build-help-corpus.mjs` still keys on content hashes**, with `ci.yml`'s
cache key covering the same inputs (#2246). The
scheduled-workflow half exists because `bench.yml`'s regression gate exited
non-zero on **seven consecutive scheduled runs** while a real 3-3.8× save-path
regression shipped; GitHub's only built-in signal is an email to the workflow
file's last committer. CI detected the regression seven weeks before a human
did — the defect was in the notification path, not the gate. Deliberately not
extended to `on.push`/`on.pull_request`, which fail visibly by construction;
that asymmetry is the whole point. The corpus half guards a different silence:
an mtime-based skip check reports a cache hit and rebuilds anyway (`checkout`
stamps every source file with the checkout time), so the corpus stays correct
and the cache just quietly stops paying. **When it fires:** add the
`if: failure()` notify step — one issue updated weekly, not one per run — or
re-sync the cache key with the hashed input set.

---

## Configuration, IPC and logging

### `config-loader-usage.test.ts`

**No new hand-rolled disk-read + `JSON.parse` config reader** (#1913). JSON
config loads through `loadConfigFile` / `loadConfigFileSync`
(`src/main/config/config-store.ts`), which gives one consistent behavior:
missing file → defaults silently; corrupt or unreadable file → surfaced via
`reportConfigError` rather than swallowed, then defaults; per-field coercion
through the shared `as*` decoders. The ratchet exists because
`config-roots-doc.test.ts` only checks *where* a config lives, not *how* it's
read, so six hand-rolled readers stayed invisible. `readRawProjectConfig` is a
deliberate exception: it must **throw** on a corrupt file so a patch is never
merged onto a silently-emptied one, which is incompatible with
`loadConfigFile`'s never-throw contract. **When it fires:** migrate to the
helper, or state the exception the way that one does.

### `ipc-registrar-coverage.test.ts`

**A new `src/main/ipc/register-*.ts` ships with a main-process test** (#1854),
making CLAUDE.md's LLM/Graph review-checklist item executable rather than
rhetorical. Pre-existing untested registrars sit in `KNOWN_UNTESTED`, which may
only shrink. This is the class of gap that let the `CONVERSATION_SEND` hole in
(#1612). **When it fires:** write `tests/main/ipc/register-<domain>.test.ts`.
Note the neighbouring obligations a channel addition also carries — the
`ChannelMap` entry, and the two snapshots (`preload-bridge`, `registration`) —
which are spelled out in CLAUDE.md under *IPC Pattern* (#2258).
