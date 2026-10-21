# Plugin code: where it runs, what it can reach, how it's trusted

4.0's plugins are declarative. Anything that has to execute ships as an MCP
server, out of process (#2615). This page is about the next step: code that
runs **inside** Minerva, from plugins and from Minerva itself (#2810).

> **Status: draft design.** Nothing here is built. Decisions are marked
> **Decision**, with why; each is a proposal until #2810 closes. The questions
> still open are listed at the end. Six stories are held on this page
> (#2640, #2641, #2642, #2643, #2647, #2648); *The held stories* says what
> happens to each.

## Why not load it like an IDE plugin

The familiar model is IntelliJ's: a class-loader per plugin, the plugin calls
the IDE's API directly, and it can do anything the IDE can. Obsidian's
community plugins work the same way in JS. It's simple, and it's what most
desktop apps do. It doesn't fit Minerva, for reasons that are mostly about
Minerva rather than about JS:

- **A class-loader isolates names, not authority.** An IDEA plugin is fully
  trusted. Java's attempt at in-process least privilege, the SecurityManager,
  was deprecated (JEP 411) and removed because nobody could write policies
  that held. JS realm sandboxes are the same idea, with prototype pollution on
  top. **The isolation that holds is a process and an origin**, so that's what
  this design uses.
- **The expected author is an LLM.** #2615's premise is that the user, or the
  coding agent they run, writes the plugin. That makes plugin code LLM output,
  possibly written minutes ago by a model that had just read a hostile note.
  The Trust Principle says LLM output is proposed and confirmed, not run with
  the app's authority.
- **In-process code defeats the approval engine.** Approve is a button in the
  renderer. Code in the renderer holds `window.api` as the trusted frame, which
  the sender guard (#2553) can't tell apart, so it could approve its own
  proposals or the model's. Code in main doesn't need the button.
- **Minerva holds a lot.** Provider API keys, the GitHub token, MCP OAuth
  tokens, every conversation, and on macOS the TCC grants made to Minerva's
  identity (the microphone, folders). In-process code inherits all of them.
- **It hollows out guarantees already paid for.** The asar integrity fuse
  (#2366) means "code running as Minerva is code we signed". Main *can*
  `require` a file outside the archive, but the guarantee would then be about
  the bootloader only.
- **One thread.** Main and the renderer each run on one thread that is
  already on hot paths (`rebuildMenu` on every selection change). A plugin
  with a tight loop freezes the app.

IntelliJ itself added **Trusted Projects** in 2021, because run configurations
and build scripts that travel with a project were running code. That is the
shared-thoughtbase threat #2571 closed here.

## The rule: parity of API, not parity of trust

**Decision:** anything a core plugin can do, a third-party plugin can do, by
the same manifest, the same API and the same runtime. A core plugin is one
that ships inside the signed `app.asar`. The only difference is **who vouches
for it**: Minerva's signature for a core plugin, the user's approval of a
pinned hash for a third-party one.

**Decision:** risk follows the **capabilities a plugin declares**, not where it
came from. A capability that can run a program needs main's native confirm to
enable, whether the plugin is core or not.

**Why:** a core plugin with private powers is a feature flag with extra
packaging. Holding core plugins to the public API is what makes that API
complete. Each core view moved onto it is a test that the API can carry a real
view, and a third-party plugin then gets the same.

### The trusted core is not made of plugins

**Decision:** the parts that *are* the trust boundary stay core code, never
plugins, and no plugin can replace or wrap them:

- the approval engine and the proposal review UI;
- consent and `confirmNative` (#2568), and the compute trust gate;
- the IPC sender guard (#2553), the navigation guards (#2552, #2554), the
  deny-by-default webContents (#2559) and the `app://` protocol (#2564);
- the plugin manager: install, enable, approve, remove;
- secrets and credential storage;
- the plugin host described below.

**Why:** if the Approve button could be a plugin, a plugin could press it.
Obsidian's plugin manager isn't a plugin either.

## Where plugin code runs

Two kinds of code, two places. **Node never runs plugin code**, in main or
anywhere else.

### Views: a cross-origin frame

**Decision:** a plugin's UI (a view layout, a panel, a tab, a live block's
rendering) runs in an `<iframe>` on the plugin's own origin,
`minerva-plugin://<id>/`, served by a protocol handler from the plugin's
folder (or from `app.asar` for a core plugin).

- **Its own origin, so its own process.** A cross-origin frame is out of
  process under Chromium's site isolation. The app's CSP `'self'` still means
  only `app://minerva`, and the plugin's frame gets a CSP of its own:
  scripts from its own origin, `connect-src 'none'`, no `frame-src`.
- **No preload, no `window.api`.** The sender guard already refuses anything
  that isn't the main window's top frame showing the renderer entry, so a
  plugin frame couldn't call IPC even if it got hold of `ipcRenderer`.
- **One channel out**: a `MessagePort` handed over by the host, which speaks
  only the plugin API and checks every call against the plugin's declared
  capabilities.
- **No permissions.** The `minerva-plugin:` origin is denied every permission
  (camera, microphone, clipboard read, notifications). Clipboard writes and
  the like go through the API as intents.
- **No navigation.** The frame can't navigate itself or the top frame, open
  windows or attach a `<webview>` (#2559's defaults, plus a
  `will-frame-navigate` check).
- **Sandboxed by its own response**, not only by the host's `sandbox`
  attribute: the frame CSP carries a `sandbox` directive (#2824). The main
  window's popup handler can't tell which frame opened a popup and sends
  http(s) to the OS browser, so an unsandboxed frame's `window.open` would
  be a network request around `connect-src 'none'`. That was measured, then
  closed.

**Why a frame and not a `WebContentsView`:** a view sits *in* the layout (a
kanban board in a tab, a block in the preview), and a frame lays out with the
page. A frame is a full browsing context: canvas, WebGL, its own framework.
VS Code's Excalidraw and draw.io editors are webviews of exactly this kind.
"Too much for one iframe" isn't the limit; what it can reach is.

### Logic: a sandboxed worker host

**Decision:** code with no UI (an inspection that can't be said in SPARQL, a
command's handler, an ingestor's parser, an exporter's writer) runs in a
**hidden, sandboxed plugin host**: a `WebContents` with `sandbox: true`, no
preload and no Node, on the plugin's own origin, running the plugin's logic
module in a Web Worker. Main talks to it over a `MessagePortMain`.

**Why not a `utilityProcess`:** that is Node, and Node is exactly what plugin
code must not have. A Chromium sandboxed renderer has no `fs` and no
`require` by construction, and its CSP blocks the network. The isolation comes
from the OS sandbox rather than from code we'd have to get right.

- **Data in, data out.** An ingestor is handed the file's bytes and returns
  a source's metadata and text. An exporter is handed the rendered document
  and returns bytes. Main does every file read and write.
- **Time-bounded.** Every call has a deadline. A worker that misses it is
  terminated, the call fails naming the plugin, and the plugin is marked
  stopped until it's next used. A loop in a plugin costs that plugin, never
  the app.

### Programs: declared, like an MCP server

A plugin that needs a program of its own (a language kernel, a native tool)
declares it in `plugin.json`, the way `mcpServers` does today. Main spawns it,
in the plugin folder, with the minimal environment, after a native confirm.
This is the `process` capability below. It is how Python becomes a core
plugin (*Core plugins*).

## What it can reach

**Decision:** a plugin declares what it uses under `code.capabilities` in
`plugin.json`, and the host refuses any call outside them. Unknown
capabilities refuse the plugin, the same fail-closed rule as an unknown
contribution point.

| Capability | Grants | Tier |
|---|---|---|
| `notes:read` | Read the notes the host gave this view or call: a type view's instances, a block's query result, the active note. Not "every note". | A |
| `graph:query` | Read-only SPARQL; SQL through `guardSql(…, 'plugin')`, the registered-relations allowlist `query_sql` already uses (#2442). | A |
| `ui` | Intents: open a note, show a menu, `announce()`, register commands, copy to the clipboard. Drawn by the app, not the plugin. | A |
| `notes:write-properties` | Change frontmatter properties on notes it was given. Enough for kanban, timeline and calendar moves. | B |
| `notes:write` | Create notes, and change the body of notes it was given. | B |
| `llm:propose` | Ask the model for something. What comes back is a proposal, as always. | B |
| `process` | Run the program it declares. | C |

Never available, to any plugin: the network (that's MCP), secrets, `fs`,
`require`, `window.api`, the DOM outside its own frame, and the approval
engine.

The broker (#2825) is `main/plugins/broker.ts`, its method table
`shared/plugins/api.ts`. Each method names one capability; a call is refused
unless the plugin declared it, then unless every note it names is in the
session's scope, before anything runs. Messages are JSON text, 1 MiB each
way, 16 calls in flight. `llm:propose` is declared but refused until #2858.

### Writes

The Trust Principle is about **LLM-originated** writes, and they stay
proposals whoever triggers them: a plugin with `llm:propose` files a proposal
that the user reviews like any other.

A **user's gesture in a plugin view** (dragging a card to another column) is
the user's write, and making it a proposal would be wrong. But plugin code can
fake a gesture. So:

- **Decision:** a plugin's writes are scoped to the notes the host handed it,
  and only to what its capability allows (properties, or bodies).
- **Decision:** every plugin write carries provenance, `plugin:<id>@<version>`,
  in history, so it can be found and undone (#1157).
- **Decision:** nothing in the API reaches the approval engine. A plugin can't
  approve, reject or expire a proposal.

**Why scope by "notes it was given":** a view renders thoughtbase content,
and that content is hostile input. A note that gets script running inside a
plugin's frame (an XSS *in the plugin*) gets that plugin's capabilities and no
more. The origin keeps it away from the app, and scoping keeps it to the notes
on screen.

## Against today's guarantees

Code that loads must not weaken any of these for the app itself.

| Guarantee | Issue | With plugin code |
|---|---|---|
| asar integrity, `OnlyLoadAppFromAsar` | #2366 | Unchanged. Plugin code is never loaded as app code. It's served to a sandboxed frame or host as web content, from a separate scheme. |
| CSP `'self'` = the bundle | #2564 | Unchanged for `app://minerva`. Plugin origins get their own, stricter CSP. |
| IPC sender guard | #2553 | Unchanged, and it is what keeps plugin frames off IPC. Plugin calls arrive on the host's `MessagePort`, never as IPC. |
| Navigation guards | #2552, #2554 | Unchanged for the top frame. Plugin frames can't navigate at all. |
| Deny-by-default webContents | #2559 | The plugin host opts into nothing. |
| Native confirm for code execution | #2568 | Enabling any plugin with `process` is a privileged channel, in `PRIVILEGED_CHANNELS`. |
| Permissions only to `app://minerva` | #2564 | `minerva-plugin:` gets none. |

## Trust and approval

- **Decision: install shows what the plugin asks for**, as a list of
  capabilities in words ("change properties of notes shown in its views").
  Tier A and B plugins are approved there, in the app.
- **Decision: tier C asks again, natively, on enable**, with the exact
  program, as an MCP server's approval does today (#2646). A compromised
  renderer can't switch on a plugin that runs programs.
- **Decision: approval is pinned to a hash** of the manifest and every code
  file. Any change (a new version, or an edit in place) switches the plugin off
  until approved again, listing what changed in its capabilities. That's
  #2646's "a new version is a new server", applied to all code.
- **Core plugins** need no install approval, because Minerva's signature
  vouches for them. Tier C still asks natively on enable.

## Per machine, never per thoughtbase

**Decision:** unchanged from #2615. Code loads only from
`~/.minerva/plugins/` and from `app.asar`. A thoughtbase can recommend a
plugin by id, and that recommendation installs, enables and fetches nothing.

What a thoughtbase *does* reach is plugin **input**: the notes a view renders,
the file an ingestor parses. That's covered by scoping and the origin above,
and the hostile-thoughtbase fixtures drive it in conformance.

## Core plugins

Componentizing Minerva into core plugins is a security change as well as a
tidy one. A feature that's off isn't hidden; **it isn't wired up**. Its
executors aren't registered, its IPC channels don't exist, its processes never
start, and its LLM tools aren't offered.

### Python, off by default

**Decision:** Python cells and their settings move into a core plugin that
declares `process`, **off by default** on new installs.

- **Off removes the surface.** With it off, no Python executor is registered
  in `compute/registry.ts`, `COMPUTE_SET_PYTHON_SETTINGS` and
  `COMPUTE_PROBE_PYTHON` aren't registered (two of the six channels in
  `privileged-channels.ts`), the kernel and its RPC server never start, and
  `propose_compute` doesn't offer Python, so a prompt injection can't put a
  cell into review.
- **The gates stack.** Enabled with a native confirm (per machine), then
  consent per thoughtbase, then the run. A user who never wanted Python never
  sees a consent dialog, and so never gets used to clicking through one.
- **Only Python.** SQL and SPARQL cells are read-only and locked down (#2437,
  #2442), and they stay core.
- **Existing users** keep it on if they have Python settings or have ever
  granted compute consent. Nothing they have breaks.
- **A Python cell with the plugin off** renders as a plain code block with one
  quiet line saying Python is off on this machine. No modal, no toast.
- **Parity:** the Python plugin is a `compute-languages` contribution whose
  executor is a declared program speaking the kernel protocol. A third-party
  R or Julia plugin is the same thing through the same gate.

### The View API (#2828)

A layout a built-in plugin draws keeps its entry in the layout registry
(`shared/objects/view-layouts.ts`) — its rule for which types may show it,
and its spec fields — with `plugin: '<id>'`. That keeps a saved view valid
while the plugin is off: it isn't offered, and a view saved with it shows the
table, with one line saying which plugin to turn on.

`PluginLayout.svelte` hosts it: `TypeView` draws it like any layout, with the
one `view`. It sends the plugin a `view` event — the type, its properties,
the visible ones, the notes in the view's order, the sort, the layout's own
spec fields, `readOnly` and `exportMode` — on connect and on every change.
Main makes those notes the session's scope, exactly, before passing it on.
The plugin's `view.setState({ patch })` comes back as `view.onStateChange`,
keeping only the layout's own spec fields, and nothing in an embed or export.

What a layout needs that the kit didn't have (part B):

- **The app's own note menu**: `ui.showNoteMenu({ paths, x, y })` opens the
  view's row menu — Set Property, tags, Move to — for notes the session was
  given, at that point. The plugin can open it; only the user picks, and the
  app runs the action with its own confirmations.
- **Hover previews**: `ui.previewNote({ path, x, y, width, height, via })`
  shows the app's `NoteHoverPreview` against that box, with the app's delay
  and grace; `ui.hidePreview` lets it go.
- **Export**: in `exportMode`, the host sends an `export` event and the
  plugin answers `view.provideExport({ requestId, html })`. The HTML is
  **static, inline-styled and URL-free** — `sanitizePluginExportHtml` drops
  scripts, handlers, `<style>`, controls, frames, images and every URL
  (`url(…)` in a style too), and keeps `data-note-path`, which the snapshot
  turns into note links. It is drawn in the frame's place, with the export
  theme's tokens inline, and that is what the export snapshots.

**Built-in plugin views (#2828, C1).** A built-in plugin's view is source in
`plugins/<id>/` — outside `src/`, with its own Vite build
(`vite.core-plugins.config.mts`, `pnpm core-plugins:build`) into
`.vite/core-plugins/<id>/`, copied into app.asar by `afterPrune` beside the
CLI — and served at `minerva-plugin://<id>/` while the plugin is on. Not a
Forge renderer entry: under `pnpm dev` that would come from the Vite dev
server, which the frame's `script-src 'self'` can't load. The plugin API is
external, the copy Minerva serves. `plugin-source-boundary.test.ts` holds the
source to what an installed plugin could reach: its own folder, the API,
`src/shared/` and npm packages.

The `view` event carries each note's **card as the app would draw it** — its
fields as display text, the note a link field names (which joins the scope,
for that note's menu), its own type's icon — so a plugin never needs the type
catalog or other notes' titles. **Selection stays the host's**: `view.click`,
`view.selectAll` and `view.clearSelection` go through the view's own
selection, and the state carries `selected`.

### Kanban, timeline and calendar, on by default

**Decision:** the three `view-layouts` beyond list, table, gallery and map
(`TypeViewKanban`, `TypeViewTimeline`, `TypeViewCalendar` and their folders,
about 4,000 lines) become core plugins on the view API, on by default.

**Why:** they're the right first test. Their writes are frontmatter
properties only (`notes:write-properties`), they're real interactive views
rather than toys, and moving them means the people who know the code find the
API's gaps rather than third-party authors. A graph or mindmap view is then the
first view *nobody* wrote as core, which is the real parity test.

**Kanban is done (#2828).** The board lives in `plugins/kanban/` — its own
source root, built by `vite.core-plugins.config.mts` into
`.vite/core-plugins/kanban/` and served on `minerva-plugin://kanban/` — and
`view-layouts.ts`'s kanban entry names `plugin: 'kanban'`, so turned off it
falls back to the table. Two things it settled for the next two:

- **Moves are the host's, on the plugin's request** (`view.moveCard`,
  `view.undoMove`, `view.moveColumn`, API 1.5.0). The plugin draws and drags;
  TypeView runs the existing `kanban-moves` store, so undo, the announcement
  and the Local History entry are one implementation. A write made for a
  plugin carries a history cause (`NOTEBASE_WRITE_FILE`'s `opts.cause`):
  *Moved by Kanban*. Calendar reschedules should do the same rather than
  reach for `notes.writeProperties` themselves.
- **The host's popups stay the host's.** The note menu (`ui.showNoteMenu`,
  with `target` for a note a card's field names) and the hover preview are
  drawn by the app; the preview's text is mirrored back as a `preview` event
  so the card inside the frame can be described by it.

Tests split the same way: the board in `tests/plugins/kanban/`, the host side
through `tests/renderer/components/kanban-host.ts` (read the `view` state sent,
act as the plugin through the registered callbacks; `kanbanLoopback` answers
an export with the plugin's real board), and the e2e specs reach into the
frame.

**Timeline is done (#2829)**, the same way (`plugins/timeline/`), with less:

- **Least capability.** It writes no notes: zoom, pan and Fit change only
  the view's range, through `view.setState`. So it holds `notes:read` and
  `ui`, not `notes:write-properties`.
- **API 1.6.0** adds the view's `filters` (a range filter on the *Date by*
  property bounds Fit) and, on `ui.previewNote`, `extra` lines (the event's
  dates, "approximate", an `end` it set aside) and `omit` (properties the
  drawing already shows, left off the preview's field strip).
- **Its export goes through the plugin** too: the SVG drawing and the dated
  list, styles inlined, `data-note-path` for links, sanitized by the host —
  which already admits SVG (no `use`, `image` or `foreignObject`). In export
  mode nothing is a `<button>` (the sanitizer keeps none), so a row that must
  stay a link is a plain element with its note path.
- **A plugin can't run code when its frame is removed.** The old component
  wrote a range still on its debounce when it unmounted; the plugin writes it
  before opening a note, and when the frame loses focus or the pointer leaves
  it.
- **Shared modules.** The model (`timeline-events`, `-format`, `-scale`) is
  in `src/shared/timeline/`, because the calendar reads it too; the drawing's
  own modules (`-layout`, `-export`, `-gestures`) are the plugin's.

Its TypeView-level tests run the plugin's real `App.svelte` in loopback
(`tests/renderer/components/plugin-loopback.ts`): mounted beside the frame,
sent each view, preview and export request the host sends, its calls routed
to the host callbacks the broker's intents would reach.

### Other candidates

The test is which features reach a privileged sink or hold a credential:

- **Local (stdio) MCP servers**: `MCP_SERVERS_ADD` and `MCP_SERVERS_UPDATE` are
  two more privileged channels. HTTP servers carry less risk. Open question:
  whether the MCP client is one plugin or two.
- **Git publish** (a stored token), **dictation** (the microphone, a model
  fetched at runtime): smaller, and later.

## The plugin UI kit

A frame is isolated, which is the point, and it means everything the app gives
an in-page component for free has to be offered across the boundary. VS Code's
webviews feel second-class where this was missed. The kit is the API's `ui`
half, and it is real work:

- **Theme.** The CSS variables are pushed into the frame and pushed again when
  the theme changes. Plugins style with the same tokens as core.
- **Keyboard and focus.** Shortcuts the frame doesn't handle reach the app's
  command keymap; focus moves in and out with Tab and Escape.
- **Menus.** A plugin asks for a context menu and main draws it, native.
- **Announcements.** `announce()` reaches the app's one live region, so screen
  readers hear plugin views like core ones. The axe-based e2e checks reach
  into plugin frames.
- **Drag and drop.** Within a frame, pointer events (HTML5 drag-and-drop is
  unreliable on macOS Electron). Dragging a note from the sidebar *into* a view
  needs an explicit protocol, since pointer events don't cross the frame.
- **Data.** Note sets are copied into the frame. Fine for a kanban board;
  to be measured for a graph view of 5,000 notes.

**As built (#2827).** Everything crosses the one session port, so it is
capability-checked (`ui`) and logged; the host sends events the other way
(`{ "event", "data" }`, `minerva.on(…)`). `PluginFrame.svelte` is the one host.

- **Theme**: the colour tokens and the three font families, sent on connect
  and on every change; the runtime sets them on the frame's `:root`. The
  bundled web fonts live on `app://`, which the frame's `font-src 'self'`
  can't load, so a frame falls through the family list to the system fonts.
- **Focus**: Tab crosses the frame natively. An unhandled Escape calls
  `ui.releaseFocus`, and focus goes to the host.
- **Keyboard**: an unhandled ⌘/Ctrl shortcut is forwarded and runs only a
  command marked `fromPluginViews` (palette, quick open, back/forward,
  sidebars, tabs, find in notes, shortcuts). A plugin can fake a keystroke,
  so nothing that changes a note is on the list. Commands with a native menu
  item already fire inside a frame on macOS, before the page sees the key.
- **Menus**: `ui.showMenu` — a native menu at the pointer, answering the
  chosen id. It can't trigger app actions.
- **Drops**: while any drag is on, plugin frames ignore the pointer; the host
  catches a note dropped from the file tree (HTML5) or a panel (pointer
  drag), adds it to the session's scope — the drop is the user's gesture —
  and sends `drop` in the frame's coordinates.
- **Data, measured** in the real app over the real port
  (`tests/e2e/plugin-note-copy.measure.spec.ts`, opt-in), ~2 KB notes read 16
  at a time: **500 notes in 70–96 ms, 5,000 in 0.7–0.9 s** (0.14–0.19 ms
  each), opening a 5,000-note session in ~32 ms. Measuring found the session
  open at 203 ms, all of it synchronous `realpath` on main's thread for the
  scope; admission is now lexical, and every use still runs the full check.
  A batched `notes.readMany` is the next step if a view needs faster than
  that.

## Conformance

`plugin check` (#2654) and the hostile-plugin corpus (#2655) grow to cover
code:

- **An API-surface test.** The plugin API is snapshotted the way
  `preload-bridge.test.ts` snapshots `window.api`, so any change is a
  deliberate one.
- **A capability check.** `plugin check` runs the plugin's code against a tidy
  and a hostile thoughtbase and fails on any call outside its declared
  capabilities.
- **The corpus gains code that misbehaves**, each with a test that it's
  contained: `require` and `process`; `fetch` and `WebSocket`; `window.top`,
  `parent.document`, `window.api`; a `postMessage` to the app pretending to be
  the host; a write to a note it wasn't given; a forged provenance; a payload
  far over the size limit; a loop that never returns (terminated, the app stays
  responsive); and a hostile note that gets script into a plugin view.

## Forks and the ABI

**Decision:** with code, the plugin API becomes an ABI with a semver version
of its own, `PLUGIN_API_VERSION` (#2826) — not the app's version, which moves
every release while the ABI rarely does. A breaking change bumps the major
and keeps the old shape for one major. A plugin declares the range it was
written for as `code.api` (`"^1.0.0"`), and is refused, with the reason, when
the host's version isn't in it.

The API ships as a package generated from the same table the broker checks
(`src/shared/plugins/api.ts` → `plugin-api/`): a runtime Minerva serves at
`/@minerva/plugin-api.js` inside every plugin frame, so it always matches the
host; its `.d.ts`; and `abi.json`, the snapshot
`scripts/build-plugin-api.mjs` compares each change against.

A fork that changes the API says so with `pluginApiExtensions`, as forking.md
already decides. Its methods are named `<slug>:<name>` and sit outside the
snapshot; declaring and requiring them waits on forking.md's follow-up (item
5). Forks then carry the ABI the way they carry the on-disk formats.

## What stays MCP

**Decision:** in-process plugin code is for **rendering and transforming data
Minerva hands it**. MCP is for **reaching the world**. Anything that needs:

- the network;
- a secret;
- a runtime or native library of its own;
- work that runs in the background, outside any call;
- to be a tool the model calls directly (the `llm-tools` seam stays MCP for now)

is an MCP server, as in 4.0.

## The held stories

| Story | Proposed |
|---|---|
| #2640 views | Rewrite around the view API. Kanban, timeline and calendar are its first users. |
| #2641 live blocks | Rewrite around the view API. **Open:** blocks also render in exports, which run in main; an export would render the block in a headless plugin host. |
| #2642 inspections | Build as written (SPARQL). Code checks come later, through the worker host. |
| #2643 commands | Rewrite: a command whose handler is in the plugin's worker, placed through the existing `COMMANDS` registry. |
| #2647 ingestors | Rewrite: a parser in the worker, given the file's bytes. One that needs a native library stays MCP. |
| #2648 exporters | Rewrite: a writer in the worker, given the rendered document. |

## Order

1. **Python as a core plugin**, off by default, with enabling in
   `PRIVILEGED_CHANNELS`. A security gain now, and it needs no UI kit.
2. **The `minerva-plugin:` protocol, the frame, the host's `MessagePort` and
   the capability check**, with the hostile-plugin corpus from the start.
3. **The view API and UI kit, against kanban.**
4. **Timeline and calendar.**
5. **The worker host**, then commands, ingestors and exporters.
6. **Open the API to third-party plugins.**

## Open questions

- **Live blocks in exports**: a headless host per export, or a pure
  `render(data) → HTML` contract for blocks that must export?
- **Cost of a host per plugin.** A hidden sandboxed `WebContents` is tens of
  MB. Start lazily, stop when idle, or share one host between a user's own
  plugins?
- **Plugins written on the spot.** Should a plugin the user's own agent just
  wrote go through the same install approval, or land as a proposal in the
  review queue? The second fits the Trust Principle better.
- **The MCP client as a core plugin**: one plugin, or local and remote apart?
- **Shortcut conflicts** between plugins, and between a plugin and core.
- **How core plugins build**: packaged into `app.asar` under their own
  origin, from source in this repo, with the same `plugin check` in CI.
