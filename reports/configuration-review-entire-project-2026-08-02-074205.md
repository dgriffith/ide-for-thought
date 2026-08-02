# Configuration Management Review — Minerva

**Scope:** Entire project (`/Users/davegriffith/minerva`)
**Date:** 2026-08-02
**Reviewer:** Configuration management review (analysis-only; no files modified except this report)
**Subject:** Minerva — local, single-user desktop app (Electron + Svelte 5 + TypeScript)

---

## Executive Summary

Minerva is a **local, single-user desktop application**, not a deployed multi-environment
service. There is no dev/staging/prod topology, no `.env` deployment files, no cloud secret
vault, and no config server. Accordingly, most of a conventional "environment configuration"
audit is **Not Applicable** (see the dedicated block near the end). The meaningful
configuration surface is: (1) per-machine + per-project **app settings**, (2) **secrets
handling** for the user's LLM API keys and publish credentials, (3) **build/tooling config**,
and (4) **defaults / feature toggles** (model defaults, skills menu enable/disable).

**Headline finding — secrets are handled well.** The user's Anthropic/LLM API key is
**encrypted at rest** via Electron `safeStorage` (OS Keychain / DPAPI / libsecret), stored in
`~/Library/Application Support/<app>/llm-settings.json`, **decrypted only on the API-call path
in the main process, and never crosses IPC to the renderer, never logged, and never written
into the graph or notes.** Publish credentials (S3 secret access key, GitHub token) are
encrypted into a **gitignored** `.minerva/secrets.json` that is deliberately split from the
shareable `.minerva/config.json`. Build/release secrets in `.github/workflows/release.yml` use
GitHub Actions secrets, a throwaway keychain, files never echoed, and always-on cleanup. No
hardcoded secret literals exist anywhere in the tree. This is a strong posture.

**No Critical or High findings.** The residual items are Medium/Low maturity gaps: there is no
formal config **schema** (validation is hand-rolled per file) and no config **version field**
(migrations are ad-hoc shape-sniffing). Both work correctly today but will not scale gracefully
as config shapes evolve.

**Overall configuration risk: LOW.**

---

## Configuration Findings

### Critical
None.

### High
None. (Specifically: the user's LLM API key is encrypted at rest, not plaintext — the one
finding that would have been High if present is absent.)

### Medium

**M1 — No centralized configuration schema / validation; each config file re-implements its own tolerant reader.**
Every config module hand-rolls validation with `resolve*` helpers and `typeof` guards rather
than a shared schema (e.g. zod/valibot). Examples: `src/main/llm/settings.ts:28-80`
(`resolveModel`, `resolveWeb`, `resolveEffortSetting`, `resolveCustomModels`,
`resolveToolModelOverrides`), `src/main/clipper/clipper-config.ts:38-52`,
`src/main/project-config.ts:124-133`, `src/shared/skills/menu-config.ts:39` (`normalizeMenuConfig`).
The behavior is individually correct and defensively coded (corrupt/missing files fall back to
defaults instead of crashing — good), but the pattern is duplicated across ~10 files, inviting
drift and making "what is the valid shape of this file?" impossible to answer in one place.
**Impact:** maintainability, not security. **Effort to consolidate:** ~1–2 days.

**M2 — No config version field anywhere; schema migrations rely on ad-hoc shape-sniffing.**
None of `llm-settings.json`, `clipper-config.json`, `menu-config.json`, or project
`config.json` carry a `configVersion`/`schemaVersion`. Migrations are currently inferred from
the data shape: legacy top-level `apiKey` → `providers.anthropic.apiKey`
(`src/main/llm/settings.ts:132-136`), inline `secretAccessKeyEnc`/`githubTokenEnc` →
`secrets.json` (`src/main/project-config.ts:246-266`), plaintext → `enc:v1:` on next write
(`src/main/secret-storage.ts:73-82`). These specific migrations are well done, but the general
approach doesn't scale: a future ambiguous shape change (two migrations keying off the same
field) has no version to disambiguate. **Impact:** future maintainability. **Effort:** ~1 day
to introduce a version field + a small migration runner; low urgency.

### Low

**L1 — Silent degradation to plaintext when `safeStorage` is unavailable.**
`src/main/secret-storage.ts:54-64` returns plaintext when OS encryption is unavailable (e.g.
Linux with no keyring). This is a **deliberate, documented** trade-off ("encryption at rest is
a hardening measure, not a boundary that should ever cost the user their API key") and the app
**does** surface the true state to the UI via `secretEncryptionAvailable()` and
`getApiKeyStorage()` (`src/main/secret-storage.ts:45-47`, `src/main/llm/settings.ts:275-284`),
so the settings panel can tell the user the truth. Acceptable as designed; flagged only so it's
a conscious posture. **No action required.**

**L2 — Legacy plaintext secrets re-encrypt lazily, only on the next write.**
A pre-#1326 plaintext key/secret in `llm-settings.json` or `clipper-config.json` is returned
verbatim and stays plaintext on disk until its config is next saved
(`src/main/secret-storage.ts:9-11,73-76`; `src/main/clipper/clipper-config.ts:46-48`).
Backward-compatible and intentional, but a user who set their key long ago and never re-saves
retains a plaintext key indefinitely. **Optional hardening:** opportunistically re-encrypt on
read. **Effort:** ~1–2 hours. Low priority.

**L3 — `patchProjectConfig` shallow-merges: top-level keys are replaced wholesale.**
`src/main/project-config.ts:140-145` documents this as intentional ("none of the current
consumers want a deep merge"). Correct today, but a footgun for a future writer that patches a
nested object expecting a deep merge (it would clobber sibling keys). Each nested writer
currently guards this by reading-then-spreading the existing sub-object (e.g.
`setOnboardingDismissed` at `:181-184`). Flag for awareness; **no action required** while the
convention holds.

**L4 — Per-machine config files are scattered across three roots with bespoke helpers.**
Config lives under (a) `app.getPath('userData')` — `llm-settings.json`, `clipper-config.json`,
`python-settings.json`, `ingest-settings.json`, `recent-projects.json`, `privileged-sites.json`,
`session.json`, `compute-audit.jsonl`, plus `queries/` and `views/` dirs; (b) `~/.minerva/` —
`menu-config.json`, `skills/`; (c) `<project>/.minerva/` — `config.json`, `secrets.json`,
`graph.ttl`. Each has its own read/write helper. This is coherent (per-machine vs per-project
is a real distinction) but there's no single registry documenting the full inventory. **Impact:**
discoverability. Consider a short `docs/configuration.md` inventory. **Effort:** ~2 hours.

---

## Current State Analysis

### Configuration file inventory

**Per-machine app settings — `app.getPath('userData')`** (macOS: `~/Library/Application Support/<app>/`):

| File | Purpose | Module | Secrets? |
|------|---------|--------|----------|
| `llm-settings.json` | LLM provider keys (encrypted), model, effort, web settings, custom models, per-skill overrides | `src/main/llm/settings.ts:82-83` | **Yes — encrypted** |
| `clipper-config.json` | Browser-clipper enable flag + shared secret (encrypted) | `src/main/clipper/clipper-config.ts:30-31` | **Yes — encrypted** |
| `python-settings.json` | Compute: python path, allow-network | `src/main/compute/python-settings.ts:52` | No |
| `ingest-settings.json` | Source ingest prefs | `src/main/sources/ingest-settings.ts:25` | No |
| `recent-projects.json` | MRU project paths | `src/main/recent-projects.ts:6` | No |
| `privileged-sites.json` | Per-site login config | `src/main/privileged-sites.ts:23` | Session-scoped |
| `session.json` | Window/session restore | `src/main/session.ts:13` | No |
| `compute-audit.jsonl` | Compute consent audit log | `src/main/compute/audit.ts:52` | No |
| `queries/`, `views/` | Saved SPARQL queries / views | `src/main/saved-queries.ts:22`, `saved-views.ts:17` | No |

**Per-machine, home dir — `~/.minerva/`:**
- `menu-config.json` — skills menu enable/disable/reassign/order (`src/main/skills/menu-config-store.ts:19-21`). Loaded once into a module cache; missing/corrupt → defaults, non-fatal (`:31-46`). Validated by `normalizeMenuConfig` on read and write (`:53`).
- `skills/` — user-authored skill `.md` files (additive; cannot shadow stock skills).

**Per-project — `<thoughtbase>/.minerva/`:**
- `config.json` — `baseUri`, `displayName`, `bibliography.styleId`, onboarding state, excerpt note folder, **non-secret** publish target fields (`src/main/project-config.ts:14-47`). Travels with the thoughtbase.
- `secrets.json` — **encrypted** publish credentials (S3 secret, GitHub token), keyed by target id (`src/main/project-config.ts:205-239`). **Gitignored** via a Minerva-owned `.minerva/.gitignore` written automatically (`:218-228,236`) so it never rides along in a git-backed/shared thoughtbase.
- `graph.ttl` + indexes — derived, regenerated on open.

### Secrets-management assessment (the crux)

**Mechanism — Electron `safeStorage` with a versioned prefix.** `src/main/secret-storage.ts`
is the single at-rest encryption chokepoint. Values are wrapped with `safeStorage`
(Keychain/DPAPI/libsecret) and tagged `enc:v1:` (`:25,54-64`). Decrypt transparently handles
both encrypted and legacy-plaintext forms (`:73-82`). If OS encryption is unavailable it
degrades to plaintext rather than losing the key (`:56`, see L1).

**LLM/Anthropic API key — ENCRYPTED at rest, and never leaves main:**
- Stored encrypted in `llm-settings.json`; written via `encryptSecret` in `applyCredsUpdate` (`src/main/llm/settings.ts:226`).
- Decrypted **only** on the API-call path (`getSettings` → `decryptProviders`, `src/main/llm/settings.ts:147-158,177-190`).
- The renderer/settings UI path is a **separate** function `getSettingsForDisplay` that **never decrypts** — it returns model/effort and boolean presence flags only (`src/main/llm/settings.ts:200-218`). The IPC handlers confirm this: `TOOL_GET_SETTINGS → getSettingsForDisplay()` and `TOOL_GET_KEY_STORAGE → getApiKeyStorage()` (`src/main/ipc/register-tools.ts:95,99`). **The plaintext key never crosses the IPC bridge to the renderer.**
- **Never logged:** a grep for `console.*` with key/secret/token found only one hit — an error log that prints an exception, not a secret (`src/renderer/lib/components/SettingsDialog.svelte:377`).
- **Never in localStorage:** grep for `localStorage` + secret terms found none.
- **Never in the graph/notes:** keys live only in `userData` JSON, not in `graph.ttl` or note bodies.
- Env fallback (`ANTHROPIC_API_KEY` etc.) applies only when no key field is stored (`src/main/llm/settings.ts:139-142,151`).

**Publish credentials (S3 secret access key, GitHub token) — ENCRYPTED, split, write-only over the wire:**
- Encrypted into gitignored `.minerva/secrets.json`, never in the shareable `config.json` (`src/main/project-config.ts:49-56,205-239`).
- Wire contract is **write-only + tri-state**: a string sets (encrypted), `''` clears, omitted keeps; the read path returns only `hasSecret`/`hasToken` presence flags, never the credential (`src/main/project-config.ts:268-273,313-333`). Decrypted only main-side at push time (`getS3Credentials` `:289-298`, `getGitCredentials` `:305-311`).
- Git token precedence: stored encrypted token → `gh auth token` CLI → `GH_TOKEN`/`GITHUB_TOKEN` env (`src/main/git/publish-git.ts:52-66,89`). Sent as an `Authorization: Bearer` header to GitHub only (`:95`).

**Clipper shared secret — ENCRYPTED at rest:** 64-hex secret generated via `crypto.randomBytes`,
encrypted on disk, held plaintext in memory only for the loopback constant-time compare
(`src/main/clipper/clipper-config.ts:34,54-59`).

**No hardcoded secret literals:** grep for `sk-ant-…`, `ghp_…`, `AKIA…`, and PEM private-key
headers across `src/`, `scripts/`, and root configs returned **nothing**.

**Build/release secrets (cross-check of the deployment review — CONFIRMED clean):**
`.github/workflows/release.yml` — Apple signing/notarization creds are GitHub Actions secrets
(`APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_BASE64`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`), presence-gated via a hoisted `HAS_SIGNING` env flag
(secretless forks build unsigned). Secrets are base64-decoded to files under `$RUNNER_TEMP`,
**never echoed**; the cert file is `rm`'d immediately after import; a throwaway keychain holds
the identity and is deleted in an `if: always()` cleanup step so material never lingers on a
reused runner. `ci.yml` uses `CODECOV_TOKEN` via `secrets`. This matches the prior deployment
review's conclusion — verified independently, confirmed clean.

**`.gitignore` — the `.minerva/` dotdir trap is handled correctly.** The global `.minerva/`
ignore is present, and the negation patterns re-include exactly the bundled thoughtbase payloads
that must ship (`tests/fixtures/sample-project/.minerva/sources|excerpts`,
`tests/skills-eval/thoughtbase/.minerva/sources|excerpts`,
`resources/tutorial-thoughtbase/.minerva/config.json|sources|excerpts`) while keeping
regenerated indexes and `graph.ttl` ignored. No user `userData` path or key material is at risk
of being committed; no `.env` files are tracked. This addresses the known dotdir-gitignore trap.

### Environment strategy

**N/A — local desktop app.** There is no dev/staging/prod environment matrix. The nearest
analogue is the Vite/Electron dev-vs-packaged distinction (HMR dev server vs. built bundle,
handled by electron-forge + `MAIN_WINDOW_VITE_DEV_SERVER_URL`), and per-machine vs per-project
config scoping — both already cleanly separated.

### Build / tooling configuration

Organized and consistent: `forge.config.ts` (packaging/signing), `vite.main.config.ts` /
`vite.preload.config.ts` / `vite.renderer.config.mts` / `vite.cli.config.ts` (per-target
builds), `vitest.config.mts` / `vitest.bench.config.ts`, `eslint.config.mjs` (which enforces the
renderer data-flow rule via `no-restricted-syntax`), `tsconfig*.json`, `.nvmrc`, `.npmrc`. The
CSP is centralized (`src/main/security.ts:46-52`, `buildCsp` in `security-helpers.ts`) and
applied via `onHeadersReceived`. Renderer hardening is correct: `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true` (`src/main/security.ts:40-42`). No secrets or
environment-specific literals in build configs.

---

## Configuration Security Issues

1. **At-rest encryption of user secrets:** PRESENT and correct (`safeStorage`, `enc:v1:` tag). No issue.
2. **Secret exposure across the IPC boundary:** NONE — display path never decrypts; call path is main-only.
3. **Secret leakage to logs / graph / notes / localStorage:** NONE found.
4. **Secrets in a shareable/committed file:** MITIGATED — publish creds split into gitignored `secrets.json`; `.gitignore` negation patterns verified; no `.env` tracked; no hardcoded literals.
5. **Build/release secret handling:** CLEAN — GitHub secrets, throwaway keychain, no echo, always-on cleanup.
6. **Residual:** plaintext fallback when OS keyring absent (L1, surfaced to UI) and lazy re-encryption of legacy plaintext (L2). Neither is a live exposure.

---

## Improvement Plan

| ID | Item | Priority | Effort | Type |
|----|------|----------|--------|------|
| M1 | Centralize config validation behind a shared schema layer (zod/valibot), replacing per-file `resolve*` guards | Medium | 1–2 days | Maintainability |
| M2 | Introduce a `configVersion` field + a small migration runner for the JSON config files | Medium | ~1 day | Maintainability |
| L2 | Opportunistically re-encrypt legacy plaintext secrets on read | Low | 1–2 hrs | Hardening |
| L4 | Add `docs/configuration.md` inventorying all config file locations, shapes, and defaults | Low | ~2 hrs | Docs |
| L1/L3 | No action — documented, conscious trade-offs; keep as-is | — | — | — |

---

## Environment Management Recommendations

- **Secrets:** No change to the storage mechanism — `safeStorage` + versioned prefix is the
  right call for a desktop app. Optionally implement L2 (lazy re-encrypt on read) and consider
  a one-line note in the settings UI when `secretEncryptionAvailable()` is false (the data is
  already exposed via `getApiKeyStorage`; ensure the panel actually renders it).
- **Organization:** The per-machine (`userData` + `~/.minerva`) vs per-project (`.minerva/`)
  split is sound. The only gap is discoverability — address with L4.
- **Validation:** Adopt a single schema library and route every config read through it (M1).
  This also gives you free, uniform migration hooks, which pairs naturally with M2.

---

## Risk Assessment

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Secret storage at rest | **Low risk** | Encrypted via OS keychain; graceful, surfaced degradation |
| Secret exposure (IPC / logs / graph / VCS) | **Low risk** | Verified no leakage; display path never decrypts |
| Build/release secret handling | **Low risk** | GitHub secrets, throwaway keychain, cleanup on always |
| Config validation robustness | **Low–Medium risk** | Tolerant readers prevent crashes, but no shared schema |
| Config migration/versioning | **Medium risk (future)** | Ad-hoc today; no version field to disambiguate future changes |
| Config organization/discoverability | **Low risk** | Coherent scoping; lacks a central inventory doc |
| **Overall** | **LOW** | Strong secrets posture; residual items are maturity, not exposure |

---

## Implementation Roadmap

- **Now (optional, small):** L2 re-encrypt-on-read (1–2 hrs); L4 config inventory doc (2 hrs);
  verify the settings panel surfaces the `available:false` state.
- **Next quarter (as config churns):** M1 shared schema layer (1–2 days), landing per config
  module behind the existing `resolve*` call sites so behavior is preserved test-by-test.
- **Alongside M1:** M2 config version field + migration runner (~1 day) — cheapest to add while
  touching the readers for M1.
- **No action:** L1, L3 (documented intentional trade-offs).

Total discretionary effort to close every non-"no-action" item: **~3–4 days.**

---

## Compliance Checklist (checked against reality)

- [x] **Secrets stored securely (never in code):** Encrypted via `safeStorage`; no hardcoded literals; build secrets via GitHub Actions secrets.
- [x] **Secrets never logged / exposed:** No secret in logs, graph, notes, localStorage, or over IPC.
- [x] **Environment-specific settings separated:** Per-machine vs per-project scoping is clean. (Dev/staging/prod: N/A — desktop app.)
- [x] **Configuration validated on load:** Yes — tolerant `resolve*`/`normalize*` readers with default fallbacks; corrupt files don't crash startup.
- [~] **Configuration schema:** Hand-rolled per file; no shared/formal schema (M1).
- [x] **Feature flags / toggles implemented:** Model defaults (`DEFAULT_MODEL = 'claude-opus-5'`, `src/shared/tools/models.ts:19`; `DEFAULT_EFFORT = 'medium'`, `effort.ts:37`), skills menu-config enable/disable, web-tools enable, clipper enable, compute allow-network.
- [x] **Sensible defaults:** Yes — every config module ships explicit defaults (e.g. `DEFAULT_CLIPPER_CONFIG`, `DEFAULT_WEB_SETTINGS`, `emptyMenuConfig()`).
- [~] **Migration path clear:** Specific migrations exist and are well done; no general version field (M2).
- [x] **Rollback / no-lockout on secrets:** Encryption failures degrade to plaintext rather than losing the key; corrupt config → defaults.
- [~] **Documentation comprehensive:** Modules are well-commented, but no single config inventory doc (L4).
- [x] **Config files versioned in VCS where appropriate:** Build/tooling configs tracked; user secrets/`userData` correctly gitignored; bundled thoughtbase payloads allowlisted via negation patterns.
- [x] **Hot reload where sensible:** Menu-config reloads into cache on save; skills reloadable; dev HMR via Vite. (Server-config hot reload: N/A.)

Legend: [x] met · [~] partially met / improvement identified.

---

## Not Applicable (server / multi-environment template sections)

Minerva is a local single-user Electron desktop app. The following standard configuration-review
sections do not apply; each notes the desktop analogue actually reviewed above:

- **Dev/staging/prod environment matrix & parity** — N/A. Analogue: dev (Vite HMR) vs packaged build; per-machine vs per-project config scoping.
- **`.env` / dotenv deployment files** — N/A. Analogue: `userData` JSON configs; env vars used only as optional fallbacks (`ANTHROPIC_API_KEY`, `GH_TOKEN`).
- **Cloud secret vault / secret manager (AWS Secrets Manager, Vault, etc.)** — N/A. Analogue: OS keychain via Electron `safeStorage`.
- **Config server / centralized dynamic config (Consul, Spring Cloud Config, feature-flag service)** — N/A. Analogue: local JSON + menu-config.
- **12-factor server configuration** — N/A for a desktop binary.
- **Horizontal-scaling / multi-instance config consistency** — N/A (single local process).
- **Server config hot-reload / rolling restarts** — N/A. Analogue: menu-config/skills reload, Vite HMR.
- **Multi-region / infra-as-code config (Terraform, Helm, k8s ConfigMaps)** — N/A.
- **CDN / load-balancer / TLS-cert config** — N/A (the app is not a served endpoint; the only server-ish surface is the opt-in loopback clipper, which uses a shared-secret compare and is off by default).

---

*Analysis-only review. No source or configuration files were modified. All findings cite `file_path:line`.*
