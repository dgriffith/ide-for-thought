# Config roots

Minerva's configuration lives in three roots with different scopes and lifetimes.
This is the inventory (#1642) — they're otherwise scattered, and secrets sit in
all three.

## 1. `userData/` — per **machine**

`app.getPath('userData')` (macOS: `~/Library/Application Support/Minerva/`).
Machine-/OS-user-scoped settings that don't belong to any one thoughtbase.

This table is checked against the code by
`tests/architecture/config-roots-doc.test.ts` (#1853): every
`app.getPath('userData')` call site in `src/main/**` must name a file or folder
listed here. Adding a config without documenting it fails a test.

| File | Holds |
|---|---|
| `llm-settings.json` | LLM providers, model, effort, web settings. **API keys are encrypted** at rest via `safeStorage` (`enc:v1:` prefix). |
| `clipper-config.json` | Browser-clipper enable flag + the loopback **shared secret (encrypted)**. |
| `mcp-oauth-tokens.json` | Per-server OAuth 2.1 tokens for remote MCP servers (#2030), keyed by the server's canonical URL. **Access/refresh tokens (and client secret, if issued) encrypted** at rest. |
| `mcp-tool-permissions.json` | MCP tools the user chose "Don't ask again" for in the `mcp_call` confirmation card (#2439). Keyed by a SHA-256 of the server's connection config (stdio command/args/env/cwd, or the remote URL) plus the tool name, so changing what the server runs voids the grant. Machine-scoped on purpose: a synced thoughtbase must not be able to pre-authorize a write tool. Env values are hashed, never stored. Cleared by Settings → MCP → *Reset allowed MCP tools*. |
| `publish-remote-approvals.json` | Which git remote this machine approved to receive publish credentials, per target (#2556). Keyed by a SHA-256 of the thoughtbase's realpath plus the target id; the approved URL is stored as written (not secret). Machine-scoped on purpose: a target's remote lives in the travelling `config.json`, so the approval can't. Written when the user types a remote in the Publish dialog or confirms a changed one. |
| `ingest-settings.json` | Source-ingest defaults. |
| `python-settings.json` | Python interpreter path, network posture, and the per-cell execution limit (#2218). |
| `compute-consent.json` | Content-addressed code-cell consent, keyed on each cell's code hash (#1412). Machine-scoped so it never rides along with a shared thoughtbase. |
| `inspection-settings.json` | Which graph-health inspections run, plus their staleness thresholds (#1792). |
| `history-settings.json` | Local note-history retention limits — days, revisions per note, max file size (#1158). |
| `privileged-sites.json` | Clipper privileged-site list. |
| `recent-projects.json` | Recently opened thoughtbases. An unreadable one is set aside as `recent-projects.json.unreadable` rather than overwritten (#2416). |
| `session.json` | Window / layout / tab session. |
| `Local Storage/` | Chromium's own store for the renderer's localStorage (theme, layout, "Don't ask again" choices). Not written by Minerva directly; read once, by the `file://` → `app://minerva` migration (#2564), to tell an upgraded profile from a fresh one. |
| `storage-origin-migration.json` | Marker that the renderer's localStorage was carried from the old `file://` origin to `app://minerva` (#2564), so the one-time migration never runs again. Holds a timestamp and a key count, no values. |
| `compute-audit.jsonl` | Append-only audit log of code-cell runs. |
| `queries/` | Saved queries at **global** scope. |

## 2. `~/.minerva/` — per **user** (home)

User-global extensions that travel across machines only if the user copies them.

| Path | Holds |
|---|---|
| `skills/` | User-authored skills (`*.md` or a folder with `SKILL.md`). Additive over stock. |
| `menu-config.json` | Learning/Research/Analysis menu enable · reassign · order (per machine). |
| `mcp-servers.json` | Configured MCP servers (#2031): stdio command/args/env, or a remote URL, plus name and enable flag. Global, not per-thoughtbase — matches `mcp-oauth-tokens.json`'s own precedent. **stdio `env` values are encrypted** at rest (they're where a server's API key goes, #2562); a legacy plaintext file still loads and is re-encrypted. OAuth tokens stay in `userData/mcp-oauth-tokens.json`. |

## 3. `<thoughtbase>/.minerva/` — per **thoughtbase** (project)

Lives inside each thoughtbase root and travels **with** it. `.minerva/` carries a
`.gitignore` so machine-local + secret files never publish.

| Path | Holds |
|---|---|
| `graph.ttl` | The RDF knowledge graph (rebuilt from notes on demand). |
| `config.json` | Thoughtbase config: display name, base IRI, and publish targets' **non-secret** fields. Travels with the thoughtbase. |
| `secrets.json` | **Encrypted per-publish-target credentials** — gitignored, never committed. |
| `types/*.md` | User-authored object types (per-thoughtbase vocabulary). |
| `collections.json` | Collections + smart collections. |
| `conversations/` | Conversation transcripts. |
| `excerpts/*.ttl` | Anchored source excerpts. |
| `queries/` | Saved queries at **project** scope. |
| `formatter.json` | Per-thoughtbase formatter settings. |
| `csl/` | User citation styles. |
| `history/` | Local per-note history: snapshots as `<mirrored-note-path>/<ts>.snap` plus an `index.json` (#1158). Gitignored; plain files so a note's past stays recoverable without the app. |
| `cache/`, `assets/` | Derived caches (external images, YouTube thumbnails) + publish assets. |

## Secrets, at a glance

At-rest encryption uses Electron `safeStorage` with an `enc:v1:` version tag; a
legacy plaintext value still reads back and is re-encrypted on next read/write
(`src/main/secret-storage.ts`, #1326 / #1642).

**When there's no OS key store, secrets are plain text, and Minerva says so
(#2569).** That happens with no `safeStorage` at all, or on Linux with the
`basic_text` backend (no Secret Service is running). `basic_text` counts as
unencrypted because Chromium's fallback "encrypts" with a key compiled into
the browser, and an `enc:v1:` tag on that would make Settings claim protection
that doesn't exist. `secretStorageStatus()` reports which case applies, AI
settings and MCP settings show a persistent note, and the first plaintext
write in a process logs one `[secrets]` warning. Nothing is refused, because
refusing a key on a machine with no keyring would leave the app unusable
there. The files are owner-only (0600, #2562) either way. macOS always has the
Keychain, so this only affects the Linux/Windows ports (#2198).

Secrets live in:

- `userData/llm-settings.json` — provider API keys
- `userData/clipper-config.json` — the clipper shared secret
- `userData/mcp-oauth-tokens.json` — MCP server OAuth access/refresh tokens
- `~/.minerva/mcp-servers.json` — stdio servers' `env` values (#2562)
- `<thoughtbase>/.minerva/secrets.json` — publish-target credentials

Each of these files is also written **owner-only (0600)** — `SECRET_FILE_MODE`
via `writeJsonFileAtomic*`'s `mode` option, applied to the temp file before the
rename so the secret is never on disk world-readable, and tightening an older
0644 file on its next write (#2562). `tests/main/config/secret-file-mode.test.ts`
fails if a write to one of them drops it.
