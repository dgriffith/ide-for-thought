# Forking Minerva

Minerva is meant to be field-modifiable, and some people will go past plugins
and change Minerva itself. This page says how a fork gets an identity of its
own, so that it and upstream can live on one machine without overwriting each
other (#2656, part of #2615).

> **Status: design only.** Nothing here is built yet; 4.0 ships plugins inside
> the official app, and this records the decisions so the build side can be
> taken up after it (see *Follow-up* at the end). Each decision below is
> marked **Decision**, with why.

## Why a fork can't just rebuild

Today's release machinery assumes there is exactly one Minerva. A fork built
from this repo with nothing changed would:

| Shared with upstream | Because | What goes wrong |
|---|---|---|
| The update feed | `update-electron-app` reads `package.json`'s `repository` and polls update.electronjs.org for **this** repo's releases (`src/main/auto-update.ts`) | Upstream's next release is offered to the fork, and installing it replaces the fork's changes |
| The bundle id | `forge.config.ts` sets no `appBundleId`, so packager derives one from `name: 'Minerva'` | macOS treats the two as one app: one Dock entry, one "open with", LaunchServices sends a launch to whichever it finds |
| `userData/` | Electron names it after the app (`~/Library/Application Support/Minerva/`) | One set of LLM keys, conversations, history, session and OAuth tokens, written by two apps |
| `~/.minerva/` | Hard-coded beside the home folder | The same skills, plugins, plugin settings, menu config and MCP servers, so a plugin approved in one runs in the other |
| The Keychain item | `safeStorage` keys on the app name ("Minerva Safe Storage") | Shared while the name is shared; once it changes, neither can read the other's secrets |
| The `minerva` command | `cli-install.ts` writes `~/.local/bin/minerva` | The last app to install it owns the command, and every MCP client config pointing at it |
| The clipper port | `clipper/lifecycle.ts` prefers port 41599 | The browser extension talks to whichever app took the port first |
| A thoughtbase | Both can open one; there is no single-instance lock across two apps | Two writers on `graph.ttl`, the DuckDB tables and `.minerva/runtime.json` (the CLI's "is an app open here?" advert) |

## The identity is one file

**Decision:** everything that names the app comes from one place, a checked-in
`build/identity.json`, and a fork changes that file and nothing else to become
its own app:

```jsonc
{
  "productName": "Minerva",           // window titles, menus, userData folder, Keychain item
  "appBundleId": "dev.minerva.app",   // macOS bundle id
  "slug": "minerva",                  // ~/.<slug>/, the CLI command, the CLI's runtime advert
  "updates": { "repo": "dgriffith/ide-for-thought" },  // or null: no auto-update
  "clipperPort": 41599,
  "pluginApi": "4.0.0"                // the Minerva whose plugin API this build implements; see below
}
```

**Why one file:** today these are spread over `forge.config.ts`,
`package.json`, `auto-update.ts`, `cli-install.ts`, `clipper/lifecycle.ts` and
every `os.homedir() + '.minerva'`. A fork that has to find all of them will
miss one, and a missed one is silent: the fork works, and quietly shares
something with upstream. One file, plus a test that no other module spells
any of these values, makes "I renamed it" mean the whole thing.

Upstream's values are the defaults, so nothing changes for anyone running
Minerva.

## Auto-update

**Decision:** a fork updates from its own feed or not at all, and only a
signed build updates.

- `updates.repo` names the fork's own GitHub repo, whose published releases
  update.electronjs.org serves; `null` turns the updater off (it is already
  inert in an unpackaged run).
- Squirrel.Mac only applies an update signed by the same identity as the app
  that's running, so an ad-hoc local build can't update even with a feed. The
  updater stays off unless the build is a signed release, rather than
  polling for something it could never install.
- **Never upstream's feed.** The worst outcome on this page is a fork that
  updates itself into upstream and loses its changes; the default for any
  identity other than upstream's is `null`.

## App id, data, and moving from upstream

**Decision:** a fork has its own bundle id, its own `userData/` (Electron
derives it from `productName`) and its own home folder, `~/.<slug>/` in place
of `~/.minerva/`. Nothing is shared by default.

**Decision:** moving over is an explicit, one-time **Import from Minerva…**,
not a shared folder. It copies:

- skills, menu config and MCP server definitions (`~/.minerva/` → `~/.<slug>/`);
- installed plugins, as fresh installs: their records come across **without**
  MCP approvals, so each server is off until approved in the fork (#2646's
  rule that approval is per build of the code, applied to the app too);
- conversations and history, if asked.

It can't copy secrets: they're encrypted under upstream's Keychain item, which
the fork can't read without the user granting it access to upstream's key.
LLM keys, MCP `env` secrets, plugin secrets and publish credentials are
listed as "re-enter these" at the end of the import.

**Why not share `~/.minerva/`:** a plugin approved to run in upstream would run
in the fork, which is a different program the user never approved it in; and
two apps writing `plugins.json` and `menu-config.json` race each other.

## Thoughtbases

A thoughtbase is the one thing upstream and a fork **should** share: it is the
user's data, and the reason to keep the formats compatible.

- **Decision: a fork doesn't change on-disk formats silently.** A fork that
  writes something upstream would misread (a new `.minerva/` file is fine; a
  changed meaning for an existing one isn't) records that in
  `.minerva/config.json` as `formatExtensions: ["<slug>:<what>"]`, and
  upstream says "made by <productName> with changes it may not understand"
  rather than misreading. Upstream adds nothing for this until a fork needs it.
- **Decision: one app at a time per thoughtbase.** `.minerva/runtime.json`
  gains the app's bundle id; an app opening a thoughtbase that another app
  has open (a live advert with a different id) says so and opens it
  read-only, as two Minervas on one thoughtbase would corrupt the graph and
  tables.
- **Secrets inside a thoughtbase** (`.minerva/secrets.json`, the publish
  credentials) are per app for the same Keychain reason: a fork asks for them
  again rather than failing to decrypt.

## Signing

Three cases, and what holds in each:

| Build | Signed how | What works |
|---|---|---|
| Upstream release | Developer ID, hardened runtime, notarized (`pnpm build:release`) | Everything, including updates |
| A fork's release | The fork's own Developer ID, same policy: `signing-policy.mjs` already takes the identity from the environment, so a fork sets its own | Everything, from its own feed. It must re-sign the DuckDB binaries with its team, as #2565 does for upstream |
| A local fork build | Not signed for release: what `pnpm build` produces today (ad-hoc, as Apple Silicon requires) | Runs on the machine that built it. No updates. Gatekeeper is not involved for a build you made yourself (no quarantine flag) |

**Decision: the fuses stay on in every case.** `OnlyLoadAppFromAsar` and the
asar integrity check (#2366) don't depend on the signature: the integrity hash
lives in `Info.plist` and is checked whether the bundle is Developer-ID or
ad-hoc signed, which CI's unsigned e2e builds already exercise. `RunAsNode`
stays off (#2565); the CLI runs in CLI mode either way.

What breaks with ad-hoc signing, and the answer:

- **Library validation.** With the hardened runtime on, macOS refuses to load
  a dylib signed by a different team. An ad-hoc build has no team, so the
  hardened runtime stays **off** for ad-hoc builds (it is only applied when
  signing for release today), and #2565's re-signing applies to release
  builds only.
- **The Keychain.** "Always allow" is bound to the code signature, and every
  ad-hoc rebuild has a new one, so each rebuild asks once for its Safe Storage
  key. That's correct behaviour, not a bug to work around: it is the OS
  checking that a changed program may read the secrets.
- **Updates.** None, as above.

## Plugins across forks

The manifest's `minerva` range (`">=4.0.0"`) has to mean something when the
app is a fork with its own version numbers.

- **Decision:** a plugin's `minerva` range is checked against the build's
  `pluginApi`, the upstream version whose plugin API it implements, never
  against the fork's own `version`. A fork at 1.2.0 tracking upstream 4.3
  says `pluginApi: "4.3.0"`, and plugins written for Minerva 4.x load in it.
  Upstream's `pluginApi` is simply its version.
- **Decision:** a fork that changes the plugin API, adding a contribution point
  or changing one, says so with a new field rather than lying in `pluginApi`:
  `pluginApiExtensions: ["<slug>:<point>"]`, which a plugin can require as
  `"requires": ["<slug>:<point>"]`. Upstream refuses a plugin requiring an
  extension it doesn't have, naming it, the same fail-closed rule as an
  unknown contribution point.
- **Plugin code's API has its own version** (#2826): `PLUGIN_API_VERSION`,
  which a plugin's `code.api` range is checked against. A fork's added
  methods are named `<slug>:<method>`, matching its `pluginApiExtensions`
  entries, and stay out of upstream's ABI snapshot (`plugin-api/abi.json`).
- `minerva plugin check` takes the version to check against from the build
  running it, so a fork's CLI checks plugins against the fork.

## Follow-up

The build side, for an epic after 4.0:

1. `build/identity.json`, read by `forge.config.ts`, `auto-update.ts`,
   `cli-install.ts`, the clipper and every home-folder path; and a ratchet
   that no module spells "Minerva", `~/.minerva`, the bundle id or the port
   itself.
2. The updater off for any identity but upstream's unless `updates.repo` is
   set, and off for unsigned builds.
3. **Import from Minerva…**: the copy above, with the secrets list.
4. `.minerva/runtime.json` carrying the bundle id, and read-only open when
   another app holds the thoughtbase.
5. `pluginApi` / `pluginApiExtensions` in the plugin checker, replacing the
   app version.
6. A fork walkthrough in `docs/packaging.md`: change `identity.json`, build,
   and (for a release) set up a Developer ID, the update repo and release.yml.
