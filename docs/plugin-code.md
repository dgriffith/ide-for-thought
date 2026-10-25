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

**As built (#2830).** `main/plugin-worker-host.ts`:

- **The host is an unattached `WebContentsView`**, not a window, so it never
  counts as one (window accounting, "all windows closed"): `sandbox: true`, no
  Node anywhere, the app's hardened preferences, on `minerva-plugin://<id>/`,
  showing Minerva's own page at a reserved path (`/@minerva/worker-host.html`,
  `plugins/worker-host-page.ts`). That page starts the plugin's `code.worker`
  module in a Web Worker and hands it the session port. The worker has no
  `require`, `process`, DOM or `window.api`, and `fetch` is refused by the
  origin's CSP. Measured in the packaged app.
- **One preload, two lines.** "No preload" can't hold: a page can only be
  handed a `MessagePort` from main through `ipcRenderer`. So the host page
  gets `preload/worker-host-preload.ts`, which forwards one port and exposes
  nothing. Plugin code never runs in the page, only in the worker.
- **Calls** go through the broker the other way: `session.call(handler,
  args)` sends `{ call }`; the runtime's `minerva.handle(name, fn)` answers
  `{ reply }`. A handler is announced when registered (`{ handles }`) and a
  call waits for it, so a module that awaits before registering misses none
  (API 1.10.0). The plugin calls the broker's methods as a frame does, scoped
  to the notes the call was given. One call at a time per host, so the scope
  is the call's own.
- **Deadline:** 10 s by default. A miss destroys the host (its process ends,
  the loop with it) and the call fails naming the plugin and the handler; the
  next call, even one already queued, starts a fresh host.
- **Cost, measured:** each host is its own renderer process, about **90 MB**
  working set (96 MB in the packaged e2e, beside the app window's ~197 MB).
  Two plugins can't share one: each is its own origin, so its own process.
  So hosts start on first use and stop after **60 s idle**, and stop when
  their plugin changes or their thoughtbase closes.

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

**As built (#2833).** An installed plugin may declare `code`; one with
`process` is refused, since a third party's program ships as an MCP server.

- **The hash is the whole folder** (`main/plugins/code-hash.ts`): every
  file the frame protocol could serve, so not dot-files or `node_modules/`.
  Each file goes in as its path, length and bytes, sorted. A skill edited in
  place is a change too, so nothing is left out.
- **It's asked natively, both times**, stricter than the decision above, so
  a renderer can't click it through. At install, *Install Board? It runs
  code inside Minerva*, with the capabilities in words, before the plugin
  goes in; declined, nothing is installed. On a change, Settings → Plugins
  says it's off until allowed again, and *Review and allow…* asks
  (`PLUGINS_APPROVE_CODE`, a privileged channel), listing what it can now
  do and no longer asks to.
- **The record** is `codeApproved: { hash, capabilities }` in
  `~/.minerva/plugins.json`. The scan loads a plugin with code only while
  that hash is its files' hash (`codeApprovalOf`). A changed one is off
  whole, still installed and still enabled, and its hosts and sessions stop
  with the next apply. A plugin dropped in by hand has no record, so it
  waits for approval.
- **An approval is of what was asked about**: `approvePluginCode`
  recomputes the hash and refuses if the files changed while the question
  was open.
- **The package checks the files its code names** (pages, logic, queries):
  each must be a file in the folder.
- `minerva plugin check` approves in its scratch folder; nothing there is
  the user's.
- **What its code adds reaches the app as a built-in's does.** Installed
  plugins' views, blocks and commands are in their summaries, and the
  renderer's `stores/code-plugins.svelte.ts` (`corePluginsStore` until
  #2833) serves them beside the built-ins, after them, while they're enabled
  and approved. Main already resolved installed plugins everywhere
  (`plugins/code-plugins.ts`). The plugin watcher's fingerprint includes
  the code hash, so an edit to a page or the logic applies at once.
- **`tests/fixtures/plugins/note-stats/`** is a third-party plugin with code,
  in plain JS: a panel fed by its own query, and a command run by its worker.
  `plugin-third-party-code.spec.ts` installs it, allows it, uses both, edits
  it in place, and allows it again.

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

**Calendar is done (#2829)** too (`plugins/calendar/`), and is the first to
put both patterns together:

- **Reschedules are the host's, on request** (API 1.7.0: `view.reschedule
  {path, days}`, `notes:write-properties`): the plugin decides the day count
  and the words it speaks itself (`ui.announce`); the type view runs the
  move store's `rescheduleEvent` (`type-view/calendar-reschedule.ts`), with
  *Moved by Calendar* as the history cause. ⌘Z is `view.undoMove`, which the
  host sends to the surface the layout's registry entry names (`moves:
  'board' | 'calendar'`), so a calendar never undoes a board's move.
- **The viewer's week** (its first day, week numbers) is in the view as
  `week`: "automatic" needs the OS region, which only main can read, so the
  host resolves it.
- **A sandboxed frame can't submit a form** (no `allow-forms`, by design): the
  *Move to date…* bar acts on Enter and on its button's click instead.
- **An export inliner must not copy what is the frame's**: a computed height
  (rows clipped to the frame) or an `auto` margin (it computes to pixels). The
  calendar's inliner puts the scaling rules back (`plugins/calendar/src/
  inline-styles.ts`, pinned by its test).
- `calendar-model` is in `src/shared/calendar/`: the host names the days in
  its announcements with it.

Its TypeView-level tests run the plugin's real `App.svelte` in loopback
(`tests/renderer/components/plugin-loopback.ts`): mounted beside the frame,
sent each view, preview and export request the host sends, its calls routed
to the host callbacks the broker's intents would reach.

### Global views (#2640)

A view that belongs to no type view: a panel in the left or right sidebar, or
an editor tab. A plugin declares it in `code.views`, each with a page in its
folder and the **query that feeds it**:

```json
"code": {
  "capabilities": ["graph:query", "notes:write-properties", "ui"],
  "api": "^1.8.0",
  "views": [{ "id": "queue", "title": "Reading Queue", "place": "left-sidebar",
              "entry": "index.html", "query": "queue.rq", "icon": "bookmark" }]
}
```

**Decision: Minerva runs the query, not the plugin.** A type view's scope is
its instances, handed over by the host. A global view has no host-chosen notes,
and letting *any* `graph.query` widen the scope would make `notes:read` mean
"every note", since one `SELECT` names them all. So the scope is the notes the
**declared** `.rq` names: main reads it from the plugin's folder (with the
frame protocol's containment), runs it read-only, scopes the session to the
note IRIs in its rows, and sends a `query` event (API 1.8.0) — the rows, plus
`notes`, each note IRI's path. The query can be read at install, and is
exactly what the view can be given. The plugin may still call `graph.query`
for anything else it shows; that never widens the scope.

- **The renderer never names the notes.** The panel host (`PluginPanel.svelte`)
  opens the session by the view's id and asks for a re-run on connect and on
  every graph change (`refreshQuery`); `setSessionScope` is refused for a view
  session. A slower earlier run that lands after a later one is dropped.
- **A view needs `ui` and `graph:query`**, which the validator checks. Writes
  are the usual scoped ones: the Reading Queue's ✓ sets a book's `status` (an
  article's `read`) to `read`, through `notes.setProperties`, on a note its
  query gave it. The graph changes, the query runs again, the row goes.
- **Panels are registry entries.** `pluginLeftPanels` / `pluginRightPanels`
  build ordinary `LEFT_PANELS` / `RIGHT_PANELS` entries from the views of the
  plugins that are on (`codePluginsStore.views(place)`); the right sidebar
  shows its Plugins group only while one is. A panel whose plugin is turned
  off falls back to Notes (or Outline).
- **Tabs.** `place: "tab"` is a view with no panel; any view opens as a tab,
  from the command palette (*Open <title>*, which for a sidebar view shows its
  panel instead) or a panel's *Open in tab*. The tab is a `plugin-view` tab
  (`pluginId`, `viewId`, `title`), one per view, saved with the session; its
  frame is a session of its own, fed by the same query. Restored with its
  plugin off, it says which plugin to turn on, as a type view's layout does.
- **The Reading Queue is the worked example** (`plugins/reading-queue/`, off
  by default): `public/queue.rq` is copied beside its page by the build, and
  `tests/main/plugins/reading-queue-query.test.ts` runs it against a real graph.

### Live blocks (#2641)

A fence (```recipe-card) or a `:::directive` in a note, drawn by a plugin's
page in a frame — in the preview and in every HTML export. A plugin declares
it in `code.blocks`, with exactly one of `fence` or `directive`, and
optionally a query:

```json
"blocks": [{ "id": "queue", "title": "Reading queue", "fence": "reading-queue",
             "entry": "index.html", "query": "queue.rq" }]
```

**Decision: an export draws the block through the plugin's frame, in the
window that asked for the export** — the path a plugin layout already
exports by (#2828). The block is a `window` live-block kind, `plugin`: the
export window mounts `PluginBlock` in export mode, sends the plugin the
block and then an `export` request, and draws its `view.provideExport`
answer through `sanitizePluginExportHtml` in the frame's place, which is what
the snapshot keeps. **Why not the issue's two options:** a pure
`render(data) → HTML` contract and a headless host both need the worker host
(#2830), and the first means a plugin writes its block twice. An export with
no window (the CLI) degrades the block to a one-line note, as it does every
`window` kind. Markdown exports keep the block verbatim.

**Decision: a block reaches the note it sits in, plus the notes its declared
query names.** Main runs that query, as for a global view; the block's own
text can't widen what it reaches. The plugin hears it all as a `block` event
(API 1.9.0): the block's text, the note, the query's results, and whether it
draws for an export.

- **Names.** A fence or directive name a built-in already draws (`mermaid`,
  `:::argument`, `:::query-*`, a cell language like `python`) is refused by
  the manifest check. Between plugins, the first to claim a name keeps it, in
  Settings' order — the same rule in the preview (`codePluginsStore.blockSyntax`)
  and in an export (`activePluginBlockSyntax`).
- **One registry entry.** `LIVE_BLOCKS` holds one `plugin` kind whose syntax is
  `{ plugin: true }`: which names it covers is per machine, so both sides
  resolve a name to a plugin's block when a note renders. The preview
  re-renders when a plugin is switched, as it does for Python.
- **Height.** A block is inline in flowing text, so its frame is as tall as
  the plugin asks (`view.setHeight`, clamped to 24–4000px); until it asks, 120px.
- **Keeping the frame.** A block's frame lives across preview re-renders, by
  the parking `hydrated-block-cache.ts` does before each `{@html}` swap
  (wrinkle 5, #2871): editing the note around a block keeps its page; editing
  the block's own text is a new block, with a new session.
- **The Reading Queue is the worked example**: a ```reading-queue fence
  draws the queue in a note (`limit: N` in its text), and answers an export
  with the list as inline-styled HTML, each title a `data-note-path` link.
  `export-parity-all-kinds` exports it beside every built-in kind, and
  `plugin-live-block.spec.ts` drives it in the preview.

### Commands (#2643)

A command a plugin adds is declared in `code.commands`. It lands in the
command palette, under *Plugins › its name*, and in the editor's right-click
menu (*Plugins*) when it says `editorMenu`:

```json
"commands": [{ "id": "sort-selection", "title": "Sort List in Selection",
               "when": "selection", "editorMenu": true,
               "run": { "handler": "sortSelection" } }]
```

`when` is `project` (the default), `note` or `selection`: what has to be
there for it to run, and what the palette greys it out without. `run` is
exactly one of:

- **`handler`**: a function the plugin's logic module registered with
  `minerva.handle()`, run in its worker host (above). The manifest needs
  `code.worker`.
- **`skill`**: a skill by id, as the palette runs it.
- **`query`**: an `.rq` in the plugin's folder, opened in a query tab.
- **`view`**: one of the plugin's own global views, opened.

So a command runs nothing its manifest doesn't show.

**Decision: a handler returns the change, and the editor makes it.** The
handler is handed `{ command, note, selection }` (the active note's path and
the selected text) and returns `{ replaceSelection?, announce? }`. Main
checks that shape and nothing else gets through (`plugin-commands.ts`). The
renderer replaces the text the command ran on, as one change ⌘Z undoes, and
only if that text is still selected (`replaceRangeIfUnchanged`). A command
that took a while can't overwrite what was typed meanwhile, and nothing races
the unsaved editor buffer. **Why not `notes:write`**, as the issue sketched:
a write to the file under an open, edited note fights the buffer, and ⌘Z
can't undo it. The handler's scope is still the active note, so one with
`notes:read` can read the whole note through the API.

- **Main decides, the renderer asks.** The renderer sends only which
  command and what it runs on (`plugins:runCommand`). Main checks the plugin
  is on, the command exists, its `when` is met and the note is a path an
  agent may name, then runs it or names the skill, query or view back.
- **Failure.** A handler that throws, or misses its deadline, fails the
  command with a message naming the plugin. The renderer shows it, and the
  app is unaffected.
- **Not yet.** An `mcpTool` command waits for a confirm card outside a
  conversation (a tool not marked read-only must ask, #2439). The native menu
  bar and keybindings wait on *Shortcut conflicts* below. All three are #2879.
- **List Tools is the worked example**, off by default: *Sort List in
  Selection* sorts the outermost items of the selected Markdown list, nested
  items and continuation lines moving with their parent
  (`plugins/list-tools/src/`). A plugin folder with `src/logic.ts` gets it
  built to `logic.js`, beside any page. `plugin-command.spec.ts` drives it
  from the palette and the editor menu.

### Ingestors (#2647)

A file type a plugin reads as a Source is declared in `code.ingestors`. The
Ingest File dialog offers its extensions beside Minerva's own:

```json
"ingestors": [{ "id": "transcript", "label": "Transcript",
                "accepts": { "extensions": [".srt", ".vtt"] },
                "parse": { "handler": "parseTranscript" } }]
```

**Data in, data out.** Main reads the file and hands the handler
`{ ingestor, filename, base64 }`: its name and bytes, no path, and no notes
in scope. The handler returns a source draft, `{ title, body, type?,
creators?, issued?, publisher?, abstract?, uri?, language? }`, and main
checks it field by field (`plugin-ingestors.ts`). An unknown field, a field
over its limit, a `uri` that isn't http(s), or a `type` that isn't one of
the Source classes fails the ingest, naming the plugin, and nothing is
written. `sources/ingest-draft.ts` writes the Source.

- **The body is someone else's text.** Every `<` in it is escaped, so it
  renders as text and never as HTML, as a clipped page's is (#2558). An LLM
  reads it as thoughtbase content, like any source body (#2438).
- **Provenance.** `meta.ttl` records `minerva:ingestedBy
  "plugin:<id>@<version>"` and the file's original name.
- **Limits.** A file of at most 640 KB, so its base64 fits in one 1 MiB
  message to the worker; the reply is bounded by the same limit.
- **Deduped before the plugin runs.** The Source's id is a hash of the file,
  so a file ingested twice doesn't reach the plugin the second time.
- **Minerva's own types stay Minerva's.** A plugin can't take an extension a
  built-in ingestor or import reads (`shared/source-file-types.ts`), and
  between plugins the first to claim one keeps it.
- **Only files, for now.** `urlMatch` and `identifierPattern`, and an
  `mcpTool` parser, need the network or a confirm outside a conversation:
  #2880.
- **Transcripts is the worked example**, off by default: `.srt` and `.vtt`
  caption files become a transcript, cues joined into paragraphs, each
  opening with the time it starts at, and a speaker named where they start
  talking (`plugins/transcripts/src/`). The issue's Kindle clippings file was
  a poor fit: it is a `.txt`, which Minerva reads, and one file holds many
  books.

### Exporters (#2648)

An export format a plugin writes is declared in `code.exporters`. Each is a
family of its own in the Export menu (*EPUB…*), after Minerva's, with the
same dialog, scopes and exclusion rules as every other exporter:

```json
"exporters": [{ "id": "epub", "label": "EPUB", "input": "html",
                "scopes": ["single-note", "folder", "project", "tree"],
                "write": { "handler": "writeEpub" } }]
```

**Data in, data out.** Main resolves the plan as for any exporter and hands
the handler `{ exporter, scope, title, notes }`, each note `{ path, title,
frontmatter }` plus its body: `html`, as Minerva renders it for export
(citations, live blocks, the dialog's link policy), or `markdown`, as
written. No notes are in scope, so what it's handed is all it can read. It
returns `{ files: [{ path, text | base64 }], summary? }`, and main checks
every path (relative, no `..`, no dot-segment, no two that differ only in
case) and every body (`plugin-exporters.ts`). **Minerva writes the files**,
through `runExport`, into the folder the user chose, so the plugin never
touches the disk.

- **Why its own family, not the issue's `group`.** A built-in family
  (Markdown, HTML, PDF…) is one format at several scopes, and a plugin's
  format is none of them. Joining one would make it a variant of HTML.
- **Limits.** The plan and the answer each travel in one 1 MiB message, so
  about 1 MB of rendered notes per export. Past that, the export is refused
  before the plugin runs ("Export fewer notes"). At most 256 files, and 30 s.
- **Images** stay as the HTML references them: a file the plugin can't read.
  An embedded one (a chart, rendered as a `data:` image) arrives whole.
- **Not yet.** An `mcpTool` writer is #2880.
- **EPUB is the worked example**, off by default
  (`plugins/epub/src/`): one chapter per note, a table of contents, and
  `mimetype` first and stored, as readers need. The rendered HTML is rewritten
  as XHTML (attributes quoted, void elements closed, named entities made
  numeric), a link to another exported note goes to its chapter, and an image
  it can't carry becomes its alt text. It zips with `jszip`, bundled into
  its `logic.js`.

### Inspections from code (#2831)

A health check a SHACL shape can't say (one that reads a note's body, say)
is declared in `code.inspections` and run by a handler in the plugin's
worker host, beside the built-in and SHACL checks in every sweep:

```json
"inspections": [{ "id": "skipped-heading", "label": "Skipped heading levels",
                  "description": "Headings that jump a level, like an H1 straight to an H3.",
                  "severity": "info", "query": "notes.rq",
                  "run": { "handler": "skippedHeadings" } }]
```

Its type is `plugin:<id>/<check>`, the same shape as a plugin's SHACL check,
so Settings → Inspections lists it under the plugin with a switch, and the
disabled list keeps it by pattern.

- **Minerva runs the query**, as for a global view: the handler is handed
  `{ check, query }`, and the notes the rows name are what it may read.
  A check with no query is handed nothing and can only use `graph:query`.
- **It only reads.** The call is capped at `notes:read` and `graph:query`,
  whatever else the plugin declares (`limitCapabilities` on the broker
  session, from `invokePluginLogic`'s `capabilities`). A plugin that moves
  cards on a board still can't write from its inspection.
- **Findings** come back as `{ findings: [{ message, note?, node?, label?,
  suggestedAction? }] }`, each naming a note path or a graph IRI, and main
  turns them into `shared/inspections.ts`'s `Inspection` (`plugin-inspections.ts`).
  At most 200 per sweep. No `fix`: a quick-fix would be a write.
- **A check that misses its 10 s deadline, throws, or answers anything else
  is one finding against the plugin**, saying so ("…didn't finish in 10 s, so
  it was stopped"), and the other checks run as usual. Unlike a SHACL check
  that runs too long (#2874), it isn't held back afterwards: its host is
  stopped, so it never cost main's thread, and the next sweep tries again.
- **Cost.** A sweep follows every save (debounced), so an active check keeps
  its host warm while you edit (~90 MB); it stops after 60 s idle.
- **Outline Checks is the worked example**, off by default
  (`plugins/outline-checks/`): *Skipped heading levels* reads every Markdown
  note its `notes.rq` names and reports a heading more than one level below
  the one before it, ignoring code and frontmatter.

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

**As built (#2832): the corpus.** The hostile fixtures in
`tests/fixtures/hostile-plugins/` make each attempt above, run in the real
app by the frame, session and worker-host specs, and `PLUGIN_CODE_CORPUS`
(`tests/helpers/hostile-plugins.ts`) lists them, each with the spec that
shows it contained. The coverage test fails on an attempt the frame offers
that the table doesn't list, or a case whose fixture or spec stopped
naming it. Writing it found one real hole: a message over the 1 MiB limit
was refused before its id could be read, so the plugin's call (or a
worker's answer to Minerva's) never settled. The runtime now refuses an
over-size call itself, and turns an over-size answer into an error; the
broker answers one it does receive by the id it opens with.

The capability check (`plugin check` running the plugin's code and failing
on any call outside what it declares) moved to #2833. It needs Electron's
CLI mode to host the code, and until third-party plugins can declare code
there is nothing for it to check.

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
| #2640 views | Rewritten around the view API, and built: sidebar panels and tabs (*Global views* above). |
| #2641 live blocks | Built: a fence or directive drawn by the plugin's frame, exported through the same frame in the export window (*Live blocks* above). |
| #2642 inspections | Built as SHACL shapes. Code checks are #2831, through the worker host (*Inspections from code* above). |
| #2643 commands | Built: a command in the palette and the editor menu that runs a handler in the plugin's worker, a skill, a query or a view (*Commands* above). |
| #2647 ingestors | Built: a file type read by a handler in the plugin's worker, given the file's bytes (*Ingestors* above). An `mcpTool` parser, and URL or identifier ingestors, are #2880. |
| #2648 exporters | Built: an Export menu family written by a handler in the plugin's worker, given each note rendered (*Exporters* above). An `mcpTool` writer is #2880. |

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

- **Plugins written on the spot.** Should a plugin the user's own agent just
  wrote go through the same install approval, or land as a proposal in the
  review queue? The second fits the Trust Principle better.
- **The MCP client as a core plugin**: one plugin, or local and remote apart?
- **Shortcut conflicts** between plugins, and between a plugin and core.
- **How core plugins build**: packaged into `app.asar` under their own
  origin, from source in this repo, with the same `plugin check` in CI.
