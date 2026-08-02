# API Design Review — Minerva

**Date:** 2026-08-02
**Scope:** Entire project — the Electron IPC contract as Minerva's real "API surface"
**Reviewer lens:** API/interface design (naming, shape, contract completeness, developer experience)

---

## Critical Framing

Minerva is a **desktop Electron application, not a web service.** There is no
HTTP server, no REST/GraphQL endpoints, no OpenAPI document, no OAuth, no rate
limiting, no CORS, no public API consumers, and no SDK. The generic web-API
review template (status codes, HATEOAS, pagination, SLAs, developer portals,
versioning strategy) is therefore **mostly Not Applicable**, and this report
says so explicitly rather than inventing findings.

The genuine API of this codebase is the **Electron IPC contract** — the typed
boundary between the renderer (Svelte UI) and the main (Node.js) process,
surfaced to UI code as `window.api.*`. That boundary is a real, versioned,
consumed interface with request/response shapes, an error convention, a naming
scheme, and a wiring workflow. This review assesses **that** surface, mapping
each template heading onto the IPC reality.

Files reviewed:
- `src/shared/channels.ts` — 333 channel-name constants (the "endpoints")
- `src/shared/ipc-contract.ts` — `ChannelMap`, 235 typed invoke signatures (#981)
- `src/shared/ipc-validators.ts` — runtime return-payload validators (#983)
- `src/main/ipc/typed-ipc.ts` + `helpers.ts` — typed `handle()` + guards
- `src/main/ipc/register-*.ts` — 21 domain registrars
- `src/preload/preload.ts` + `typed-invoke.ts` — the single `contextBridge` surface
- `src/renderer/lib/ipc/client.ts` — the renderer-facing `IdeApi` (1118 lines)

---

## Executive Summary

The IPC surface is **large, mature, and unusually well-governed for an internal
API.** With 333 channel constants across ~37 client namespaces, this is a big
interface, yet it is held together by real contract machinery: a typed
`ChannelMap` (#981) that makes wrong argument/return types fail `tsc`, a typed
`handle()`/`invoke()` wrapper pair that derives its signatures from that map,
zero raw `ipcMain.handle` calls anywhere in the codebase, a runtime
return-payload validator (#983) that is fatal under test, and a preload snapshot
test that catches an unexposed method. This is genuinely good interface
discipline and materially better than the "half-stringly channels" the
architecture review recalled.

The prior architecture review's P2 flag — "`ipc-contract.ts` may be scoped to
the notebase domain, confirm coverage" — is **resolved and can be closed for the
type contract**: `ChannelMap` now spans ~40 domains and 235 invoke channels, not
just notebase. However, the concern is **half-true at the runtime layer**: the
runtime validators in `ipc-validators.ts` cover only ~19 channels, all
notebase. So the *type* contract is universal; the *runtime* shape guard is
still notebase-only.

The three highest-value API-design issues are: (1) **three competing error
conventions** across the surface (throw vs. `{ok,error}` union vs. `null`
sentinel vs. in-band `error` field) with no documented rule for which to use;
(2) **event (one-way) channels have no single source of truth** — `ChannelMap`
covers only invoke channels, so the ~98 `send`-style channels are typed
independently in three places that can silently drift; and (3) **naming drift
between channel domains and client namespaces** (e.g. `excerpt:*` and `ingest:*`
channels surfaced under `api.sources.*`, client verb `remove` mapping to channel
`delete`). None are severe; all are the kind of consistency debt that
accumulates on a fast-growing surface.

---

## API Design Findings

### High

#### H1 — Three (arguably four) competing error conventions across the surface
`src/shared/ipc-contract.ts`, multiple registrars

The same conceptual outcome ("this operation failed") is modeled four different
ways depending on which channel you call, with no documented rule:

1. **Throw** — the dominant path. `withRootPath` throws `'No project open'`
   (`src/main/ipc/helpers.ts:35`); `notebase:*` fs errors propagate as thrown
   exceptions that reject the renderer promise. Most `notebase:*`, `tags:*`,
   `links:*` channels behave this way.
2. **Result union `{ ok: false; error: string }`** —
   `graph:setBaseUri` (`ipc-contract.ts:212`), `tables:query` (`:230`),
   `publish:toGit` (`:300`), `publish:checkS3`/`checkGitHub` (`:314`,`:322`),
   `graph:attachExcerptEvidence` (`:217`).
3. **Discriminated status union other than ok/error** —
   `compute:interruptPython` returns `{ ok:false; reason: ... }` (`:328`);
   `compute:saveCellOutput` returns `{ status:'written' } | { status:'needs-confirm' }` (`:340`).
4. **`null` sentinel** — `templates:get` (`:139`), `graph:sourceDetail` (`:215`),
   `graph:excerptSource` (`:216`), `csl:importStyle` (`:362`),
   `sources:ingestFile` (`:414`). Note `null` is overloaded: for pickers it
   means "user cancelled," for lookups it means "not found."
5. **In-band `error` field** — `graph:query` returns
   `{ results; columns; error? }` (`:209`): a SPARQL error is neither thrown nor
   an `ok:false` union, it is an optional string field the caller must remember
   to check.

**Failure scenario:** a developer adding a store method assumes the dominant
throw convention and wraps a call to `graph:query` in try/catch. A malformed
SPARQL query never throws — it resolves with `{ results: [], error: '...' }` —
so the error is silently swallowed and the UI shows an empty result set instead
of the parse error. The inverse also bites: code that checks
`if (!result.ok)` against a channel that actually throws never runs.

**Recommendation:** document a single decision rule in CLAUDE.md (suggested:
throw for programmer errors / unexpected failures; `{ ok:false; error }` for
*expected, user-surfaceable* failures where the raw message must reach the UI;
`null` reserved exclusively for "picker cancelled"). Do not attempt a big-bang
migration — annotate each channel's chosen convention in `ChannelMap` comments
and converge opportunistically.

#### H2 — Event (one-way) channels have no single source of truth; payloads typed in three places
`src/shared/channels.ts`, `src/preload/preload.ts`, `src/renderer/lib/ipc/client.ts`

`ChannelMap` (#981) is explicitly and correctly *invoke-only* — 235 entries. But
`channels.ts` defines 333 channels; the ~98-channel gap is the one-way `send`
surface: `menu:*` dispatch, `*:changed` broadcasts (`sources:changed`,
`collections:changed`, `tables:changed`, `excerpts:changed`,
`proposals:changed`), `*:progress` streams, `conversation:*Draft` events,
`tool:stream`, `notebase:rewritten`, etc.

These payloads have **no contract**. Each is typed independently at three sites:
the main-process `webContents.send(...)` call, the preload `subscribeIpc<T>` /
callback signature, and the `client.ts` `on*` method signature. In preload,
every draft subscription erases the type entirely — e.g.
`onDraft: (cb: (draft: unknown) => void)` (`preload.ts:274`), repeated for
`onSourceDraft`, `onPropertyDraft`, `onClaimsDraft`, `onComputeDraft`,
`onRefactorDraft`, `onReorgDraft`, `onDeleteDraft`, `onNoteBodyDraft` — then
`client.ts` re-adds the proper `ConversationDraft` etc. types (`client.ts:589`+).
Nothing enforces that the main-side `send` payload actually matches what the
client claims to receive.

**Failure scenario:** a change to `ConversationDraft`'s shape on the main side
(the `send` producer) compiles cleanly; the `client.ts` consumer still declares
the old shape; the renderer reads a field that is now `undefined` at runtime with
no type error at any of the three sites.

**Recommendation:** introduce an `EventMap` (sibling to `ChannelMap`) keying each
one-way channel to its payload type, and a typed `subscribe<K>()` / `broadcast<K>()`
wrapper pair mirroring `handle`/`invoke`. This closes the last untyped seam and
makes the event surface as safe as the invoke surface.

#### H3 — The proposals surface — central to the trust model — is fully untyped (`unknown`)
`src/shared/ipc-contract.ts:486-487`, `client.ts:675-677`

```ts
'proposal:list': (status?: string) => unknown[];
'proposal:detail': (uri: string) => unknown;
```

Proposals are *the* core abstraction of Minerva's "LLM proposes, human confirms"
trust principle (CLAUDE.md). Every LLM-originated graph mutation flows through a
`thought:Proposal`. Yet the entire read side of that surface is typed `unknown[]`
/ `unknown` — the one domain where a strong, documented wire type would most
help reviewers verify the trust invariant is exactly the one with no type at all.
The renderer's proposals store must hand-cast every field.

**Recommendation:** define a `ProposalView` / `ProposalDetailView` type in
`shared/` and use it in `ChannelMap`. Low effort, high clarity payoff, and it
directly supports the "Code Review Checklist for LLM/Graph PRs" in CLAUDE.md.
(Lesser instances: `git:status.files: unknown[]` at `:143`; `graph:query.results`
is inherently `unknown[]` and acceptable for SPARQL.)

### Medium

#### M1 — Runtime validators cover ~8% of channels, all notebase
`src/shared/ipc-validators.ts`

The runtime shape-validation layer (#983) — the analogue of "validate the
response against its schema" — is excellent in design (fatal under test,
`console.error` in prod, never crashes the user's app; `typed-invoke.ts:6-13`).
But `CHANNEL_VALIDATORS` covers only ~19 channels, and they are all
`notebase:*`. The other ~216 invoke channels resolve unvalidated. This is the
kernel of truth behind the architecture review's "scoped to notebase" note: it
is the *runtime validators* that are notebase-scoped, not the type contract.

**Recommendation:** this is intentionally opt-in and expanding it is real work,
but the highest-value additions are the channels with union/`ok` return shapes
(H1) and the proposals surface (H3) — exactly the shapes most likely to drift.
Prioritize validators there rather than aiming for 100%.

#### M2 — Channel-domain ↔ client-namespace drift
`src/shared/channels.ts`, `src/preload/preload.ts`

The channel string's domain prefix and the `window.api` namespace it lands under
disagree in several places, hurting discoverability (a developer grepping for
`excerpt:` won't find it under `api.excerpt`):

- `excerpt:getNoteFolder` / `excerpt:setNoteFolder` → `api.sources.getExcerptNoteFolder` / `setExcerptNoteFolder` (`preload.ts:378`)
- `ingest:getSettings` / `ingest:setSettings` → `api.sources.getIngestSettings` / `setIngestSettings` (`preload.ts:407`)
- `inspections:list` / `inspections:run` → `api.graph.inspections()` / `api.graph.runInspections()` (`preload.ts:134`)
- `images:cacheExternal` and `youtube:thumbnail` are their own top-level namespaces (`api.images`, `api.youtube`) despite being small offline-cache helpers that could sit under a shared namespace.

Singular/plural is also mixed: `api.conversations` → `conversation:*`,
`api.tools` → `tool:*`, `api.proposals` → `proposal:*`, while `api.queries` →
`queries:*` and `api.views` → `views:*` agree.

#### M3 — Client verb ↔ channel verb drift
`src/preload/preload.ts`, `src/renderer/lib/ipc/client.ts`

The client method name and the channel action disagree for several operations,
so the "same" concept is named two ways:

- `api.collections.remove(id)` → `collections:delete` (`preload.ts:440`), yet `api.types.delete(id)` → `types:delete`. Pick one of remove/delete.
- `api.refactor.autoTag(...)` → `refactor:autoTagSuggest` (`preload.ts:357`), but `api.refactor.autoLinkSuggest(...)` → `refactor:autoLinkSuggest`. One drops the "Suggest" suffix, its sibling keeps it.
- `api.compute.interruptPythonKernel()` → `compute:interruptPython` (`preload.ts:197`).

These are cosmetic but they are precisely the kind of inconsistency that makes a
large surface feel arbitrary to a new contributor.

#### M4 — `client.ts` `IdeApi` is a second hand-maintained contract parallel to `ChannelMap`
`src/renderer/lib/ipc/client.ts` (1118 lines) vs `src/shared/ipc-contract.ts` (548 lines)

`ChannelMap` and the renderer-facing `IdeApi` interface describe substantially
the same signatures, but `IdeApi` is authored and maintained by hand rather than
derived from `ChannelMap`. The preload `invoke()` call ties argument/return
*through* `ChannelMap`, so a mismatch is caught where preload assigns — but
`IdeApi` itself can carry return types that differ in shape from `ChannelMap`
(e.g. richer JSDoc, re-declared object literals) and no test asserts the two
agree. This is effectively a **6th wiring site** on top of the documented five
(channel → module → register → preload → client) and doubles the surface a
signature change must touch.

**Recommendation:** medium-term, generate the renderer-facing type from
`ChannelMap` (a mapped type `{ [K in ...]: (...args) => Promise<Return> }`
grouped by namespace) so `IdeApi` becomes derived, not authored. This would
collapse ~1100 lines of duplication and remove a whole drift class.

### Low / Positive

- **Zero raw `ipcMain.handle`.** Every handler goes through the typed `handle()`
  wrapper (`typed-ipc.ts`); a grep across `src/main` finds no bypass. Excellent.
- **`withRootPath` / `withRootPathOr` / `withRootPathWin`** (`helpers.ts:29-72`)
  collapse the "is a project open?" guard that was hand-rolled 86× (#990) into a
  single, tested combinator — a genuinely good bit of API-guard design.
- **The `graph:query` SPARQL surface** auto-injects standard prefixes
  (`src/main/graph/state.ts`, `queries.ts`) so callers write terse queries — a
  nice secondary-API affordance, though its in-band `error` field feeds H1.

---

## Current API Assessment (Inventory)

| Dimension | Value |
|---|---|
| Channel constants (`channels.ts`) | **333** |
| Typed invoke signatures (`ChannelMap`) | **235** |
| One-way event channels (no `ChannelMap` entry) | **~98** (menu dispatch, `*:changed`, `*:progress`, drafts, streams) |
| Client namespaces (`window.api.*`) | **~37** |
| Domain registrars (`register-*.ts`) | **21** |
| Runtime validators (`ipc-validators.ts`) | **~19** (notebase only, ~8% of invoke channels) |
| Raw `ipcMain.handle` bypasses | **0** |

**Namespaces** (representative): `notebase`, `links`, `queries`, `views`,
`search`, `git`, `graph`, `embeddings`, `tables`, `tags`, `templates`, `export`,
`files`, `compute`, `publish`, `app`, `images`, `youtube`, `view`, `shell`,
`conversations`, `proposals`, `bookmarks`, `clipper`, `tabs`, `refactor`,
`sources`, `collections`, `formatter`, `tools`, `types`, `skills`, `sites`,
`bibliography`, `csl`, `citations`, `menu`.

**Dominant patterns (good):** channels follow `domain:verbNoun` in camelCase
(`notebase:readFile`, `sources:setReadStatus`, `collections:createSmart`);
constants are `SCREAMING_SNAKE`; the largest domains (notebase, conversation,
sources) are richly documented inline. The convention is real and mostly
adhered to — the findings above are the exceptions, not the rule.

---

## Improvement Plan

Ordered by value/effort. Estimates assume one engineer familiar with the codebase.

| # | Item | Finding | Effort |
|---|---|---|---|
| 1 | Type the proposals surface (`ProposalView`/`ProposalDetailView`) | H3 | **0.5 day** |
| 2 | Document the error-convention decision rule in CLAUDE.md; annotate each channel's chosen shape in `ChannelMap` comments | H1 | **1 day** (doc + annotation; no code migration) |
| 3 | Introduce `EventMap` + typed `subscribe`/`broadcast` wrappers; migrate the draft/`*:changed`/`*:progress` channels | H2 | **2-3 days** |
| 4 | Fix the stale `ipc-contract.ts` header comment ("for the notebase domain") to reflect the ~40-domain reality; close the arch-review P2 | doc | **15 min** |
| 5 | Expand runtime validators to the union/`ok`-return and proposals channels | M1 | **1-2 days** |
| 6 | Reconcile channel-domain vs namespace names and client-verb drift (deprecate-and-alias, don't hard-rename) | M2, M3 | **1 day** |
| 7 | Derive `IdeApi` from `ChannelMap` via a mapped type; delete the hand-maintained duplicate | M4 | **2-3 days** (careful, touches every store) |

---

## Consistency Enhancements

- **One error shape rule, written down** (H1) — the single highest-leverage
  consistency win.
- **One delete verb** (`delete` vs `remove`) and a **suffix rule for
  suggest/apply pairs** (M3).
- **Namespace = domain-prefix invariant** — either rename the outlier channels
  (`excerpt:*`, `ingest:*`, `inspections:*`) or document why they intentionally
  fold into `sources`/`graph`. A lint rule asserting `Channels.X`'s prefix
  matches its preload namespace would prevent regressions.
- **Singular/plural** — settle `conversation` vs `conversations`, `tool` vs
  `tools`, `proposal` vs `proposals` (channels are singular, namespaces plural;
  either is fine, but be uniform).

---

## Error Handling (how IPC errors actually propagate today)

- **Thrown errors** cross the boundary via Electron's `invoke`/`handle`
  serialization and **reject the renderer promise**; the message survives, the
  stack does not. This is the default for `notebase:*` fs failures and the
  `withRootPath` "No project open" guard.
- **Result unions** (`{ ok:false; error }`) are used where the raw underlying
  message must reach the UI verbatim — notably `publish:toGit` (git auth /
  non-fast-forward messages) and the connection checks. This is the right choice
  for those cases; the problem (H1) is only that the rule for *when* to use it
  isn't written down or uniformly applied.
- **`null`** doubles as "not found" and "picker cancelled," which is ambiguous
  at call sites (M-adjacent to H1).
- **Runtime payload validation** (`typed-invoke.ts` + `ipc-validators.ts`) is a
  distinct, well-designed guard: a return that fails its validator throws under
  test (fails CI) and logs in prod (never crashes the app) — but only for the
  ~19 validated channels (M1).
- **Error-message quality to the UI:** good where the result-union pattern is
  used (raw messages preserved); weaker on thrown paths where the renderer often
  only sees a generic message. No user-facing error taxonomy/codes exist — and
  for a single-consumer desktop app, none is needed.

---

## Versioning — mostly N/A

**N/A — desktop Electron app; the IPC contract is internal and ships versioned
with the app binary.** Renderer and main are always built and released together
from one repo, so there is no independent client to break, no need for URL/header
API versioning, no deprecation window, and no backward-compatibility guarantee
across app versions.

The one place a versioning-adjacent concern is *real* is **persisted-data shape
compatibility**, and the codebase already handles it correctly: `tabs:load`
returns `LayoutSession | TabSession | null` and the renderer migrates the legacy
flat `TabSession` written by older builds on load (`ipc-contract.ts:173`,
`client.ts:692`). That is the appropriate analogue of backward compatibility for
this architecture — schema evolution of on-disk `.minerva/*.json` and the graph,
not wire versioning. No action needed; noted as a well-handled case.

---

## Developer Experience

**The 5-point wiring pattern** (CLAUDE.md): adding a channel means touching
(1) `channels.ts`, (2) the fs/module, (3) a `register-*.ts`, (4) `preload.ts`,
(5) `client.ts`. This is inherently more ceremony than a single-file REST route,
but the drift risk is now well-mitigated:

- **Type-enforced sites (2 of 5):** `handle()` and `invoke()` both derive their
  arg/return types from `ChannelMap`, so a wrong type in the registrar or preload
  fails `tsc`. This is the big #981 win and it works.
- **Snapshot-guarded site:** `tests/preload/preload-bridge.test.ts` catches a
  method added to `client.ts`/`ChannelMap` but *not* exposed in the preload
  bridge — the classic silent-failure this architecture is prone to. (Per the
  team's own memory: adding a `window.api` method requires updating this
  snapshot with `-u`.) Credit where due — this is exactly the right guardrail.
- **Validation test:** `tests/preload/typed-invoke-validation.test.ts` exercises
  the runtime validator path.
- **Remaining manual drift:** `ChannelMap` ↔ hand-authored `IdeApi` (M4), and
  the entire event surface (H2). These are the two seams a signature change can
  still slip through.

**The renderer data-flow rule** (components call `api.*` for reads only;
mutations route through stores/ops) is enforced by a `no-restricted-syntax`
denylist in `eslint.config.mjs:244` that enumerates mutation method names
(`writeFile|writeBinary|createFile|...`). As the architecture review noted (P1),
this is a **denylist that fails open**: a new mutation channel is *not* caught
until someone remembers to add its method name to the regex. This is an
API-governance DX gap — the rule protects the contract only as well as the
manually-maintained list. An allowlist (components may call only names ending in
read-ish patterns, or only names on an explicit read list) would fail closed, but
that is a larger change and is already tracked by the architecture review; noted
here only because it is genuinely an interface-governance concern.

**Discoverability** for the renderer consumer is otherwise strong: `window.api`
is one flat, namespaced, fully-typed object with rich JSDoc; autocomplete makes
the surface browsable without docs. The naming drift (M2/M3) is the main friction.

---

## Not Applicable (web-only template sections)

Each is genuinely inapplicable to a desktop Electron app; the IPC analogue (where
one exists) is named.

- **RESTful resource modeling / HTTP verbs / status codes** — N/A. No HTTP. The
  analogue is the `domain:verbNoun` channel convention (assessed above).
- **HATEOAS / hypermedia** — N/A. No hypertext API; the UI is the client and
  ships with the server.
- **Pagination for collections** — N/A. Local in-process calls return full
  result sets (e.g. `sources:listAll`, `tags:list`); the data lives on the same
  machine and is bounded by the thoughtbase size.
- **Authentication / authorization / OAuth** — N/A for the IPC boundary itself
  (context isolation + a fixed local peer is the boundary). Credential handling
  *does* exist but for outbound integrations only: `tool:getKeyStorage` /
  `tool:checkConnection` (LLM keys), `publish:checkGitHub` / `publish:checkS3`,
  and `sites:*` (privileged-site session cookies). Those are outbound-client
  concerns, not an inbound API auth surface.
- **Rate limiting / throttling / quotas** — N/A. No untrusted callers.
- **CORS / content negotiation** — N/A. No cross-origin requests; a strict CSP
  governs the renderer instead.
- **API gateway / SDK / developer portal / public docs** — N/A. Single internal
  consumer. `docs/authoring-skills.md` documents the *skills* extensibility
  surface, which is the closest thing to a public extension API.
- **Formal API versioning / deprecation policy** — N/A (see Versioning).
- **GraphQL** — N/A as a transport. The **SPARQL** surface (`graph:query`, with
  auto-injected prefixes) is the codebase's actual query-language interface and
  is assessed as a secondary internal API above.

---

## Secondary Internal APIs (briefly)

- **SPARQL (`api.graph.query`)** — standard prefixes auto-injected
  (`src/main/graph/state.ts`), so callers write terse queries; results are
  `{ results: unknown[]; columns: string[]; error? }`. The `unknown[]` results
  are inherent to SPARQL and acceptable; the in-band `error` field is the H1
  outlier. A good, discoverable internal query API.
- **Skills / tools registry (`src/shared/tools/`, `api.skills.*`)** — the real
  user-facing *extensibility* API: markdown skill files with YAML frontmatter,
  loaded from `~/.minerva/skills/`, documented in `docs/authoring-skills.md`.
  This is the one Minerva surface that behaves like a public API (third parties
  author against it), and it is appropriately file-based, additive (user skills
  can't shadow stock), and documented. No findings.
