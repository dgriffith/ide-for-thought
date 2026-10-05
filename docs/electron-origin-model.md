# The renderer's origin, and what trusts it

Chromium makes most of its security decisions by **origin**: what a CSP
`'self'` allows, which page gets a permission, whose `localStorage` is whose.
Electron adds one decision of its own: **the preload runs on whatever page the
window's top frame shows**, and the preload is where `window.api` (every IPC
channel Minerva has) comes from. So "which page is this, and which origin is
it?" decides who can drive the app.

Three findings of the 2026-10-02 security review (H1, M6, and part of M3) came
from one mistaken assumption: that `file://` is "the app's own origin". The
security.ts header said navigation was allowed "only to the app's own origin".
The check behind it was `url.startsWith('file://')`, which is every file on the
disk. This page records the model as it stands after the fixes, so the next
change to a window, a protocol or a permission starts from it.

## What `file://` meant

Up to v3.0.0 the packaged renderer loaded from
`file:///…/app.asar/.vite/renderer/main_window/index.html`. With that origin:

| Mechanism | What it meant under `file://` |
|---|---|
| CSP `'self'` | Any `file://` URL, so a script or `fetch` could reach anything on the disk, not just the bundle. |
| Navigation guard | "Own origin" was any `file://` URL, so a local `.html` file could become the top-level page. |
| Preload | It ran on that page, so the page got `window.api`. That is H1: a clicked link to a thoughtbase `.html` file, or a file dropped outside the editor (M6), could run code with the whole IPC surface. |
| IPC | Handlers didn't check who was calling, so any page holding the bridge was "the renderer". |
| Permissions | The default session's checks used the same `file://` test, so any local page got the microphone and clipboard grants meant for the app. Other sessions (the login partitions) had no handler at all, and Electron's default approves (M3). |
| `GrantFileProtocolExtraPrivileges` fuse | On, because Chromium's `file://` handler can't read inside `app.asar` without it. It also let any `file://` page fetch any other `file://` URL. |

None of these was a bug on its own terms. Together they made "a file on the
disk" and "the app" the same principal.

## What closes each gap

The fixes are layered on purpose. Each holds even if another is bypassed.

| Layer | Issue | Now | Held by |
|---|---|---|---|
| Main refuses the navigation | #2552 | `will-navigate` allows exactly the window's own entry URL (`isRendererEntry`: same scheme, host and normalised path, never across schemes) or the dev server's origin under `pnpm dev`. Everything else is refused; http(s) goes to the OS browser. | `tests/main/security-helpers.test.ts`, `tests/main/security.test.ts` |
| Main refuses the caller | #2553 | `handle()` in `ipc/typed-ipc.ts` runs `ipc/sender-guard.ts` first: the sender must be the main window's top frame, showing exactly that entry. A raw `ipcMain.on` calls `isTrustedIpcSender(e)` itself. | `tests/main/ipc/sender-guard.test.ts`; the Semgrep rule `minerva-ipc-handler-without-sender-check` |
| The renderer refuses first | #2554 | A capturing click/auxclick guard cancels any link that isn't http(s), `mailto:` or a same-document fragment. Unaccepted file drops are cancelled, and `navigateOnDragDrop: false` is pinned in `HARDENED_WEB_PREFERENCES`. | `tests/renderer/app/navigation-guard.test.ts`, `tests/e2e/navigation-guard.spec.ts` |
| Deny by default, everywhere | #2559 | `web-contents-created` / `session-created` guards: every webContents starts unable to open windows, navigate or attach a `<webview>`, and every non-default session denies every permission. A window opts in explicitly. | `tests/main/security.test.ts`, `tests/architecture/webcontents-deny-by-default.test.ts` |
| The renderer isn't on `file://` at all | #2564 | The renderer is served from the privileged `app://minerva` scheme (`src/main/app-protocol.ts`), which reads the bundle with main's asar-aware `fs`. CSP `'self'` now means the bundle. Permission checks match `app://minerva`, not `file://`. The `GrantFileProtocolExtraPrivileges` fuse is **off**, so `file://` has Chrome's default powers only. | `tests/main/app-protocol-paths.test.ts`, `tests/architecture/electron-fuses.test.ts` |
| Code execution needs main's own confirm | #2568 | IPC that can end in code running (compute consent, a new Python interpreter, a stdio MCP server's command, opening a launchable file) asks a native dialog the renderer can't draw or answer. | `tests/architecture/privileged-ipc-confirm.test.ts` |

`localStorage` moved origin with the renderer. The first launch after the
upgrade copies the old `file://` origin's entries across once
(`src/main/legacy-storage-migration.ts`, with the preload half in
`src/preload/legacy-storage.ts`).

## Rules for new code

- **A new window** goes through `security.ts`. It's guarded by default
  (#2559), opts into navigation with `installNavigationGuards` or
  `allowHttpsBrowsing`, and spreads `HARDENED_WEB_PREFERENCES`. It also needs
  the first-paint guarantee CLAUDE.md describes under *Startup*.
- **Never `loadFile()` or `loadURL('file://…')` into a window that has the
  preload.** The renderer's page is `app://minerva/index.html`
  (`rendererEntryUrl()`), and the navigation and sender guards compare
  against exactly that.
- **A new `ipcMain.on` listener** calls `isTrustedIpcSender(e)` first. Invoke
  handlers get it free through `handle()`.
- **A new asset the renderer fetches** is served by the `app://` handler. It
  doesn't need `file://` access, and must not ask for it.
- **A permission** is granted in `security.ts`'s default-session handler to
  `app://minerva` only. Any other session denies it.

## The shared-thoughtbase question

The origin model is one half of the review. The other half is H2 and H3: a
file or config **that travels with a shared thoughtbase** reached a
privileged sink. A root-level `json.py` ran in the Python kernel before any
consented cell (#2555). A `.minerva/config.json` chose where the user's
GitHub credential was sent (#2556). Neither looked like an origin problem.
Both came down to asking where a value comes from.

So every PR answers the question in CLAUDE.md's security checklist:
**where does this run, and what file, env var or URL from a shared
thoughtbase reaches it?** A thoughtbase arrives by zip, sync, git clone or
an AirDrop from a colleague. Everything in it is someone else's input: notes,
`.minerva/` config, sources, `.py` and `.html` files. That includes values the
app wrote itself on another machine. `tests/helpers/hostile-thoughtbase.ts`
builds these for tests, and each finding's regression suite drives its fix
through one.
