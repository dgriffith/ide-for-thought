# Documentation Review Plan
Generated: 2026-09-20T19:32:50Z
Scope: entire project

## Executive Summary

Minerva's documentation is **substantially better than the codebase's age and velocity predict**, and the three sibling reviews' verdict — that the engineering discipline here exceeds expectations — holds for docs too. The evidence is not impressionistic:

- **63 of the last 715 commits (8.8%) are `docs:`-prefixed** — roughly one in eleven. `CLAUDE.md` was touched 21 times in 90 days, `website/docs/` 42 times, `docs/` 45 times. Documentation is not an afterthought that gets written once and abandoned.
- **The user-facing docs site is structurally airtight.** 118 `_content/` fragments ↔ 118 generated pages, **zero orphans in either direction** (verified by set-diffing the filename lists), 119 nav hrefs with the single extra being a deliberate external link (`scripts/lib/docs-model.mjs:55`). 82 real screenshots referenced by 81 of 118 fragments; only two `.shot` placeholder captions survive. `pnpm check:docs` gates it in CI (`.github/workflows/ci.yml:72`).
- **`docs/development.md` is the best document in the repository** and would serve a new contributor well. It is honest in a way most contributor guides are not — it states outright that "66 of 125 Svelte components are at 0% code coverage" (`:185-187`), explains *why* `CONTRIBUTING.md` was deliberately retired (`:8-11`, #1558 — GitHub turns that filename into a banner on the new-issue page), documents the Playwright-is-macOS-only boundary **with its rationale and where the line would move** (`:198-204`), and carries a scope-and-non-negotiables section that will save contributors real wasted effort (`:135-163`).
- **The inline-comment strategy is real and quantified.** Comment density across the infrastructure files: `pnpm-workspace.yaml` 59%, `vitest.config.mts` 53%, `ci.yml` 44%, `eslint.config.mjs` 42%, `release.yml` 40%, `forge.config.ts` 33%, `bench.yml` 32%, `.gitignore` 32%. That is ~834 comment lines across ~1,911 lines of config — and they record *rejected alternatives*, not restatements. `pnpm-workspace.yaml:20-33` is the best example in the repository: it pins `plist>@xmldom/xmldom`, then records the failed simplification verbatim with the error string and the throwing file ("deliberately not widened to a global key — tried that first and it broke `pnpm build`… `DOMParser.parseFromString: the provided mimeType "undefined" is not valid.`, thrown from `plist/lib/parse.js`"). `forge.config.ts:9-24` records a bug-by-bug discovery path and why the closure approach replaced chasing them one at a time.
- **One documentation surface is genuinely un-driftable and is the model for the rest**: Help → Keyboard Shortcuts (⌘/) is *derived from the live menu template* (`src/main/menu.ts:1013-1027`), so it cannot disagree with the app.
- **The `reports/` corpus is demonstrably being consumed, not accumulating unread.** I sampled twelve concrete recommendations from three June 2026 reports and **all twelve are implemented** — `ipc.ts` 2,717 → **79** lines; `App.svelte` 3,764 → **2,096**; `graph/index.ts` 2,717 → **223**; the `compute/save-cell-output.ts` layer violation gone; eight `no-restricted-imports` blocks now in `eslint.config.mjs`; the release pipeline, signing/notarization, and auto-update all shipped — and `release.yml:9-11` *cites the report by finding id* ("This closes the two gaps from build review B-H1"). These reviews appear to be the actual driver of the last four months of work.

Against that, the findings cluster into one structural theme and one blunt reach problem.

**The reach problem is the single highest-value item in this report.** The app ships a 118-page, 61,245-word user manual. **The app cannot reach it.** `src/main/menu.ts:1002` defines `DOCS_URL = 'https://github.com/dgriffith/ide-for-thought/tree/main/docs'` — Help → Documentation opens the *repository's developer docs folder* on GitHub, dropping the user into a raw file listing of `releasing.md`, `packaging.md`, `config-roots.md`, `prd/`, `vision/`, and a dead `docs/website/` duplicate. The user site deploys to a different repo entirely (`scripts/deploy-to-gh-pages.sh:7` → `dgriffith/minerva`), and **its canonical public URL is not written down anywhere in the repository** — which is almost certainly *why* the menu points at the repo folder. `README.md`, meanwhile, has **no download link, no install section, and no link to the docs site** (verified: `grep -i "download\|dmg\|releases"` over all 214 lines yields three hits, all developer-facing). For a "professional tool" per CLAUDE.md's own UX bar, the front door and the help menu both fail to find the manual that was actually written.

**The structural theme is that prose describing behavior has no coupling to the behavior, and this repo's own history proves it loses.** The sharpest instance is datable to the minute. On 2026-08-02 at **15:28**, commit `2f20c21b` — a PR literally titled *"docs: fix dev-doc lint-description drift"* (#1646) — wrote into `CLAUDE.md:10` that `pnpm lint` runs "`tsc --noEmit`, **then** `svelte-check`, **then** `eslint .`". At **16:17** the same day, `d39277fc` (#1645) made those three checks run **in parallel** (`scripts/lint.mjs:53` — `await Promise.all(CHECKS.map(run))`; the file's own header comment at `:1-4` says so explicitly). The drift-fixing PR was stale **49 minutes after it merged**, and has stayed stale for seven weeks — in *two* documents, because `docs/development.md:59` repeats it. The sequential form still exists as an undocumented separate script, `lint:seq` (`package.json:28`).

That same shape recurs wherever a doc restates a list the code owns authoritatively:

| Doc claim | Reality | Citation |
|---|---|---|
| Standard SPARQL prefixes: 8 named | **15** injected — `owl`, `bibo`, `schema`, `types`, `dcat`, `skos`, `foaf` undocumented | `CLAUDE.md:368` vs `src/main/graph/state.ts:169-185` |
| `showPrompt`/`showConfirm` live "in App.svelte" | They live in a store; `App.svelte:401` only destructures them | `CLAUDE.md:179,189` + `docs/development.md:110` vs `src/renderer/lib/stores/dialogs.svelte.ts:96,122` |
| "11 semantic link types" | 12 entries (10 note-targeted) in a file whose header says *"everything else derives from this list"* | `README.md:38` vs `src/shared/link-types.ts:1-6,23-105` |
| "Nearly 50 skills" | 56 | `README.md:73` vs `ls src/main/skills/stock/*.md` |
| "the stock Analysis menu has 20" | 29 | `docs/authoring-skills.md:355` |
| "twelve" / "Thirteen" / "thirteen" / 14 deflist rows / 15 cards | **16** settings tabs | `website/docs/_content/settings.html:3,7,9,73-143` vs `SettingsDialog.svelte:72-102` |
| `Cmd+Shift+C — Commit All` | **No such accelerator exists** — zero hits for "Commit" in `menu.ts` | `README.md:199` |
| `eslint.config.js` | Only `eslint.config.mjs` exists (and `CLAUDE.md:160,319` say `.mjs`) | `CLAUDE.md:65` |

**The good news is that this project already knows the fix and has shipped it twice.** `tests/architecture/config-roots-doc.test.ts` makes a doc table fail CI when the code adds a path it omits, and Help → Keyboard Shortcuts *derives* its content rather than restating it. Every row in the table above is a candidate for one of those two treatments. Nothing in this report asks for a new documentation culture — it asks for the existing one to be pointed at six or seven more places.

Finally, two corrections to context this review inherited, both verified:

1. **Epic #1194 is not where the tracker thinks it is.** All five families listed as "NOT started" — Viewing options (6 pages/2,235 words), Editor (7/2,770), Conversations (5/2,856), Thinking tools (8/3,017), Settings (16/7,028) — are **shipped at full density**, comparable to the already-merged Notes (19/8,672) and Navigation (7/2,659). Left and Right sidebar are merged too (7 and 13 pages). The un-started-pages gap is **not** the highest-value user-doc gap; the unreachable-docs-site defect is.
2. **The architecture review's P11 is half right.** Its claim that `CLAUDE.md` wrongly cites `readJsonFileOr` as living in `ipc/helpers.ts` is **incorrect** — `src/main/ipc/helpers.ts:60` re-exports it, and real callers import it from there (`src/main/ipc/register-bookmarks.ts:4`). CLAUDE.md is right. Its `GIT_COMMIT.success` claim **is** correct: `pattern-ratchets.test.ts` has six scanners (`:125,199,247,268,297,324`) and none covers the "vestigial" category CLAUDE.md lists as ratcheted.

---

## Current Documentation Coverage

### Existing Documentation

#### `docs/development.md` — **Excellent.** 226 lines, last touched 2026-09-11.

The strongest document here, and the one a new contributor should be sent to. It correctly routes bug-reporters away in its first paragraph (`:3-5`), documents prerequisites that check out exactly (`:40-41` "Node 24+ … pnpm 12" vs `.nvmrc` = `24`, `package.json:7-9` `engines.node ">=24"`, `packageManager: "pnpm@12.3.4"`), covers the pre-push hook with both escape hatches, warns about the `svelte-check`-not-`tsc` gotcha (`:72-75`), tells you the preload snapshot must be regenerated (`:191-194`), and states its non-negotiables plainly enough to decline a PR against (`:141-163`).

Defects, all verified:
- `:59` — the sequential-lint error described above.
- `:67-68` — "the pre-push hook runs the lint gate." It runs **two**: `.githooks/pre-push:17-21` runs `pnpm lint:fonts` *first* and aborts before reaching `pnpm lint`. A contributor who trips it gets an error message pointing at `reports/design-review-2.md §2` (`.githooks/pre-push:18`) — a review artifact, not a doc.
- `:50-52` — `predev` is described as two steps. `scripts/prep.mjs:13-16` runs **three**, and the omitted one is `build-docs.mjs`.
- `:185` — "125 Svelte components"; there are 130 under `lib/components/`, 131 under `src/renderer/`.
- `:189-190` — the test-directory list names four of twelve (`architecture/`, `cli/`, `clipper/`, `shared/`, `scripts/`, `skills-eval/`, `fixtures/`, `helpers/` omitted).
- `:15` — "`CLAUDE.md` is the fullest map of how the pieces fit together." CLAUDE.md's Architecture section is **10 lines**. See the CLAUDE.md assessment below.
- **`src/cli/` is never mentioned** (`grep -n "src/cli" docs/development.md` → zero hits). It is 1,792 lines across 10 files including an MCP server, and it has its own doc (`docs/cli.md`) that the contributor guide never points at.

#### `CLAUDE.md` — **Very good content, structurally overloaded, and its exhaustive lists are drifting.** 498 lines / 4,248 words.

Growth is the headline: **66 → 152 → 237 → 357 → 498 lines** across 32 commits, i.e. ~40% growth in the last month alone. Section census:

| Block | Lines | Share |
|---|---|---|
| Conventions (Svelte 5 → Tools for Thought) | 336 | 67% |
| — of which: Renderer data flow + 3 subsections | 141 | 28% |
| — of which: IPC error handling | 65 | 13% |
| LLM Integration Principles | 85 | 17% |
| **Architecture** | **10** | **2%** |
| Commands / What This Is | 16 | 3% |

It is a conventions handbook titled "Development Guide," and `development.md:15` sends architecture-seekers to it. There is no overall architecture document anywhere: `docs/architecture/` holds two scoped ADRs (327 lines total) and neither describes the layer structure. Both CLAUDE.md and development.md describe **three** processes; the real shape is five layers including `src/shared/` (15.0k LOC) and `src/cli/` (1.8k), neither of which is in either architecture section.

Accuracy — verified item by item against code. **What is correct** (and this is the larger share): `IGNORED_DIRS` matches exactly (`src/main/notebase/ignored-dirs.ts:27`); `assertSafePath` exists at `src/main/notebase/fs.ts:99`; all **six** IPC backlog items are still genuinely present, not stale (`register-proposals.ts:24,28`; `graph/queries/sparql.ts:92`; `register-links.ts:118`; `register-bibliography.ts:117,122`; `register-conversation-drafts.ts:557-567`; `register-git.ts:15`); all **11** "migrated" configs really use `loadConfigFile`; all **3** "still hand-rolled" really are; the entire Skills section is accurate end-to-end; `src/main/ipc.ts` really is 25 registrar calls plus three event bridges; "30+ component types" is right (39 `rdfs:subClassOf thought:Component` in the TTL); PROV-O alignment is real (`ontology-thought.ttl:23,751,902`).

**What is wrong or incomplete** — nine items, detailed in the Gaps section below.

#### `website/docs/` (the user manual) — **Excellent infrastructure, good prose, one hard reach failure and several content gaps.** 118 pages / 61,245 words.

The generator (`scripts/build-docs.mjs` → `scripts/lib/docs-model.mjs`) throws on nav↔fragment mismatch in both directions (`docs-model.mjs:227-231`), and `--check` diffs regenerated output against what's committed (`build-docs.mjs:31-39`), gated in CI. The invariant is asserted a second time in the suite (`tests/scripts/docs-generated.test.ts:29-47`). Output is committed because gh-pages deploys the repo as-is with no build step (`deploy-to-gh-pages.sh:38-39`) — a decision the generator's own header records.

Be precise about what that gate *is*: **a hand-edit detector.** It verifies byte-identity of generation and flags orphaned pages. It verifies nothing about prose accuracy, feature coverage, internal link resolution, or referenced images.

#### `resources/tutorial-thoughtbase/` — **Genuinely functional onboarding, and the best user-facing asset here.**

17 markdown notes (~3,657 words) plus `data/lessons.csv` and a pre-built `.minerva/` carrying a real source (`sources/federalist-10/`) and an anchored excerpt. `Start Here.md` is a numbered 12-lesson map of wiki-links tagged `[tutorial, entrypoint]`. Three verified entry points: the empty-state welcome screen (`App.svelte:1493-1501`, "Take the Tutorial" beside New/Open), Help → Install Tutorial Thoughtbase… (`menu.ts:951-956`), and the handler that offers a new window if a thoughtbase is already open (`project-ops.ts:251-269` → `register-notebase.ts:87-96`). It copies with collision-suffixing, never clobbers, and lands on the entrypoint note. This teaches Minerva by being Minerva — exactly right, and discoverable without reading anything first.

#### In-app help — **One excellent surface, one broken one, one un-driftable one.**

- `search_help` (`src/main/llm/tools/search-help.ts:22-40`, registered at `llm/tools/registry.ts:12,47`) grounds the AI's "how do I…" answers in the real docs and prefixes a `WEAK MATCH` warning rather than bluffing. This is the payoff of treating docs as executable context, and it works.
- Help → Keyboard Shortcuts (⌘/) derives from the live menu template (`menu.ts:1013-1027` → `ShortcutsDialog.svelte:21`), so it *cannot* drift. The model to copy.
- Help → Documentation is broken (see Gap 1).

#### `docs/authoring-skills.md` — **Very good, mildly stale.** 390 lines, last touched 2026-09-19 (freshest).

Template syntax is an **exact** match: `FILTERS` at `template.ts:71-81` is `blockquote/trim/upper/lower/stem` and all five are documented at `:128-133` with none extra; the "no loops, no arbitrary expressions" claim (`:105-106`) is correct against the token set at `template.ts:85-90`; nesting and `!` negation check out. All 12 documented frontmatter fields map to real `parse.ts` reads — **nothing documented is unparsed**. Gaps: `requiresNote` is parsed as a deliberate tri-state (`parse.ts:157-160`) and *not* in the frontmatter table, which is precisely the field whose subtlety an author needs told; `parameters[].placeholder` (`parse.ts:64-65`) undocumented; model examples at `:91` steer authors to `claude-opus-4-8`/`claude-sonnet-4-6` when `DEFAULT_MODEL` is `claude-opus-5` (`models.ts:19`) and stock skills have moved on (`stock/antithesize.md:9`).

#### `docs/config-roots.md` + its test — **The exemplar, correctly framed only if you read the test's own header.**

`tests/architecture/config-roots-doc.test.ts:108-123` requires every `path.join(app.getPath('userData'), '<name>')` literal in `src/main/**` to appear in backticks in the doc. Two things make it unusually good: an anti-vacuity floor (`:88-97` asserts >10 sites found and two known anchors present, so a silently-broken regex fails instead of passing) and a `KNOWN_MENTION_ONLY` registry (`:125-146`) catching call sites written in a shape the regex can't parse — the part most doc-parity tests lack.

Honest coverage: **12 of ~27 inventory rows, checked for filename existence only.** Root 2 (`~/.minerva/`, 3 rows) and Root 3 (`<thoughtbase>/.minerva/`, 12 rows) are unchecked, as is every row's *description* (`:27-28`: "a row whose description is wrong still passes") and the "Secrets, at a glance" list (`:63-73`) — the highest-stakes content, entirely on the honor system. The test says all this in its own header (`:19-32`), which is more self-awareness than CLAUDE.md's framing conveys.

#### Other `docs/` — mixed, with three stale status headers

| Path | Last commit | Judgement |
|---|---|---|
| `docs/packaging.md` | 2026-08-03 | Current — commands match `package.json:22-23` |
| `docs/publishing.md` | 2026-08-09 | Current — matches `src/main/publish/exporters/static-site/` |
| `docs/releasing.md` | 2026-09-04 | Current, and thorough — documents the no-CHANGELOG decision explicitly (`:256-260`) |
| `docs/flashcards.md` | 2026-06-26 | Current (verified against `card-callout.ts`, `anki/apkg.ts`) |
| `docs/visualizations.md` | 2026-06-26 | Current (verified against `vega-renderer.ts`) |
| `docs/cli.md` | **2026-07-11** | **Stale** — see Gap 6 |
| `docs/architecture/rdf-and-dom-libraries.md` | 2026-07-05 | Current, "Accepted" |
| `docs/architecture/compute-sandbox.md` | 2026-07-23 | **Status line lies**: `:3` says "Status: Proposed (2026-07)"; `src/main/compute/sandbox.ts:1-2` says Phase 1 shipped (#1329, #1421) |
| `docs/prd/long-running-conversations.md` | 2026-05-04 | **Historical, mislabeled** — `:3` "Status: draft"; describes `ConversationDialog`/`DecomposeDialog`/`CrystallizeDialog`, **none of which exist** (they became skills) |
| `docs/vision/*` (11 files) | 2026-04-21 → 2026-09-09 | Aspirational and judged as such, but `compute.md`/`sql.md`/`publication.md` (all 2026-04-21) describe shipped features in aspirational present tense with no status header |
| `docs/design/2026-05-design-review/` | 2026-05-25 | Dated-by-name artifact: a React/JSX mock (13 `.jsx` + 7 PNGs) inside a Svelte repo |
| `docs/website/` | 2026-08-03 | **Dead duplicate** — see Gap 7 |

There is no `docs/README.md` explaining this taxonomy — reference docs, vision docs, a PRD, two ADRs, a design artifact, and a dead site copy all sit flat in one directory.

#### API / interface documentation — **Excellent headers, ~42–52% per-item coverage allocated by recency rather than by rule**

The *headers* are consistently first-rate. `src/shared/channels.ts:1-16` documents the naming convention, the namespace invariant, and names the test that enforces it. `src/shared/ipc-contract.ts:1-28` is a 27-line argument for structural enforcement. `src/preload/preload.ts:22-28` explains that the file is a mechanical `ChannelMap`-derived transcript, "correct by construction" — which is why its 5% comment density is *correct*, and `vitest.config.mts:359-364` separately explains why it gets no coverage floor either.

Per-item coverage is uneven in a revealing way:

| Surface | Documented |
|---|---|
| `channels.ts` — 361 constants, 37 section headers | **187 (52%)** |
| — Formatter menu section | 55/67 |
| — Local per-note history | 28/36 |
| — **Project / file menu actions** (`channels.ts:189`) | **1/23** |
| — **Editor split** (`:221`) / **Refactor menu** (`:241`) | **0/18**, **0/10** |
| — **Graph** (`:139`, `:459`), **Bookmarks** (`:609`), **Search** (`:132`) | 0 each |
| `client.ts` — 374 method signatures | **158 (42%)** |
| `ipc-contract.ts` — 291 channel entries | **8 (3%)** |

The sharper finding is that **CLAUDE.md's IPC rules 3 and 5 are themselves doc obligations, and only one of them is being met**:

- **Rule 5** (`null` "documented on the client type") is **17 of 21 honored (81%)** — and where honored, honored to a near-identical formula ("`null` means exactly one thing: … Rejects if no project is open (#1841)", e.g. `client.ts:161,164,256,767,794`). The four misses are `client.ts:14` `notebase.open()`, `:16` `newProject()`, `:641` `conversations.load()`, `:1109` `csl.importLocale()`. Two are diagnostic: `open()`/`newProject()` sit in the same block as four siblings (`:18,20,25,28`) that *all* carry the cancel note; and `importLocale()` sits **directly below** its near-identical twin `importStyle()` (`:1108`), which is documented. Adjacent-line asymmetry is strong evidence the doc is written per-PR, not per-rule. `conversations.load()` is the pointed one — CLAUDE.md claims `CONVERSATION_LOAD` was *cleared* in #1841; the main-side fix landed, the client-type documentation half did not.
- **Rule 3** ("document on the type that the call itself does not reject") is **1 of 8 honored**. The phrase appears exactly once in all of `src/` — `src/shared/compute/types.ts:61` on `PythonProbeResult`. Missing on `TablesQueryResult` (`client.ts:185-187`, no doc at all), `CellResult` (`compute/types.ts:41-43`, no doc — and `PythonProbeResult`'s own doc cites it as the exemplar), `PublishGitResponse`, `InterruptResult`, `graph.setBaseUri`, `GRAPH_QUERY`, and `ConnectionCheckResult`. That last one also violates the rule's *shape* requirement, not just its doc requirement: it is `{ ok: boolean; error?: string }` — non-discriminated — and `PythonProbeResult`'s doc at `types.ts:49-52` explicitly critiques that exact shape ("was the shape until #1878") without the sibling ever being migrated.

**The thought ontology is the inverse case — and the best-documented artifact in the repository.** `src/shared/ontology-thought.ttl`: **92 of 92 classes and 99 of 99 properties carry an `rdfs:comment`. 100%**, plus 67 section-header lines. `src/shared/ontology.ttl` likewise 6/6 and 17/17. And it is **0% discoverable**: no prose doc explains the model anywhere, no file in `docs/` or `website/docs/` links to it (`grep -rn "ontology-thought"` → zero inbound references), and the only user-facing page that names `thought:` at all is `website/docs/notes-rdf.html:108-121`, which uses `thought:Term` purely as Turtle syntax filler. CLAUDE.md's five-bullet section is the sole prose description of Minerva's headline differentiator — and it lives in the agent-instructions file.

The `types:` system fares better on *use* and worse on *authoring*. Stock types live at `src/main/types/stock/*.md` (10 files), and three good user pages cover them (`settings-object-types.html` — 210 lines on stock/customized/user provenance, revert, rename cascade; `notes-typed-notes.html`; `left-sidebar-objects.html`). But **there is no `docs/authoring-types.md` to match `docs/authoring-skills.md`**: the `.md`-with-frontmatter format is undocumented outside source. `externalClass` — the #2036 key that bridges a user type to an external vocabulary (`src/main/types/compile.ts:32-41`, `parse.ts:172`) — appears in **zero** files under `docs/` or `website/docs/`, with one passing mention in `docs/vision/objects-expansion.md:120`. Same for `predicate:`, `targetType:`, `link-to-type`. A user can edit a type through a dialog; they cannot hand-author or version-control one from documentation.

#### `reports/` — 31 files, 129,620 words, **the largest markdown corpus in the repository, and genuinely consumed**

That is 2.1× the entire user manual and 11× all of `docs/*.md` combined. 27 committed, 4 untracked (today's three siblings plus a September modernization review). Size is growing steeply: June architecture review 21K → 2026-09-20 architecture review 73K. Naming is inconsistent (`refactor-` vs `refactoring-`, `perf-` vs `performance-`).

Credit first: **these are read and acted on** — 12 of 12 sampled June recommendations implemented, with `release.yml:9-11` citing a finding id directly. That is a better consumption rate than most teams achieve with a tracker.

**The debt is not that they go unread — it is that nothing marks a report as spent.** Three verified consequences:
- **A report is load-bearing for a live gate.** `.githooks/pre-push:18` prints "See `reports/design-review-2.md` §2" on every font-lint failure. The directory cannot simply be pruned.
- **Reports cite reports.** 8 of 31 carry `reports/` cross-references (e.g. `quality-review-…-2026-09-04-100854.md:4-5`, "Prior reviews consulted: …"). Deleting a superseded file breaks a citation chain.
- **Superseded reports are indistinguishable from live ones.** The June architecture review's executive summary still asserts `ipc.ts` is 2,717 lines and `App.svelte` is 3,764 — off by 34× and 1.8× respectively, because its own recommendations were implemented. There are **8 architecture reviews and 6 quality reviews** in one flat directory with no currency marker, and the oldest reads as authoritative until you check the code. That is a worse failure mode than the stale config comments below, because no test sits anywhere near it.

There is **no index, no README, and no mention in any doc or in CLAUDE.md** (`grep -c "reports/" CLAUDE.md` → 0).

### Documentation Gaps

**Gap 1 — The user manual is unreachable from the app.** `src/main/menu.ts:1002`: `DOCS_URL = 'https://github.com/dgriffith/ide-for-thought/tree/main/docs'`. That is the developer docs folder. The user site is `website/docs/` (118 pages), deployed by `scripts/deploy-to-gh-pages.sh:7` to `dgriffith/minerva`. **The canonical published URL appears nowhere in the repository** — not in `docs/releasing.md`, not in README, not in the deploy script's output. `README.md` never links the docs site either, and has **no download or install section at all**. Compounding: `menu.ts:1002,1005` and `website/docs/_layout.html:68` say `ide-for-thought`; the deploy script says `minerva`. Two repo names in user-facing links.

**Gap 2 — The README's shortcut table is the app's least accurate documentation.** `README.md:190-202`, 11 rows: one **fabricated** (`Cmd+Shift+C — Commit All`; zero "Commit" accelerators in `menu.ts` — `commitAll` exists only as a main-process op at `src/main/git/index.ts:47` with no binding); four with stale labels ("Open **Project**" vs `menu.ts:243-244` "Open **Thoughtbase**…"; "Close **Project**" vs `:252-253`; "Cycle **View** Mode" vs `:563-564` "Cycle **Preview** Mode"; "Toggle **Sidebar**" vs `:547-548` "Toggle **Left** Sidebar"); one collision (`CmdOrCtrl+Shift+W` is bound to both Close Thoughtbase `:253` and Close Group `:591`). Against ~44 menu-level accelerators (32 explicit + ~21 role-inherited) plus 12 renderer-global bindings (`handle-keydown.ts:37-92`) plus editor-local ones. **The flagship omission is ⌘K** — the command palette (`handle-keydown.ts:35-43`) has **no menu item** (`grep "Palette" src/main/menu.ts` → 0), so it is missing from Help → Keyboard Shortcuts too, since that dialog derives from the menu template. The app's launcher is discoverable only from the docs site the app doesn't link.

**Gap 3 — Nine of sixteen architecture-ratchet tests are documented nowhere.** These encode design rules; the rules exist only as test code. Documented in CLAUDE.md: `config-loader-usage`, `config-roots-doc`, `file-size-budgets`, `ipc-registrar-coverage`, `pattern-ratchets`, `store-ownership`. **Undocumented**: `no-cycles`, `ui-dialog-adoption`, `store-state-ownership`, `scoped-css-duplication`, `embedding-model-gate`, `argument-map-read-only`, `e2e-launch-hygiene`, `graph-tests-use-temp-project-fixture`, `llm-tests-use-temp-project-fixture`. `docs/development.md` mentions **none** of the sixteen (`grep -nE "ratchet|architecture/|budget"` → zero hits). Two are especially surprising: `no-cycles` enforces an invariant CLAUDE.md never claims, and `ui-dialog-adoption` machine-checks the very `showConfirm`/`showPrompt` convention that `development.md:109-110` and `CLAUDE.md:189` state in prose — while both state it wrongly (Gap 4).

**Gap 4 — Verified CLAUDE.md inaccuracies.** In severity order:
1. **The IPC recipe (`:193-199`) omits two mandatory steps.** `src/shared/ipc-contract.ts`'s `ChannelMap` entry is **compile-blocking** — its own docstring says so (`:16-21`: "a new invoke channel can't ship without a `ChannelMap` entry — it won't compile"), and there is no escape hatch: the only `ipcMain.handle` in `src/main` is inside the typed wrapper (`typed-ipc.ts:10`). And `tests/preload/preload-bridge.test.ts:81` snapshots the `window.api` shape, so any method add/rename fails until regenerated. `docs/development.md:89-94` *names* `ipc-contract.ts` one sentence before reciting the same five-step list that omits it.
2. **`showPrompt`/`showConfirm` (`:179,189`)** live at `stores/dialogs.svelte.ts:96,122`; `App.svelte:401` only destructures them. CLAUDE.md `:108` has it right, so the file contradicts itself. The documented signature is also incomplete — the real one takes a fourth `options: { hideDontAskAgain?: boolean }` parameter (`dialogs.svelte.ts:122-126`).
3. **Prefix list is 8 of 15 (`:368`).** `state.ts:169-185` defines fifteen and `sparql.ts:25-30` injects all of them. Undocumented: `owl`, `bibo`, `schema`, **`types`**, **`dcat`**, **`skos`**, **`foaf`**. This has user impact — a user or the LLM writing SPARQL in the Query panel has no doc saying `types:` is pre-bound.
4. **`pnpm lint` is parallel (`:10`)** — see Executive Summary.
5. **`eslint.config.js` (`:65`)** — only `eslint.config.mjs` exists.
6. **The integrity query (`:489`) has drifted from its executable copy.** `src/main/graph/integrity.ts:33` wraps the filter as `CONTAINS(LCASE(STR(?extractedBy)), "llm")`; the doc omits `STR()`. Not equivalent for non-simple-literal terms — and CLAUDE.md `:480` explicitly instructs "Keep the query below in sync."
7. **The "Migrated so far" config list (`:274-283`) is missing two** — `src/main/mcp-servers/config-store.ts:73` and `src/main/mcp-client/oauth/token-store.ts:68` both use `loadConfigFile`.
8. **`KNOWN_UNTESTED` is empty (`:353`).** `ipc-registrar-coverage.test.ts:72` is `[]`, with a header noting every registrar is now covered (#1840). The prose implies a live backlog.
9. **`operationType` (`:429`) omits `evidence_link` and `type_definition`** (`src/main/llm/proposal-types.ts:13-22`) — mitigated by the trailing `…`. And the "One tier" section's claim that `notify_only`/`autonomous` "were removed" is true of TypeScript but **not of the shipped ontology**: `ontology-thought.ttl:881-895` still defines `thought:ApprovalPolicy`, `thought:approvalTier` ("requires_approval, notify_only, or autonomous") and `thought:forOperationType`. The vocabulary a user can query still describes tiers the design abolished.
10. Typo: stray `//` at end of `:358`.

**Gap 5 — Feature surfaces with zero user documentation.** Verified by grepping all 118 fragments:
- **MCP Servers settings tab** — ships at `SettingsDialog.svelte:102` with `McpServersSettings.svelte`; zero hits. Worse than absent: `connecting-mcp.html:7` documents the *opposite* direction (Minerva *as* an MCP server), so a reader concludes Minerva can't consume them.
- **Graph / neighborhood view** — `GraphCanvas.svelte`, `NeighborhoodGraph.svelte`, reachable at `App.svelte:1488`; "graph view" → 0 hits.
- **Argument map** — `ArgumentMap.svelte` exists; "argument map" → 0 hits.
- **Objects Map view** (#2164, four commits ago) — 0 hits.
- **Print / Print to PDF** — `menu.ts:330,334`; 0 hits.
- **Auto-update** — `src/main/auto-update.ts`, `menu.ts:157` "Restart to Install Update"; 0 hits.
- **The thought ontology** — README's headline differentiator ("models the *shape* of an argument") and 92 classes; exactly **one** fragment mentions it (`notes-rdf.html`).
- Plus one **wrong** claim: `editor-keyboard-shortcuts.html:42-43` promises "check Settings — any of them can be reassigned." No keybinding UI exists among the 16 settings tabs.

**Gap 6 — `docs/cli.md` (2026-07-11) misses 2 of 10 commands and describes shipped work as future.** Real dispatch (`src/cli/run.ts:262-304`): `query · sql · search · grep · semantic · read · context · propose-note · mcp · eval`. **`grep` is absent** from the command table (`:26-35`) though it's implemented at `run.ts:272-277` and exposed as the `grep_notes` MCP tool (`src/cli/mcp.ts:113`) — which the doc's MCP tool list (`:106-109`) also omits, naming 7 of 8. **`eval` is absent** entirely (413 lines at `src/cli/eval.ts`). `:140` says "the **forthcoming** MCP subcommand" forty lines after documenting MCP. `:93-97` and `:124-127` say live-app write coordination is "future work"; `src/cli/routed-engine.ts:1-14` shipped it.

**Gap 7 — `docs/website/` is a dead duplicate of the live site.** Seven files, added in one commit — `d5e05e16`, 2026-08-03, message **"rolled-out files?"** — and never touched again. **Zero references anywhere** in the repo. All seven differ from their `website/` counterparts, whose git history shows five substantive maintenance commits (most recently #1791). Its own `README.txt` calls them "draft pages" with "author-fill markers" (the live copies have none — verified, 0 hits for placeholder markers across `website/*.html`).

**Gap 8 — Publication is the only unautomated, ungated link in the docs pipeline.** Generation is CI-checked; deployment is not. `docs/releasing.md:279`: `deploy-to-gh-pages.sh` is "not run automatically; run by hand whenever `website/` content changes." 42 commits touched `website/docs/` in 90 days. Nothing detects a published site lagging `main`.

**Gap 9 — The help corpus can go stale silently in two directions.** `resources/help-docs/corpus.json` is **gitignored** (`.gitignore:77`) and **never built in CI** — it is a `predev`/`prebuild` artifact (`scripts/prep.mjs:22-26`). `tests/scripts/help-docs-corpus-staleness.test.ts:36-42` snapshots **525 chunk ids**, so it catches added/removed/retitled pages and `<h2>` sections — but **not a prose rewrite inside an existing section**, and nothing at all about whether the embeddings are current. At runtime `src/main/help-docs/corpus-store.ts:53,62,68` never throws: a missing or model-mismatched corpus degrades to `[]` with a `logger.warn`, so `search_help` silently answers from nothing.

**Gap 10 — Undocumented scripts.** Absent from `CLAUDE.md`, `README.md`, and every `docs/*.md`: `check:docs`, `build:docs`, `bench`/`bench:json`/`bench:check`/`bench:baseline`, `lint:fonts`, `lint:seq`, `lint:eslint`, `fetch:model`, `fetch:help-corpus`, `build:clipper`, `package:clipper`, `typecheck:clipper`. Two matter most: **`check:docs` is a CI gate** (`ci.yml:72`) that a contributor editing docs will fail with no prose explaining the regenerate step, and **`bench`** has an entire workflow (`bench.yml`) and regression gate (`scripts/bench-check.mjs`) with no documentation — which is the same gate the build review found failing seven consecutive weeks unnoticed.

**Gap 11 — The inline-comment strategy has one failure mode, and it has already fired six times.** The prose is excellent where it explains *reasoning*; it rots where it states a *fact*. All verified against current state:

- **Highest risk — `.github/workflows/ci.yml:119,131-132` points at a config location pnpm no longer reads.** The comment says dependencies "were force-patched via `pnpm.overrides`" and instructs the reader to "force a patched transitive with a **`pnpm.overrides` entry in package.json**." `package.json` has **no `pnpm` key at all**; `pnpm-workspace.yaml:1-4` states outright that "As of pnpm 11/12 these are no longer read from package.json's `pnpm` key or from `.npmrc`" (#2149), and the overrides live at `pnpm-workspace.yaml:8-46`. This is an *instruction*, so following it produces a silently-ignored edit and an unfixed advisory. The #2149 migration wrote a superb comment at the new location and never grepped for references to the old one.
- `vitest.config.mts:361` — "a declarative contextBridge passthrough (**~326 lines**…)". `preload.ts` is **642**.
- `vitest.config.mts:348` — "Renderer tree — **93 components + both reactive stores**". Actual: **130** components, **28** stores. "Both reactive stores" is the phrasing of a two-store era.
- `vitest.config.mts:199` — "**all 24** now have a direct handler test". There are **25** registrars. Benign only because `ipc-registrar-coverage.test.ts:72` enforces the invariant independently.
- `vitest.config.mts:66-69` — **a placeholder that shipped**: "Measured at floor-time: **shared ~?**, llm ~74% lines / 51% branch". The `~?` was never filled in, and both figures are contradicted 20 lines later by the per-glob entries the block summarizes (`:78` shared 95.9%/86.1%; `:87-88` llm 85.1%/70.5%, ratcheted #1932). The header was written in #679 and never re-synced.
- `vite.main.config.mts:36` — "Externalize them — **Electron 42 / Node 22**". Actual `electron@44.0.0` (`package.json:119`), `engines.node >=24`. Claim still true; numbers two majors behind.

Checked and **clean**: all 8 `pnpm` overrides resolve exactly as their comments claim (`@codemirror/view 6.43.1`, `@codemirror/state 6.7.1`, `@codemirror/language 6.12.4`, `d3-path 3.1.0`, `adm-zip 0.6.1`, `fast-uri 4.1.4`, `browserslist 4.28.9`, `tar 7.5.22`); `forge.config.ts`'s `EXTERNAL_DEP_ROOTS` is consistent with `vite.main.config.mts` and all six roots are present; `forge.config.ts:175-181`'s arm64-only note is accurate. The pattern is clear — **comments that record a decision stay true; comments that record a count or a version do not.**

**Gap 12 — No PR template.** `.github/` has `ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml` (well-made, with a considered `blank_issues_enabled: true`), `dependabot.yml`, and three workflows — but no `PULL_REQUEST_TEMPLATE.md`. The six-point PR checklist at `development.md:206-221` is specific (Conventional Commits scope, `Closes #N`, snapshots in the same PR) and invisible at the moment it's needed.

---

## Prioritized Action Plan

### Priority 1: Critical Documentation

- [ ] **Write down the docs site's canonical public URL**, in `docs/releasing.md` next to the `deploy-to-gh-pages.sh` row (`:279`), and point `DOCS_URL` at it (`src/main/menu.ts:1002`). This is a one-line code change gated on one fact nobody has recorded; it is the highest-value item in this report.
- [ ] **Add a `## Download` section to `README.md`** above `## Development`, linking GitHub Releases and the docs site, and naming the platform reality (arm64-only today, per #962). Verified absent: zero download/install references in 214 lines.
- [ ] **Delete the `Cmd+Shift+C — Commit All` row from `README.md:199`** — the accelerator does not exist.
- [ ] **Replace `README.md:190-202` with a link to the docs site's shortcuts page** rather than maintaining a 4th copy of the shortcut list. The un-driftable copy already exists in-app (`menu.ts:1013-1027`); a hand-maintained 11-row subset that is 25% complete and contains a fabrication is negative value.
- [ ] **Add a "Command Palette (⌘K)" item to the View or Go menu** (`src/main/menu.ts`) so it appears in Help → Keyboard Shortcuts. Currently renderer-only (`handle-keydown.ts:35-43`) and therefore invisible to the app's own shortcut reference.
- [ ] **Fix the five CLAUDE.md statements that will actively mislead an agent or contributor**: the parallel-lint sentence (`:10`), `eslint.config.js` → `.mjs` (`:65`), `showPrompt`/`showConfirm` location and 4-arg signature (`:179,189`), the 15-prefix list (`:368`), and the missing `STR()` in the integrity query (`:489`).
- [ ] **Add the two missing steps to the IPC recipe** (`CLAUDE.md:193-199` and `docs/development.md:89-94`): a `ChannelMap` entry in `src/shared/ipc-contract.ts`, and `pnpm test tests/preload/preload-bridge.test.ts -u`.
- [ ] **Document the MCP Servers settings tab** — a shipped user-facing capability whose only mention in the manual describes the opposite direction (`connecting-mcp.html:7`).
- [ ] **Fix `.github/workflows/ci.yml:119,131-132`** to point at `pnpm-workspace.yaml`'s `overrides` instead of `package.json`'s `pnpm` key, which pnpm 11/12 no longer reads (`pnpm-workspace.yaml:1-4`, #2149). This is an actionable instruction that currently produces a silently-ignored edit during a security-advisory response — the only stale comment in the repo that can cause a wrong action rather than a wrong belief.

### Priority 2: Important Documentation

- [ ] **Add a `tests/architecture/docs-parity.test.ts` covering the hand-maintained counts.** Assert against the authoritative source: `LINK_TYPES.length` vs README; stock-skill count vs README; `SETTINGS_TABS.length` vs `settings.html`; per-menu skill counts vs `authoring-skills.md:355`. Same shape as `config-roots-doc.test.ts`, and it closes eight of the nine count defects in the Executive Summary table at once.
- [ ] **Extend the same test to the four `thinking-tools-*.html` fragments** — assert `loadSkillCatalog()` names ⊆ names appearing there. (The architecture review's P9 independently identified this; with a one-file skill-add path and 56 stock skills, the docs *will* fall behind.)
- [ ] **Fix `website/docs/_content/settings.html`**, which states four different tab counts in one file (`:3,7,9,73-143`) and none of them is 16.
- [ ] **Document the nine undocumented architecture ratchets.** Given CLAUDE.md's size, extract *all sixteen* into `docs/architecture-ratchets.md` — one paragraph each: what it enforces, how to respond when it fires — and leave a one-line pointer in CLAUDE.md. `no-cycles` and `ui-dialog-adoption` first.
- [ ] **Correct the three lying status headers**: `docs/architecture/compute-sandbox.md:3` (Proposed → Accepted/Shipped, #1329/#1421), `docs/prd/long-running-conversations.md:3` (draft → Historical, and note the three named dialogs became skills), and add `> Status: shipped` banners to `docs/vision/{compute,sql,publication}.md`.
- [ ] **Bring `docs/cli.md` current**: add `grep` and `eval` to the command table, add `grep_notes` to the MCP tool list, delete "forthcoming MCP subcommand" (`:140`), and replace the "future work" write-coordination caveats (`:93-97`, `:124-127`) with `routed-engine.ts`.
- [ ] **Delete `docs/website/`.** Seven orphaned files from a commit named "rolled-out files?", zero inbound references, superseded by `website/`.
- [ ] **Add `requiresNote` and `parameters[].placeholder` to `docs/authoring-skills.md`**'s frontmatter table, and refresh the model examples at `:91` to the current generation.
- [ ] **Add `docs/README.md`** — a 20-line map distinguishing reference docs from `vision/` (aspirational), `prd/` (historical), `architecture/` (ADRs), and `design/` (dated artifact). Currently all flat with no signal about which is authoritative.
- [ ] **Document `check:docs` and `bench` in `docs/development.md`.** `check:docs` is a CI gate a docs contributor will hit blind; `bench` is a whole workflow with no prose.
- [ ] **Fix the four smaller `development.md` defects**: the two-gate pre-push hook (`:67-68`), the three-step `predev` (`:50-52`), the component count (`:185`), and the test-directory list (`:189-190`). Add a `src/cli/` bullet to the architecture section and a pointer to `docs/cli.md`.
- [ ] **Refresh the five stale factual comments** in `vitest.config.mts` (`:66-69` the `~?` placeholder and its two contradicted figures, `:199` "all 24", `:348` "93 components + both reactive stores", `:361` "~326 lines") and `vite.main.config.mts:36`. Prefer deleting the number to updating it where the reasoning survives without it.
- [ ] **Document the type-authoring format** — a `docs/authoring-types.md` matching `docs/authoring-skills.md`, covering the frontmatter schema including `externalClass`, `predicate:`, `targetType:`, and `link-to-type`. `externalClass` is the #2036 external-vocabulary bridge and appears in zero user or contributor docs.
- [ ] **Write a prose overview of the thought ontology** and link it from `website/docs/notes-rdf.html`. The TTL is 100% commented and completely undiscoverable; README sells the epistemic model as a differentiator and no page explains it.
- [ ] **Add the missing rule-3 notes** to the seven union types that lack them (`TablesQueryResult`, `CellResult`, `PublishGitResponse`, `InterruptResult`, `graph.setBaseUri`, `GRAPH_QUERY`, `ConnectionCheckResult`) and the four rule-5 `| null` methods (`client.ts:14,16,641,1109`). These are obligations CLAUDE.md imposes; rule 3 is currently 1-of-8.

### Priority 3: Nice-to-Have

- [ ] **Add `.github/PULL_REQUEST_TEMPLATE.md`** encoding `development.md:206-221`.
- [ ] **Extract CLAUDE.md's four deepest convention blocks** — Renderer data flow (141 lines), IPC error handling (65), Config files (31), Logging (32) — into `docs/conventions/*.md`, leaving the rule statement plus a link. That is 269 of 498 lines; the remainder could then afford a real Architecture section covering all five layers. Note the growth curve (66 → 152 → 237 → 357 → 498) before deciding this can wait.
- [ ] **Write the missing architecture document.** `docs/architecture/` has two scoped ADRs and no overview, while `development.md:15` calls CLAUDE.md "the fullest map of how the pieces fit together" — and CLAUDE.md gives architecture 10 lines. The material largely exists already in this report's sibling (`reports/architecture-review-entire-project-2026-09-20-175545.md`).
- [ ] **Add a `reports/README.md`** with a currency marker per report — superseded / live / promoted. The June architecture review still asserts `ipc.ts` is 2,717 lines (it is 79) *because its own recommendations were implemented*; with 8 architecture reviews and 6 quality reviews in one flat directory, nothing tells a reader which is authoritative. Note the two constraints on simply pruning: `design-review-2.md §2` is referenced by `.githooks/pre-push:18`, and 8 of 31 reports cite each other.
- [ ] **Move the font rule out of `reports/design-review-2.md §2`** into `CLAUDE.md`'s Styling section (which lists `--bg`/`--text`/`--accent`/`--border` but not `--font-mono`) and re-point `.githooks/pre-push:18`. A rule enforced on every push should not be documented in a review artifact.
- [ ] **Document the remaining feature gaps** from Gap 5: graph/neighborhood view, argument map, Objects Map view, Print/Print to PDF, auto-update.
- [ ] **Fix `editor-keyboard-shortcuts.html:42-43`**, which promises remappable shortcuts in Settings; no such UI exists. Also disambiguate the two ⌘K meanings on that page (`:33` editor-local insert-link vs `:96` global palette).
- [ ] **Resolve the two repo names in user-facing links** — `ide-for-thought` (`menu.ts:1002,1005`, `_layout.html:68`) vs `minerva` (`deploy-to-gh-pages.sh:7`).
- [ ] **Reconcile the ontology's surviving approval tiers** (`ontology-thought.ttl:881-895`) with CLAUDE.md's "removed" note — either delete the TTL terms or soften the note to say they persist in the vocabulary.
- [ ] **Raise per-item doc coverage in the three zero-coverage `channels.ts` sections** — Project/file menu actions (1/23, `:189`), Editor split (0/18, `:221`), Refactor menu (0/10, `:241`). Menu-command channels are arguably self-evident; `GRAPH_QUERY` at `:140` is not, and it is the one channel CLAUDE.md's own backlog flags as an anti-pattern.
- [ ] **Consider building the help corpus in CI** (or asserting its freshness), and consider making `corpus-store.ts` loud rather than silent when the corpus is missing in a packaged build (`:53,62,68`).
- [ ] **Migrate `ConnectionCheckResult`** (`src/shared/tools/types.ts:256-262`) to a discriminated `{ ok: false; error }` arm. Its sibling's doc (`compute/types.ts:49-52`) already explains why the current shape is wrong and says it "was the shape until #1878" — the critique was written and this type was never migrated.

---

## Recommendations

**1. Stop writing counts in prose. Derive them or test them.** Every one of the nine count defects found here sits next to an authoritative list in code — and in the most pointed case, next to a file header that *says so*: `src/shared/link-types.ts:1-6` reads "To add a new link type, add an entry here. Everything else — parsing, rendering, ontology predicates, graph indexing — derives from this list." Everything except the README. This project already has both remedies working: a doc-parity ratchet (`config-roots-doc.test.ts`) and a derived UI (`menu.ts:1013-1027`). One new ~60-line test would close most of the table.

**2. The `pnpm lint` story is the argument for coupling, and should be told internally.** A PR explicitly titled "fix dev-doc lint-description drift" was obsoleted 49 minutes later by a behavior change in the same day's merge queue. No amount of diligence beats that; only a check does. The generalizable rule: **when prose describes behavior that a script already documents in its own header, delete the prose and link the script.** `scripts/lint.mjs:1-4` is more accurate than either doc that describes it, and always will be.

**3. Treat "reachability" as part of doc coverage.** This is the finding that a page-count metric hides. The manual is 118 pages and structurally perfect; the Help menu goes somewhere else; the README doesn't link it; and the canonical URL isn't recorded. Coverage without a path to it is zero. Before writing another page, spend an hour making the existing 118 reachable.

**4. The inline-comment strategy is working — and the data says exactly which half of it to trust.** 32–59% comment density across the infra files. Sorting the six stale instances against the dozens of accurate ones yields a clean rule: **comments that record a *decision* stay true; comments that record a *count* or a *version* do not.** `pnpm-workspace.yaml:20-33`'s account of the xmldom failure will be correct forever. `vitest.config.mts:348`'s "93 components + both reactive stores" was wrong within weeks (130 and 28 today), and `:66-69` shipped a literal `~?` placeholder whose neighbours contradict it. So: keep writing the rationale, and **stop writing counts and versions into prose that no test reads** — especially in `vitest.config.mts`, where the numbers *next to* the stale prose are ratcheted by tests while the prose is not.

The one instance that deserves separate weight is `ci.yml:131-132`, because it is an **instruction rather than a belief**: it tells a security responder to add a `pnpm.overrides` entry to `package.json`, which pnpm 11/12 silently ignores. Every other stale comment produces a wrong impression; that one produces a wrong action during an advisory response.

**5. `CLAUDE.md` is near a size where its own accuracy becomes the risk.** It grew 66 → 498 lines in six months and is 67% conventions. The nine defects found are not distributed randomly: **every one is in a list claiming to be complete** (prefixes, config migrations, operation types, the IPC recipe, the untested-registrar backlog). Long enumerations are the part of a handbook most likely to be wrong and least likely to be re-read. Extract them to `docs/` where a ratchet test can watch them, and let CLAUDE.md keep the *rules*, which have held up well.

**6. Close the pipeline's last open link.** Generation is gated; publication is manual (`docs/releasing.md:279`) and the corpus is neither committed nor built in CI (`.gitignore:77`, `prep.mjs:22-26`). The staleness snapshot guards chunk ids but not prose (`help-docs-corpus-staleness.test.ts:36-42`), so a docs rewrite ships with embeddings describing the old text and nothing notices. Given the `search_help` tool feeds answers to users, doc accuracy here is a product surface, not a nicety.

**7. `reports/` needs a currency marker, not a cull.** The instinct on seeing 31 review files and 129,620 words is "this is debt." The evidence says otherwise — 12 of 12 sampled June recommendations shipped, and `release.yml:9-11` cites a finding id in its header. These are working. The actual problem is that **a spent report is indistinguishable from a live one**: the June architecture review still describes an `ipc.ts` that is 34× larger than today's, precisely *because* it was acted on. Add a one-line status per file in a `reports/README.md`. Do not prune — `.githooks/pre-push:18` depends on one of them and 8 of 31 cite each other. And where a report's finding has become a standing rule (the `--font-mono` requirement), promote it into `CLAUDE.md` so the pre-push hook can stop pointing contributors at a review artifact.

**8. There is one documentation asset here that is 100% complete and 0% reachable.** `ontology-thought.ttl` has an `rdfs:comment` on every one of its 92 classes and 99 properties. Nothing links to it, no prose explains it, and the single user-facing page that mentions `thought:` uses it as syntax filler. Meanwhile README sells the epistemic model as the product's intellectual differentiator. That is the largest gap between *what was built* and *what a reader can find* in the entire documentation set — bigger than any missing page — and it is a writing task, not an engineering one.

---

## Estimated Effort

These are **calibrated against observable comparables in this repository's own history**, not invented. Where I have no comparable, I say so.

| Item | Estimate | Basis |
|---|---|---|
| Record the docs URL + repoint `DOCS_URL` | **< 1 hour** | Two-line change; the only unknown is confirming the live URL. |
| README download section + shortcut-table fixes | **1–2 hours** | Comparable: #1315 ("Wire up website download/GitHub/Releases/License links") was a single-PR change. |
| Six CLAUDE.md factual fixes + IPC recipe | **2–3 hours** | The verification is already done in this report with file:line on both sides; the work is editing plus a re-read. |
| `docs-parity.test.ts` for the count defects | **3–5 hours** | Direct comparable: `config-roots-doc.test.ts` is 146 lines including its self-documenting header and anti-vacuity anchors. This one is simpler (import the list, compare to a regex over the doc) but covers four or five surfaces. |
| Document the 9 undocumented ratchets | **3–4 hours** | ~20 minutes per test to read it and write a paragraph, plus assembling `docs/architecture-ratchets.md`. |
| `docs/cli.md` refresh | **2–3 hours** | Two new command sections plus correcting three stale design statements; the CLI's `HELP` block (`run.ts:47-84`) is a ready-made source. |
| Status-header corrections + delete `docs/website/` + `docs/README.md` | **1–2 hours** | Mechanical. |
| Document MCP Servers settings tab | **2–4 hours** | Comparable: the existing settings fragments average ~440 words each (7,028 across 16); this one needs a screenshot, which `website/docs/` already has a Playwright harness for. |
| Remaining Gap 5 features (graph view, argument map, Map view, Print, auto-update) | **1–2 days** | Five pages at the site's demonstrated density (~440 words + screenshot each), plus nav wiring. |
| Fix `ci.yml:131-132` pnpm-overrides instruction | **< 1 hour** | Two comment lines; the correct location is already documented at `pnpm-workspace.yaml:1-4`. |
| Refresh the six stale config-comment facts | **1 hour** | All six located with file:line above; most are best fixed by deleting the number. |
| `docs/authoring-types.md` | **4–6 hours** | Direct comparable: `docs/authoring-skills.md` is 390 lines and is the format to mirror. The type schema is smaller than the skill schema. |
| Thought-ontology prose overview | **4–8 hours** | No comparable — it is a writing task over 1,219 lines of TTL, and the hard part is choosing the through-line, not the word count. |
| Rule-3 / rule-5 doc-comment backfill (11 sites) | **2–3 hours** | Formulaic; `client.ts:161` and `compute/types.ts:61` are the templates to copy. |
| PR template | **< 1 hour** | Transcribe `development.md:206-221`. |
| **Priority 1 total** | **~1 day** | |
| **Priority 1 + 2 total** | **~4–5 days** | |

**One scheduling trap to anticipate.** `channels.ts` (723 lines), `client.ts` (1,337), `ipc-contract.ts` (779), and `preload.ts` (642) are all under committed line budgets in `tests/architecture/file-size-budgets.test.ts`. **Adding the missing doc comments to any of them will fail that test**, requiring the budget to be raised in the same PR. That is the check working exactly as designed — its own documentation names "raise the number in the same PR" as option 2 (`file-size-budgets.test.ts:29-31`) — but it should be expected rather than discovered mid-PR, and it is worth saying in the PR body that the growth is comments.

**What I deliberately will not estimate**: extracting CLAUDE.md's convention blocks into `docs/conventions/` and writing the missing architecture document. Both are judgement-heavy restructurings whose cost is dominated by decisions (what belongs where, what the agent-facing file must retain) rather than typing, and I have no comparable in this repo's history to anchor on. The architecture document has the advantage that `reports/architecture-review-entire-project-2026-09-20-175545.md` already contains most of its raw material.

**One estimate I am confident is too low elsewhere**: fixing prose is cheap; *keeping it fixed* is the cost. The `pnpm lint` case is the measurement — a dedicated drift-fixing PR bought 49 minutes of accuracy. Weight the ratchet-test items accordingly: a 4-hour test that holds eight facts true permanently is worth more than 8 hours of one-time corrections that begin decaying on merge.
