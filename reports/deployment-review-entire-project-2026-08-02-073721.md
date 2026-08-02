# Deployment / Release-Engineering Review — Minerva

**Date:** 2026-08-02
**Scope:** Entire project — build → sign → notarize → package → publish → auto-update pipeline
**Reviewer:** Deployment specialist (analysis-only; no source or config modified)

---

## Critical framing: this is a distributed desktop app, not a service

Minerva is an Electron + electron-forge **desktop application** shipped to end
users' machines. There is **no server, no environments (dev/staging/prod), no
load balancer, no orchestrator, no database migrations, no uptime/SLA.** The
entire "zero-downtime / blue-green / canary / rolling / DR-failover" apparatus of
the generic deployment template is **Not Applicable** here — see the explicitly
labeled N/A block at the end of this report rather than fabricated content.

For a desktop app, "deployment" means:

> **build → code-sign → notarize/staple → package (DMG/ZIP) → publish a release
> artifact → ship an auto-update to users' machines.**

The desktop analogues of the template's concepts:

| Template concept | Desktop analogue in Minerva |
|---|---|
| Environments (dev/staging/prod) | OS/arch build matrix (macOS/Win/Linux × x64/arm64) |
| Zero-downtime deploy | Background auto-update that installs on next restart |
| Rollback | Publish a follow-up patch; auto-update rolls users forward |
| Health checks | Post-build signature verification + packaged-app e2e smoke |
| Progressive rollout / canary | Poll-interval trickle; draft→publish human gate |
| Deploy frequency / MTTR / CFR (DORA) | N/A — releases are tag-triggered, not continuous |

---

## Executive Summary

Minerva's release engineering is **mature and, for a solo/small-team desktop
app, well above average.** The single most important question this review was
asked to settle:

> **Is auto-update wired, or still the "Road to 1.0" gap?**
> **It is fully wired and shipped.** `src/main/auto-update.ts` drives
> `update-electron-app` against the hosted `update.electronjs.org` Squirrel.Mac
> feed, is initialized on launch (`src/main/main.ts:67`), has a custom
> non-hijacking UX (#963), a "Check for Updates…" menu item, and a test suite
> (`tests/main/auto-update.test.ts`). #662 is **done**, not pending.

The pipeline is a clean **tag → signed/notarized draft release → manual publish**
loop, with genuinely good secret hygiene (throwaway keychain, always-cleanup),
a blocking supply-chain audit gate on shipped deps, and a written runbook
(`docs/releasing.md`). The correctness invariants that matter for a desktop
updater — tag must equal `package.json` version, unsigned builds can't
auto-update, only *published* releases reach users — are all understood and
guarded.

The real, honest gaps are about **breadth and post-build verification**, not
about a missing core:

1. **Single-platform, single-arch.** The release workflow builds **macOS arm64
   only**, despite `forge.config.ts` declaring ZIP makers for `win32`/`linux`.
   No Windows/Linux/Intel artifacts are ever produced by CI. (High — but a
   deliberate, documented scope choice, #962.)
2. **No automated verification of the *signed* artifact before drafting.**
   The e2e smoke runs in `ci.yml` against an *unsigned, in-tree* package;
   `release.yml` never boots the DMG/ZIP it just signed, and the
   signature/notarization sanity check is a **manual** runbook step, not an
   automated gate. (High.)
3. **Release build re-installs deps uncached and doesn't re-run the CI gates.**
   Minor cost/robustness issues (Medium).

Bottom line: the core deploy machine is **boring, predictable, and reversible —
exactly the goal — on macOS arm64.** The improvement work is widening the matrix
and moving the "did the signed thing actually launch?" check from a human's eyes
into the workflow.

---

## Current Deployment Assessment (what the machinery actually does)

### Triggers

- **`ci.yml`** — on `push` to `main` and on every `pull_request`
  (`.github/workflows/ci.yml:15-18`). Concurrency-cancels superseded runs.
- **`release.yml`** — on `push` of a `v*` tag **or** `workflow_dispatch`
  (`.github/workflows/release.yml:32-35`). `workflow_dispatch` exercises the
  `make` path and uploads artifacts *without* cutting a release; a tag push
  *additionally* drafts a GitHub Release. Concurrency group keyed on the ref
  with `cancel-in-progress: false` (`:41-43`) — correct; you never want to
  cancel a release build midway.
- **`bench.yml`** — `workflow_dispatch` + weekly cron (`Mondays 06:00 UTC`),
  deliberately **not** on PR/push because micro-benchmarks flap on shared
  runners (`.github/workflows/bench.yml:19-27`).

### CI gates (`ci.yml`) — credit where due

- `lint-and-test` (macos-latest): `pnpm lint` (tsc + svelte-check + eslint) then
  `pnpm coverage` with **per-area coverage floors** enforced in vitest config
  for the trust/security paths (`ci.yml:62-71`).
- `e2e` (macos-latest, parallel): `electron-forge package` + Playwright smoke
  against the built app (`ci.yml:169-174`).
- `audit` (ubuntu): **`audit:prod` is blocking** (high+critical on shipped deps,
  `ci.yml:126-127`), `audit:all` visibility-only. Paired with Dependabot.
- `node_modules` caching keyed on lockfile+Node+OS/arch shared across jobs
  (`ci.yml:51-56`).

These are strong; the QA review covered test gates in depth, so this report does
not re-litigate them.

### Release pipeline (`release.yml`) — stage by stage

1. **Checkout + toolchain** — pnpm 10, Node from `.nvmrc`, `pnpm install
   --frozen-lockfile` (`:59-73`). Note: **no `node_modules` cache** here (unlike
   `ci.yml`), so every release re-installs cold.
2. **Prepare macOS signing** (`:81-119`) — only when `HAS_SIGNING` (the cert
   secret is present; the flag is hoisted to env because `secrets` can't be used
   in a step `if:`, `:56`). Decodes the P12 + App Store Connect `.p8` to files
   under `$RUNNER_TEMP`, imports the Developer ID identity into a **throwaway
   keychain**, sets the partition list, and exports `APPLE_API_KEY/_KEY_ID/
   _ISSUER` + `SIGNING_KEYCHAIN` via `$GITHUB_ENV`. Secrets are decoded to files,
   never echoed; the cert file is `rm`'d immediately after import.
3. **Build** — `pnpm build` = `electron-forge make` (`:121-122`), with
   `NODE_OPTIONS=--max-old-space-size=4096` to avoid OOM bundling the renderer +
   native deps. `forge.config.ts` then, per the env presence:
   - **signs** the `.app` with the hardened runtime + entitlements
     (`forge.config.ts:129-136`, `build/entitlements.mac.plist`),
   - **notarizes** via `osxNotarize` App Store Connect key (`:137-144`),
   - a **`postMake` hook notarizes + staples each produced DMG** (`:213-231`)
     — because the DMG maker wraps an already-stapled app but leaves the DMG
     wrapper itself un-stapled (would fail to open **offline** otherwise). This
     is a subtle, correct detail.
   - `afterPrune` ships the transitive closure of unbundleable native deps
     (DuckDB binding, domino, vega, sql.js, onnxruntime-web) and stages the
     headless CLI bundle (`forge.config.ts:25-102`).
4. **Collect artifacts** (`:124-141`) — copies `*.dmg`/`*.zip` out of
   `out/make`, and makes a **stable-named `Minerva-mac-arm64.dmg`** copy so the
   website can link to `releases/latest/download/Minerva-mac-arm64.dmg` (a URL
   that survives across releases). Clever and correct.
5. **Upload build artifacts** (`:143-148`) — `if-no-files-found: error` (good;
   a silent empty upload can't slip through).
6. **Publish draft Release** (`:153-159`) — **tag pushes only**;
   `softprops/action-gh-release` with `draft: true` and
   `generate_release_notes: true`. The draft is reviewed and published **by
   hand** (`gh release edit vX.Y.Z --draft=false --latest`).
7. **Clean up signing material** (`:163-167`) — `if: always()`; deletes the
   keychain + staged API key even on failure.

### Publish target & update feed

- **Publish target:** GitHub Releases (draft, then manually published).
- **Update feed:** `update.electronjs.org` (hosted Squirrel.Mac), inferred from
  `package.json` `repository`. There is **no self-generated `latest.yml`/
  `RELEASES` file** — that's correct for this stack; the hosted feed derives the
  feed from the published GitHub Release's `.zip` asset. **The `.zip` is the
  auto-update payload** (the DMG is the human download); the runbook explicitly
  warns not to remove it (`docs/releasing.md:77-78`).

### Versioning & release management

- `package.json` `version` (`1.0.0`) is the single source of truth for both the
  DMG name and the updater's version comparison.
- `pnpm release:tag` (`scripts/tag-release.mjs`) enforces: version is semver,
  branch is `main`, working tree clean, tag doesn't already exist, and `vX.Y.Z`
  equals `package.json` version — because a tag↔version mismatch means the
  updater never offers the build.
- Release notes: `generate_release_notes: true` (commit/PR-derived). **No
  hand-maintained `CHANGELOG.md`** — a deliberate choice documented at
  `docs/releasing.md:125-128`.
- Existing tags: `v0.1.1, v0.1.2, v0.3.0, v1.0.0`.

---

## Deployment Process Findings

### Critical

*None.* No finding rises to release-blocking. The core sign/notarize/publish/
update loop is present, correct, and documented.

### High

**H-1 — macOS-arm64-only distribution; declared Win/Linux makers never fire.**
`forge.config.ts:173` declares `new MakerZIP({}, ['darwin','linux','win32'])`,
but `release.yml` has a single `build-macos` job on `runs-on: macos-latest`
(`release.yml:47`) with no build matrix. `electron-forge make` on a macOS runner
produces **only the host platform**, so Windows and Linux ZIPs are never built,
and there is **no Windows `MakerSquirrel`** (grep confirms none) — meaning even
if a Windows build were produced, there'd be no Windows auto-update channel.
Effect: Minerva ships to **macOS Apple Silicon only**. Intel/universal is
explicitly deferred (`docs/releasing.md:29-30`, #962). This is a scope decision,
not a bug — but the *declared-vs-built* gap is a latent trap: the config implies
three platforms while CI delivers one. **Recommendation:** either (a) narrow the
maker list to `['darwin']` to match reality, or (b) add a build matrix
(`macos-latest` arm64/x64 + `windows-latest` + `ubuntu-latest`) with a
`MakerSquirrel` for Windows auto-update, if cross-platform is on the roadmap.
Until then, keep the divergence documented.

**H-2 — The *signed* release artifact is never smoke-tested by the workflow.**
The Playwright e2e (`ci.yml:169-174`) runs against `electron-forge package` —
an **unsigned, in-tree** bundle — on PRs. `release.yml` builds, signs,
notarizes, staples, uploads, and drafts **without ever launching the DMG/ZIP it
produced.** The signature/notarization sanity check (`spctl -a`, `codesign -dv`)
is a **manual** step in the runbook (`docs/releasing.md:79-84`). A signing/
notarization/stapling regression, or a packaging breakage that only manifests in
the *signed* artifact, would reach the draft and rely entirely on a human
remembering to run `spctl`. **Recommendation:** add a post-make gate to
`release.yml` that (1) runs `spctl -a -t open --context context:primary-signature`
and `codesign --verify --deep --strict` on the DMG and fails the job on
rejection, and (2) mounts/launches the packaged app for a headless smoke boot
(or at least `xcrun stapler validate`). This is the desktop equivalent of a
post-deploy health check.

### Medium

**M-1 — Release build re-installs deps cold and skips the CI gates.**
`release.yml` has no `node_modules` cache (contrast `ci.yml:51-56`), so each
release pays a full cold `pnpm install`. More importantly, the release job runs
**no lint/test/audit** — it trusts that the tagged commit already passed CI on
`main`. That trust is *mostly* sound (`tag-release.mjs` requires a clean `main`),
but a tag can be pushed to any commit, and `main`'s CI could have been bypassed.
**Recommendation:** either make `release.yml` `needs:` a reusable CI job, or add
a lightweight `pnpm lint && pnpm audit --prod --audit-level=high` pre-flight step
before the expensive build. Add the same `node_modules` cache key as `ci.yml`.

**M-2 — Update delivery has a single hosted dependency with no integrity check
on the published asset.** Auto-update relies wholly on `update.electronjs.org`
being reachable; if it's down, updates silently stall (non-fatal — handled by the
`error` state, `auto-update.ts:122-132`). Separately, nothing in `release.yml`
asserts that the **`.zip` asset** (the auto-update payload) is actually attached
before/after publish — the runbook asks a human to eyeball it
(`docs/releasing.md:77`, `:107-109`). A DMG-only release would silently break
auto-update. **Recommendation:** add a workflow assertion that both a `.dmg` and
a `.zip` are present in `dist-artifacts` (the `find` already runs; just fail if
either is missing), mirroring the existing `if-no-files-found: error`.

**M-3 — No published checksums for the website (stable-named) download.**
Auto-update integrity is covered by Squirrel signature verification, but the
website's `Minerva-mac-arm64.dmg` direct download has no published SHA-256 for
manual verification. Low-severity for a notarized DMG (Gatekeeper covers
tampering), but a `shasum -a 256` artifact is cheap defense-in-depth.

### Low

- **L-1** — `draft: true` is hardcoded with a comment to "flip to `false` once
  trusted" (`release.yml:151-158`). Keeping the human publish gate is *correct*
  for a desktop app (it's the last line of defense before users, per
  `docs/releasing.md:16`); recommend **keeping it draft** and treating the
  comment as stale guidance rather than a to-do.
- **L-2** — `upload-artifact@v7` in `release.yml` vs `@v4` in `bench.yml`
  (`bench.yml:65`) — harmless version drift worth aligning.
- **L-3** — No SBOM generation. Optional for a desktop app; `pnpm audit`
  substitutes for the runtime-CVE need.

---

## Improvement Plan (prioritized, with real estimates)

| # | Item | Effort | Priority |
|---|---|---|---|
| H-2 | Automated signature/notarization verification gate in `release.yml` (`spctl` + `codesign --verify` + `stapler validate`, fail on reject) | **0.5 day** | Highest ROI — catches the failure the whole pipeline exists to prevent |
| M-2 | Assert `.dmg` **and** `.zip` present before drafting (fail otherwise) | **1–2 hrs** | High — protects the update channel |
| M-1 | Add `node_modules` cache + a lint/audit pre-flight (or `needs: ci`) to `release.yml` | **0.5 day** | Medium |
| H-2b | Headless smoke-boot of the packaged app in `release.yml` (reuse the Playwright e2e harness against the *made* artifact) | **1–2 days** | Medium |
| H-1 | Decide cross-platform posture: either narrow makers to `['darwin']` (30 min) **or** add a full build matrix + Windows `MakerSquirrel` + auto-update channel | **30 min** _or_ **3–5 days** | Medium — scope decision |
| M-3 | Publish `SHA-256` alongside the stable DMG | **1 hr** | Low |
| L-2 | Align `upload-artifact` versions | **10 min** | Low |

---

## Automation Opportunities

- **Build caching (M-1):** the release job is the one place *without* the shared
  `node_modules` cache; adding it saves minutes per release.
- **Build matrix (H-1):** the cleanest lever if multi-platform is desired — one
  `strategy.matrix` over `{os, arch}` replaces the single `build-macos` job and
  naturally fans artifacts into the same draft.
- **Version bump automation:** currently a hand-edit of `package.json` in a
  release PR (`docs/releasing.md:44-50`). A `release-please`-style bot or a
  `pnpm version` script could automate the bump + tag + changelog, though the
  current manual-bump-then-`pnpm release:tag` flow is already low-friction and
  well-guarded. Marginal ROI for a low release cadence.
- **Changelog:** `generate_release_notes: true` already auto-derives per-release
  notes; a curated top-section is manual by design. Adequate.
- **Publish assertion:** the `find` in "Collect artifacts" can double as an
  automated invariant (M-2) instead of a runbook eyeball.

---

## Release Management (what exists vs. gaps)

**Exists (strong):**
- Semver single-source-of-truth in `package.json`, guarded tag creation
  (`scripts/tag-release.mjs`) enforcing tag↔version parity, clean-`main`,
  no-duplicate-tag.
- Auto-generated GitHub release notes.
- A written, accurate runbook (`docs/releasing.md`) covering the full loop,
  verification commands, rollout timing, and the "if something's wrong" path;
  plus `docs/packaging.md` for one-time secret setup.
- Stable-named artifact for a durable website download URL.

**Gaps:**
- No `CHANGELOG.md` (deliberate; acceptable).
- Draft→publish is fully manual (deliberate and correct; it's the human review
  gate — the runbook calls Publish "the load-bearing step").
- DORA-style metrics (deploy frequency, lead time, MTTR, change-failure-rate)
  are **N/A/unknown** — a desktop app releases on tags, not continuously; the
  meaningful signal is "did the signed artifact launch on a clean machine," not
  a deploy-frequency dashboard.

---

## Security Integration

**Strong, and a highlight of the pipeline:**

- **Code signing** — Developer ID Application, hardened runtime, entitlements
  scoped to real needs (JIT for V8, library-validation-off *only* because
  third-party DuckDB `.node` binaries aren't team-signed, mic for dictation)
  — `build/entitlements.mac.plist`, `forge.config.ts:129-136`.
- **Notarization + stapling** — app via `osxNotarize` (`:137-144`) **and** the
  DMG wrapper via the `postMake` hook (`:213-231`), closing the offline-open gap.
- **Secret handling in CI** — throwaway keychain with a random password, secrets
  decoded to `$RUNNER_TEMP` files and **never echoed**, cert file deleted right
  after import, and an `if: always()` cleanup step that removes the keychain +
  key material even on failure (`release.yml:81-119`, `:163-167`). Presence-gated
  so forks build unsigned rather than erroring. This is textbook.
- **Supply-chain gate** — `audit:prod` **blocking** on shipped deps (`ci.yml:
  126-127`) with a documented remediation history via `pnpm.overrides`; Dependabot
  paired. `audit:all` visibility-only with a clear promotion path.
- **Fallback safety** — a secretless build produces an *unsigned* app rather than
  failing, and the runbook correctly notes an unsigned build **can't**
  auto-update (Squirrel.Mac rejects it) — so there's no risk of shipping an
  unverifiable auto-update.

**Minor:** no published artifact checksums (M-3); the release build doesn't
re-run the audit gate (M-1). Neither is a real exposure given notarization.

---

## Risk Mitigation (bad-release recovery / rollback)

Rollback for a desktop app is fundamentally **forward-only**, and Minerva's
strategy is the right one and is documented (`docs/releasing.md:130-136`):

- **Before users are affected:** the release is a **draft**; a bad draft is
  deleted (and the tag with `git push origin :vX.Y.Z`), fixed, re-tagged.
  **Nothing reached users.** The draft review (step 4, incl. signature check) is
  the primary safety gate.
- **After publish:** there is **no un-ship** — the recovery is a **follow-up
  patch release**, and auto-update rolls users forward within the poll interval
  (hourly + on launch, `auto-update.ts:76`). This is the correct and only real
  model for Squirrel-based desktop auto-update.
- **Update-apply safety:** `quitAndInstall` triggers app quit → the `before-quit`
  flush in `main.ts` → Squirrel swaps the bundle and relaunches
  (`auto-update.ts:180-184`), so in-flight work is saved before the swap.
- **Updater robustness:** the updater is inert in dev (`!app.isPackaged`), and
  **any** setup/runtime error is swallowed with a warning — "a broken updater
  must never crash the user's app on launch" (`auto-update.ts:68-82`,
  `:122-132`). End-to-end apply was verified across two real releases (#961).

**Residual risks & mitigations:**
- A bad *published* build has a blast radius bounded only by how fast a patch can
  be cut and by the manual draft-review discipline — **strengthening H-2
  (automated signed-artifact verification) is the highest-value mitigation**,
  because it prevents the class of "the signed thing was broken" bugs that the
  manual `spctl` step is meant to catch.
- No staged/percentage rollout — every published release goes to 100% of pollers.
  For this app's scale that's acceptable; if the user base grows, a
  percentage-gated feed (self-hosted) would be the canary analogue.

---

## Not Applicable (web-service template sections)

These template sections assume a server/service and have **no meaning** for a
distributed desktop app. Listed honestly with the desktop analogue rather than
fabricated content:

- **Zero-downtime deployment** — N/A. Analogue: background auto-update that
  applies on next app restart; user's work is flushed on quit.
- **Blue-green deployment** — N/A. There is no running fleet to swap between.
- **Canary deployment / progressive rollout** — N/A. Analogue: hourly poll
  trickle + the draft→publish human gate; no percentage-gated feed today.
- **Environments (dev/staging/prod)** — N/A. Analogue: the OS/arch build matrix
  (currently macOS arm64 only).
- **Load balancer / traffic shifting** — N/A. No inbound traffic.
- **Disaster recovery / failover site** — N/A. Analogue: forward-only recovery
  via a follow-up patch release; user data lives on the user's disk (backup is a
  user concern, not a deploy concern).
- **Database migrations** — N/A. The knowledge graph is a local `.minerva/
  graph.ttl` re-indexed on write; there is no shared server DB to migrate on
  deploy.
- **GitOps / cluster reconciliation / container image scanning** — N/A. No
  containers, no cluster. Analogue for image scanning: `pnpm audit` on the
  shipped dependency tree.
- **Uptime/SLA/DORA metrics** — N/A. Releases are tag-triggered, not continuous;
  deploy-frequency/MTTR/CFR don't apply. The meaningful signal is
  "signed artifact launches cleanly + auto-update applies."

---

## Appendix — Files reviewed

- `/Users/davegriffith/minerva/.github/workflows/ci.yml`
- `/Users/davegriffith/minerva/.github/workflows/release.yml`
- `/Users/davegriffith/minerva/.github/workflows/bench.yml`
- `/Users/davegriffith/minerva/.github/dependabot.yml` (referenced)
- `/Users/davegriffith/minerva/forge.config.ts`
- `/Users/davegriffith/minerva/build/entitlements.mac.plist`
- `/Users/davegriffith/minerva/.githooks/pre-push`
- `/Users/davegriffith/minerva/package.json`
- `/Users/davegriffith/minerva/scripts/tag-release.mjs`
- `/Users/davegriffith/minerva/src/main/auto-update.ts`
- `/Users/davegriffith/minerva/src/main/main.ts` (init site)
- `/Users/davegriffith/minerva/docs/releasing.md`
- `/Users/davegriffith/minerva/docs/packaging.md` (referenced)
