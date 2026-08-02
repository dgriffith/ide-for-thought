# Config roots

Minerva's configuration lives in three roots with different scopes and lifetimes.
This is the inventory (#1642) — they're otherwise scattered, and secrets sit in
all three.

## 1. `userData/` — per **machine**

`app.getPath('userData')` (macOS: `~/Library/Application Support/Minerva/`).
Machine-/OS-user-scoped settings that don't belong to any one thoughtbase.

| File | Holds |
|---|---|
| `llm-settings.json` | LLM providers, model, effort, web settings. **API keys are encrypted** at rest via `safeStorage` (`enc:v1:` prefix). |
| `clipper-config.json` | Browser-clipper enable flag + the loopback **shared secret (encrypted)**. |
| `ingest-settings.json` | Source-ingest defaults. |
| `python-settings.json` | Python interpreter path + run consent. |
| `privileged-sites.json` | Clipper privileged-site list. |
| `recent-projects.json` | Recently opened thoughtbases. |
| `session.json` | Window / layout / tab session. |
| `compute-audit.jsonl` | Append-only audit log of code-cell runs. |
| `queries/`, `views/` | Saved queries / views at **global** scope. |

## 2. `~/.minerva/` — per **user** (home)

User-global extensions that travel across machines only if the user copies them.

| Path | Holds |
|---|---|
| `skills/` | User-authored skills (`*.md` or a folder with `SKILL.md`). Additive over stock. |
| `menu-config.json` | Learning/Research/Analysis menu enable · reassign · order (per machine). |

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
| `cache/`, `assets/` | Derived caches (external images, YouTube thumbnails) + publish assets. |

## Secrets, at a glance

At-rest encryption uses Electron `safeStorage` with an `enc:v1:` version tag; a
legacy plaintext value still reads back and is re-encrypted on next read/write
(`src/main/secret-storage.ts`, #1326 / #1642). Secrets live in:

- `userData/llm-settings.json` — provider API keys
- `userData/clipper-config.json` — the clipper shared secret
- `<thoughtbase>/.minerva/secrets.json` — publish-target credentials
