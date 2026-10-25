# Authoring Plugins

A plugin bundles things Minerva already knows how to read (skills, object
types, saved queries, note templates, citation styles) into one folder you can
add to a machine and remove again. It is the **plugin** rung of the ladder in
[`extension-points.md`](extension-points.md): reach for it once a single skill,
type or query isn't enough, and for an MCP server only when something has to
*run*. [Extending Minerva](extending-minerva.md) walks the whole ladder, and
the **Extend Minerva** skill drafts a plugin for you to install (#2652).

> **Status (#2631).** Minerva reads and checks the plugin format (#2632), and
> loads everything a plugin can contribute today (#2633): skills, object
> types, saved queries, note templates, and citation styles and locales.
> **Settings → Plugins** installs one from a folder, a zip or a git URL, turns
> plugins on and off and removes them, all without a restart (#2634).

Plugins are **declarative**. Every file a plugin contributes is data: a
Markdown skill, a type definition, a SPARQL query. Minerva never loads code
from a plugin. Anything that has to execute ships as an MCP server (#2645),
outside the app and behind the same approval gates as any other MCP server.

## Where a plugin lives

```
~/.minerva/plugins/<id>/
  plugin.json
  skills/      skills: a bare .md, or a folder holding SKILL.md
  types/       object types (.md)
  queries/     saved queries (.rq, .sql)
  templates/   note templates (.md)
  csl/         citation styles and locales (.csl, .xml)
  themes/      colour themes (.json)
```

Plugins are **per machine**. A thoughtbase can recommend a plugin by id
(see [below](#recommending-plugins-from-a-thoughtbase)) but never carries one:
a plugin inside a thoughtbase would be content someone else chose, travelling
with a shared folder.

The folder may be a link to where you're writing the plugin, so you can work
on it in place. Everything is then contained in the link's *target*.

## Installing and managing

**Settings → Plugins** lists what's installed (on or off, its version, what
it contributes) and the folders that were refused, with why.

Installing a plugin trusts its author the way [installing a
skill](authoring-skills.md#installing-a-skill-someone-else-wrote) does: its
skills' bodies become instructions to the model. It runs no code inside
Minerva, and an MCP server it ships stays off until you approve it (see
[MCP servers](#mcp-servers)). `minerva plugin check <folder>` puts it through
what Minerva does with it before you install it.

- **Install from folder…** copies the folder into `~/.minerva/plugins/<id>/`
  under the id its `plugin.json` declares. The copy is checked whole first: a
  plugin that would be refused is reported, every problem at once, and
  nothing is installed. A folder holding a link is refused (a copied link would
  point back to where it came from). Installing over a plugin of the same id
  asks before replacing it, and the old copy goes only once the new one
  passes.
- **Install from zip…** unpacks a `.zip` the same way. The plugin can be at
  the archive's top, or in a single folder at its top (what GitHub's
  "Download ZIP" makes). The archive is someone else's file, so it's refused
  whole if any entry would land outside the plugin's folder (an absolute
  path, a `..`, a backslash), if it holds a link, or if it's too big: over
  25 MB as an archive, 2,000 entries, 10 MB for one unpacked file or 50 MB in
  all. Sizes are checked before anything is decompressed, and an entry that
  unpacks to more than it declared is stopped. macOS's `__MACOSX/` and
  `.DS_Store` debris is skipped. The archive's name and SHA-256 are recorded.
- **Install from git URL…** fetches a public repository over HTTPS
  (`https://github.com/you/lab`, or `git@github.com:you/lab.git`, which is
  read as the same thing). Add `#v1.2.0`, `#some-branch` or `#<commit>` to pin
  a version; without one it takes the default branch. No credentials are ever
  sent, so a private repository has to come in as a zip. The download is
  capped at 25 MB and two minutes, and the commit is checked out under the
  zip's rules — no links, no submodules, the same size limits — then checked
  and installed like the others. The URL, the pin and the commit installed are
  recorded; reinstalling from the URL is how you update.
- **Turning a plugin off** keeps it installed; everything it contributes
  disappears until it's turned back on.
- **Remove** deletes its folder (only the link, if it's a link to a folder you
  work on).
- **No restart, ever.** Each change re-registers skills, rebuilds the menus,
  drops the template and citation caches, re-indexes each open thoughtbase
  when a plugin's object types changed (so a removed type leaves nothing in
  the graph), and refreshes every window.
- **Edits outside the app apply too.** Minerva watches `~/.minerva/plugins/`,
  so adding, editing or deleting a plugin there — by hand, or by an agent
  writing one — applies a moment later.

What's on and where each came from is kept in `~/.minerva/plugins.json`. A
plugin with no entry there (one put in the folder by hand) is on.

## Built-in plugins

Some of Minerva itself is packaged as plugins that ship inside the app
(#2820). Settings → Plugins lists them under **Built in**, each with an on/off
switch. They can't be removed, and installing doesn't apply to them: the
app's signature vouches for them, so there is nothing to approve.

- **Off means not running.** A built-in plugin that's off registers nothing:
  no handlers the window could call, no registry entries, no processes.
- **Per machine.** Whether one is on is recorded in `~/.minerva/plugins.json`,
  beside your installed plugins; with no record it has its default.
- **Its id is reserved.** A folder in `~/.minerva/plugins/` claiming a
  built-in plugin's id is refused, so nothing installed can stand in for one.
- **One that can run programs asks first.** Turning on a plugin whose code
  declares the `process` capability shows Minerva's own dialog, which the app's
  window can't draw or answer, saying what it can do (#2821).
- A thoughtbase can [recommend](#recommending-plugins-from-a-thoughtbase) a
  built-in plugin by id like any other, and that still turns nothing on.

How it works: [`docs/plugin-code.md`](plugin-code.md) → *Core plugins*.

## Recommending plugins from a thoughtbase

A thoughtbase that relies on a plugin (its notes use the plugin's types, say)
can list it in `.minerva/config.json` (#2635):

```json
{
  "recommendedPlugins": [
    {
      "id": "reading-list",
      "name": "Reading List",
      "source": "https://github.com/ada/reading-list#v1.0.0",
      "reason": "Book notes use its Book Note type.",
      "types": ["book-note"]
    }
  ]
}
```

Only `id` is required. `source` with a git URL gets an **Install** button;
any other address (a web page, say) is shown for the reader to follow.
`types` names the object types the plugin provides, so a note using one can
say exactly which plugin it needs.

Opening the thoughtbase shows one card listing the recommended plugins that
aren't in use on this machine, with **Install**, or **Turn on** for one that's
installed but off. **Not now** hides it until the thoughtbase is next opened;
**Don't show again** remembers that for this thoughtbase on this machine.
Settings → Plugins lists the recommendations either way.

A note whose `type:` isn't defined here (because its plugin is missing) is
not an error. The Properties panel shows the type's id with a hint naming the
recommended plugin that provides it, and nothing in the note is rewritten.

**A recommendation is only text.** The config file travels with a shared
thoughtbase, so its list is someone else's: entries are checked for shape,
capped at 20, and only ever shown. Nothing installs, turns on or downloads
until you press the button, and Install goes through exactly the checks of a
URL you typed yourself. The rules are `src/main/plugins/recommendations.ts`.

## `plugin.json`

| Field | Required | What it is |
|---|---|---|
| `id` | yes | Lowercase letters and digits in dash-separated words (`reading-list`), at most 64 characters. It must match the folder's name, and it namespaces everything the plugin contributes. |
| `name` | yes | What people see, at most 80 characters. |
| `version` | yes | A semver version: `1.0.0`, `2.1.0-beta.1`. |
| `minerva` | yes | The Minerva versions it works with, as a semver range: `>=3.0.0`, `^4.1.0`. A plugin outside its range is refused, and says which version it needs. |
| `description` | yes | One or two sentences, at most 500 characters. |
| `author` | no | Who wrote it. |
| `license` | no | An SPDX identifier (`MIT`, `Apache-2.0`). |
| `contributes` | yes | Extension point → the files it adds there. At least one, unless the plugin ships an MCP server. |
| `mcpServers` | no | MCP servers it ships; see [MCP servers](#mcp-servers). |
| `settings` | no | What the user can set for it on this machine; see [Settings](#settings). |
| `code` | no | What its code inside Minerva does, as `capabilities` from a closed list (#2823), and optionally `worker`: a `.js` module in the folder that runs in a sandboxed Web Worker and answers Minerva's calls with `minerva.handle(name, fn)` (#2830). **Only [built-in plugins](#built-in-plugins) may have one for now**; an installed plugin's code ships as an [MCP server](#mcp-servers). |
| `$schema` | no | Ignored; there for editors. |

Any other field is refused, so a misspelt `contributes` can't silently
contribute nothing.

### `contributes`

Keys are extension-point ids from the catalog. Each value lists files relative
to the plugin folder, one contribution per entry:

| Key | Folder | One entry is |
|---|---|---|
| `skills` | `skills/` | a `.md` skill, or a folder holding `SKILL.md` ([authoring skills](authoring-skills.md)) |
| `object-types` | `types/` | a `.md` type definition ([authoring types](authoring-types.md)) |
| `saved-queries` | `queries/` | a `.rq` (SPARQL) or `.sql` query |
| `note-templates` | `templates/` | a `.md` template |
| `csl-styles` | `csl/` | a `.csl` style or `.xml` locale |
| `themes` | `themes/` | a `.json` colour theme ([themes](#themes)) |
| `inspections` | `inspections/` | a `.ttl` file of SHACL shapes ([inspections](#inspections)) |

Commands, views, live blocks, ingestors, exporters and code inspections are
plugin code (`code.commands`, #2643; `code.views`; `code.blocks`;
`code.ingestors`, #2647; `code.exporters`, #2648; `code.inspections`, #2831),
declared in the manifest's `code` section, never in `contributes`. An installed
plugin may have one since #2833: Minerva asks, natively, before its code runs
(see `docs/plugin-code.md` → *Trust and approval*).

## Starting one

`minerva plugin new <id> --kind <kind>` makes a plugin folder with one working
contribution to start from (#2653): `skill`, `type`, `query`, `template`, `csl`,
`theme` or `inspection`; `view` or `command`, plugin code ([below](#plugin-code));
or `--mcp node|python` for an MCP server. What it writes passes
`minerva plugin check` as is. See [the CLI](cli.md#plugin-scaffold).

## Checking a plugin

`minerva plugin check <folder>` puts it through what Minerva does with it
before anyone installs it (#2654): the manifest, an install, each contribution
loaded and run against a tidy and a hostile thoughtbase, its MCP servers (with
`--run-servers`, which runs them) and a removal that must leave nothing
behind. Add `--thoughtbase <path>` to check against your own (a copy). See
[the CLI](cli.md#plugin-check) for the stages.

## What Minerva refuses, and what it contains

`tests/helpers/hostile-plugins.ts` is a corpus of plugins that misbehave
(#2655), each with a test, in the spirit of the hostile thoughtbase and the
prompt-injection corpus. `PLUGIN_CORPUS` there is the table:

- **Refused, whole:** a path that climbs out of the plugin; a contributed file
  that links outside it; a contributed file over 1 MB; a template nesting
  `{{#if}}` more than 32 deep.
- **Refused, that contribution:** a type with a stock type's id; the second
  plugin to claim an id another plugin has.
- **Contained:** a skill whose body is a prompt injection still gets the note's
  text only in the user turn, delimited; a template's `<script>`, `<style>` and
  event handlers are stripped like any note's; SQL reading `.minerva/` is
  refused wherever it runs unasked (a template's query block, a chart), and
  flagged by `plugin check`; a thoughtbase recommending plugins installs,
  enables and fetches nothing; with no system key store, a secret is kept in an
  owner-only file and Settings says it isn't encrypted.
- **Residual, documented:** an MCP server whose tool claims `readOnlyHint` but
  writes runs that tool without asking, once the user has turned the server
  on. Turning it on always asks first, natively.

## How contributions load

Minerva reads `~/.minerva/plugins/` once, the first time a skill or type
catalog loads, never in front of the window. Then:

- **A contribution keeps its own id.** A plugin's type `book-note` is
  `book-note`: notes say `type: book-note`, and its class is `types:BookNote`.
  The plugin is the contribution's provenance: `plugin:<id>@<version>` in the
  graph's extension catalog, and its name beside the contribution in Settings.
- **A plugin can't shadow anything.** A skill or type whose id is already a
  stock or user one is refused, and so is the second plugin to claim an id
  (refused against that plugin, naming the first). A plugin skill can't take
  a slash command that's already in use either.
- **Types: stock < plugin < thoughtbase.** A thoughtbase's own
  `.minerva/types/` file of the same id overrides a plugin's type, the same
  way it overrides a stock type. In Settings → Object Types, editing a
  plugin's type saves that customized copy, and **Revert** goes back to the
  plugin's. A plugin type can extend a stock type (`parent: book`), and a
  thoughtbase type can extend a plugin's.
- **Saved queries** are listed under **Query ▸ Saved Queries** in a section
  named for the plugin, and run like any other. They're read-only: Edit Saved
  Queries doesn't show them, and nothing in the app will rename, move or
  delete a plugin's file.
- **Note templates** appear in New Note and Insert Template, with the
  plugin's name beside them. A thoughtbase template of the same name wins,
  and the second plugin to use a name is skipped.
- **Citation styles and locales: bundled < plugin < thoughtbase**, as for
  types. A plugin's style can't replace a bundled one, the thoughtbase's own
  imported style of the same id wins, and Settings → Bibliography names the
  plugin a style came from. A file that isn't valid CSL is skipped.
- **One bad file costs only itself.** A skill or type that doesn't parse is
  reported against its plugin, in the same list as any other skill or type
  problem, and the plugin's other contributions still load.

## MCP servers

A plugin can ship code as an MCP server (#2646), declared in `plugin.json`.
It runs out of process, and only once the user turns it on.

```json
"mcpServers": {
  "words": {
    "title": "Word counting",
    "command": "node",
    "args": ["server/index.js"],
    "env": { "WORD_TOOLS_TOKEN": "${settings.apiToken}" }
  }
}
```

- **The program is the plugin's own.** `command` is a file inside the plugin
  folder (`bin/server`), or `node`, `python3` or `python` with the script, a
  file inside the folder, as the first argument. Links are followed and must
  stay inside; a path may not start with `-`. Anything else refuses the
  plugin.
- **It runs in the plugin folder**, with only the few variables any program
  needs (`PATH`, `HOME`, locale) plus `env`. An `env` value can name the
  plugin's [settings](#settings) as `${settings.<key>}`, secrets included:
  this is where a secret goes, and the only place.
- **Nothing runs until the user says so.** The server is listed in
  Settings → MCP Servers as `<plugin id>.<key>`, switched off. Switching it
  on shows main's own dialog, which the app's window can't draw or answer,
  with the exact program, the plugin and version, and the env names (never
  values). The approval is kept per machine in `~/.minerva/plugins.json`.
- **A new version is a new server.** The approval is for that declaration
  and that plugin version: an update, or an edited `mcpServers`, switches it
  off until approved again, and the "don't ask again" choices for its tools
  start over. A changed setting only restarts it with the new values.
- **Its tools are like any MCP server's.** The assistant reaches them through
  `mcp_call`; a tool not marked `readOnlyHint: true` asks in the conversation
  first, and is refused where there's no one to ask.
- Turning the plugin off or removing it stops the server; removing it also
  forgets the approval.

**A plugin's skills can use its own server's tools** (#2649). Name them in
the skill's `tools:`, by the server's key in `mcpServers`:

```yaml
tools: [mcp:words/count_words]   # one tool
tools: [mcp:words]               # every tool the server offers
```

The conversation the skill opens then reaches **only** those: `mcp_call`'s
catalog lists them alone, and a call to anything else, another server or
another of this server's tools, is refused before it's sent. The scope is
worked out in main from the skill and kept with the conversation, so it
survives a reload. Every other conversation still sees every running server.
The usual gates hold inside the scope: a tool not marked read-only asks
first, and the server must be switched on. Only a plugin's skills can name
`mcp:` tools, and only servers their own plugin ships; anything else refuses
the skill. The Word Tools example's `skills/word-count.md` does this.

[`tests/fixtures/plugins/word-tools/`](../tests/fixtures/plugins/word-tools/)
is a worked example: a dependency-free Node server with a read-only tool and
one that asks first, and a secret setting passed in as its environment.

**To start one of your own**, `minerva plugin new <id> --mcp node` (or
`--mcp python`) makes `<id>/` with all of this wired up (#2650): a
dependency-free server with a read-only tool and one that asks first, a
setting passed in as its environment, a skill scoped to its tools, and a test
that drives the server over stdio (`npm test` or `python3 -m unittest`). See
[the CLI](cli.md#plugin-scaffold).

## Themes

A plugin's `themes/<id>.json` adds a colour theme (#2787). It's listed after
Dark, Light, High Contrast and System in every theme picker: the status bar,
Settings → Appearance, the command palette and View → Theme.

```json
{
  "label": "Solarized Dark",
  "base": "dark",
  "tokens": { "--bg": "#002b36", "--text": "#eee8d5", "--accent": "#b58900" }
}
```

- **`base` is required**, `dark` or `light`. Every token the theme leaves out
  comes from its base, and charts, diagrams and maps that pick dark or light
  colours use the base.
- **Tokens only, from the built-in themes' own list**
  (`src/shared/theme-tokens.ts`: `--bg`, `--text`, `--accent`, the
  `--titlebar-*` and `--appbar-*` sets, the highlight colours and so on). An
  unknown token refuses the file, naming it. A theme recolours Minerva; it
  can't change type, layout or what's shown.
- **Values are colours**: `#hex`, `rgb()`, `hsl()`, `oklch()` and the like,
  a colour name, or `var(--token)` to reuse another. No `url()`, no
  `@import`, nothing that isn't a colour.
- **Contrast is checked, not enforced.** Text/background pairs the app uses
  that fall below WCAG AA's 4.5:1 are listed under the Theme setting while
  the theme is chosen. Watch `--titlebar-text` on `--bg-titlebar`: they
  follow `--text` and `--bg-elev` unless you set them.
- A file that breaks a rule is refused on its own, and Settings → Appearance
  says why; the plugin's other themes still load.
- **Turning the plugin off** while its theme is in use switches to System
  without forgetting the choice. Turning it back on brings the theme back.
- `cycleTheme` (<kbd>⌘⇧T</kbd>) cycles the built-ins only.

[`tests/fixtures/plugins/solarized/`](../tests/fixtures/plugins/solarized/)
is a worked example: Solarized Dark and Light.

## Inspections

A plugin's `inspections/*.ttl` adds health checks (#2642), written as
[SHACL](https://www.w3.org/TR/shacl/) shapes: the W3C standard for "the data
should look like this". Each `sh:NodeShape` with a target is one check. Its
findings show in the Inspections panel, and Settings → Inspections has a
switch for it, marked with the plugin's name. Minerva's own declarative
checks are shapes too (`src/main/graph/shacl/stock-inspections.ttl`).

```turtle
@prefix sh:      <http://www.w3.org/ns/shacl#> .
@prefix types:   <https://minerva.dev/ontology/types#> .
@prefix minerva: <https://minerva.dev/ontology#> .
@prefix ex:      <https://example.org/my-plugin#> .

ex:BooksNeedAnAuthor
  a sh:NodeShape ;
  sh:targetClass types:Book ;
  sh:name "Books without an author" ;
  sh:description "Every book should say who wrote it." ;
  sh:severity sh:Warning ;
  sh:message "\"{$this}\" has no author" ;
  minerva:inspectionGroup "sources" ;
  minerva:suggestedAction "Add its author" ;
  sh:property [ sh:path <http://purl.org/dc/terms/creator> ; sh:minCount 1 ] .
```

| A finding's | Comes from |
|---|---|
| name and description in Settings | `sh:name`, `sh:description` (the shape's name, if there's no `sh:name`) |
| severity | `sh:severity`: `sh:Info`, `sh:Warning`, or `sh:Violation`, which is the default and shows as a concern |
| message | the check's own `sh:message`, where `{$this}` is the note's title; without one, the failing constraint's |
| group in the panel | `minerva:inspectionGroup`: `notes`, `links`, `sources`, `arguments`, or `plugins`, the default |
| suggested action | `minerva:suggestedAction`, with `{$this}` as in the message |

- **Targets follow the type hierarchy.** `sh:targetClass thought:Claim` also
  reaches notes typed `claim` (`types:Claim ⊑ thought:Claim`), and a subtype's
  notes reach its parent's shapes.
- **SHACL-SPARQL works** (`sh:sparql` with an `sh:select`, prefixes through
  `sh:prefixes` / `sh:declare`). A `{?var}` in its `sh:message` shows a
  literal in quotes and an IRI as its title.
- **A shape only reads.** Every `sh:select` must be a SELECT and every
  `sh:ask` an ASK, or the file is refused. The graph a shape sees refuses
  writes, and a `SERVICE` or `FROM <http://…>` reaches no network.
- **Bounded.** A check that runs over 10 seconds reports nothing, and a check
  reports at most 200 findings.
- A file that breaks a rule is refused on its own, naming the rule; the
  plugin's other files still load. A file is at most 256 KB and 32 checks.
- Each check's type is `plugin:<plugin id>/<shape name>`, so the shape's name
  (the end of its IRI) must be letters, digits, `_` and `-`.

## Settings

A plugin can declare settings (#2636), and Settings → Plugins shows a form
for them under the plugin's **Settings** button. `settings` maps a name
(letters, digits and `_`, starting with a letter) to a JSON Schema subset:

```jsonc
"settings": {
  "summaryLength": { "type": "string", "enum": ["short", "long"], "default": "short" },
  "maxItems":      { "type": "number", "minimum": 1, "maximum": 50, "default": 10 },
  "includeQuotes": { "type": "boolean", "default": true },
  "citationNote":  { "type": "string", "title": "Note to add", "description": "Appended to each summary." },
  "apiToken":      { "type": "secret", "title": "API token" }
}
```

| Keyword | For | What it does |
|---|---|---|
| `type` | all | `string`, `number`, `boolean`, or `secret` (Minerva's one addition: a string kept encrypted). |
| `title` | all | The field's label, at most 80 characters. Without one, the name is turned into words (`maxItems` → "Max items"). |
| `description` | all | A line of help under the field, at most 500 characters. |
| `default` | all but `secret` | The value until the user sets one; it must fit the field. |
| `enum` | `string` | 1 to 50 different choices, shown as a menu. |
| `minimum`, `maximum` | `number` | The range the form accepts. |

Anything else (an unknown keyword, a default that doesn't fit, more than 32
settings) refuses the plugin, like any other manifest problem.

- **Values are per machine**, in `~/.minerva/plugin-settings.json`, never in
  a thoughtbase. Removing a plugin removes its values.
- **A skill reads a setting** as `{{plugin.settings.<name>}}`, the saved
  value or else the default, so a change applies to the next run. Only the
  plugin's own skills can, and naming a setting the manifest doesn't declare
  refuses the skill.
- **A secret is write-only.** It's stored encrypted with the system key
  store, and Settings shows only whether one is saved. No template can read
  it: a skill naming one is refused, so a secret can't reach a prompt. On a
  machine with no key store it's still saved, as plain text in a file only
  your account can read, and the form says so. Secrets are for the plugin
  MCP servers to come (#2645), which will receive them as environment
  variables.

## Plugin code

A plugin can also carry code that runs **inside Minerva, sandboxed** (#2833):
a page drawn in a frame, and logic run in a worker. It's declared in the
manifest's `code` section, never in `contributes`, and it reaches Minerva
only through the plugin API, with the capabilities it names. How it all
works, and why, is [plugin code](plugin-code.md).

| `code` field | What it is | In [plugin code](plugin-code.md) |
|---|---|---|
| `capabilities` | What the code may do, from the table below. Anything outside them is refused when called. | |
| `api` | The plugin API versions it was written for: a semver range like `"^1.10.0"`. | *Forks and the ABI* |
| `views` | Global views: a panel in a sidebar, or a tab, each a page fed by a query it declares. | *Global views* |
| `blocks` | Live blocks: a fence or `:::directive` in a note, drawn by a page of its own. | *Live blocks* |
| `worker` | Its logic: a `.js` module run in a Web Worker, which registers handlers. | *Logic* |
| `commands` | Commands in the palette and the editor menu, run by a handler, a skill, a query or a view. | *Commands* |
| `ingestors` | File types read as Sources, by a handler handed the file's bytes. | *Ingestors* |
| `exporters` | Export formats written by a handler handed the rendered notes. | *Exporters* |
| `inspections` | Health checks a SHACL shape can't say, run by a handler. | *Inspections from code* |

| Capability | Lets it |
|---|---|
| `notes:read` | read the notes Minerva hands its views and commands, and only those |
| `graph:query` | run read-only queries over the graph and tables |
| `ui` | open notes, show menus and make announcements |
| `notes:write-properties` | change the properties of notes it was given |
| `notes:write` | create notes, and change the notes it was given |

`llm:propose` is declared but not available yet (#2858), and `process`
(running a program) is for Minerva's own plugins only: a plugin's program
ships as an MCP server ([above](#mcp-servers)). Whatever it declares, its code
can't reach the network, your files, other plugins or Minerva's own pages,
and every note it writes is recorded in Local History as its own.

- **The API** is a module Minerva serves to every plugin page and worker:
  `import { connect } from '/@minerva/plugin-api.js'`. Its types are in
  `plugin-api/index.d.ts` in Minerva's repository.
- **Ship built files.** Minerva serves the plugin folder as it is: HTML,
  JavaScript modules, CSS, images. A plugin with a build step ships its output.
- **Minerva asks before it runs.** Installing a plugin with code asks, in a
  system dialog, naming what it can do. Any change to its files afterwards
  (an upgrade, an edit in place) turns it off until you allow it again from
  Settings → Plugins, where *Review and allow…* shows what changed.
- `minerva plugin new <id> --kind view` or `--kind command` makes one to
  start from.

### A plugin with code: Note Stats

A sidebar panel of how many words each note has, and a command that counts
the words in the selection. It's `tests/fixtures/plugins/note-stats/` in
Minerva's repository, and its test holds this page to it. The manifest:

```json
{
  "id": "note-stats",
  "name": "Note Stats",
  "version": "1.0.0",
  "minerva": ">=3.0.0",
  "description": "A sidebar panel of how many words each note has, and a command that counts the words in your selection.",
  "author": "Minerva's tests",
  "license": "MIT",
  "contributes": {},
  "code": {
    "capabilities": ["notes:read", "graph:query", "ui"],
    "api": "^1.10.0",
    "worker": "logic.js",
    "views": [{ "id": "lengths", "title": "Note Lengths", "place": "left-sidebar", "entry": "panel/index.html", "query": "panel/notes.rq" }],
    "commands": [{ "id": "count-selection", "title": "Count Words in Selection", "when": "selection", "editorMenu": true, "run": { "handler": "countWords" } }]
  }
}
```

`panel/notes.rq` is the panel's query. Minerva runs it and sends the
results to the page as a `query` event; the notes they name are what the page
may read. The page, `panel/app.js`, reads each and lists them:

```js
// Note Stats' panel: Minerva runs notes.rq and hands it the notes; it reads
// each, counts its words, and lists them longest first. A row opens its note.
import { connect } from '/@minerva/plugin-api.js';
import { countWords } from '../words.js';

const minerva = await connect();
const list = document.getElementById('lengths');

minerva.on('query', async ({ notes }) => {
  const paths = [...new Set(Object.values(notes))];
  const rows = [];
  for (const path of paths) {
    const note = await minerva.notes.read({ path });
    rows.push({ path, title: path.replace(/^.*\//, '').replace(/\.md$/, ''), words: countWords(note.content) });
  }
  rows.sort((a, b) => b.words - a.words || a.title.localeCompare(b.title));
  list.replaceChildren(...rows.map((r) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const title = document.createElement('span');
    title.textContent = r.title;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${r.words} ${r.words === 1 ? 'word' : 'words'}`;
    button.append(title, n);
    button.addEventListener('click', () => { void minerva.ui.openNote({ path: r.path }).catch(() => undefined); });
    li.append(button);
    return li;
  }));
});
```

The command's handler is in `logic.js`, which runs in the plugin's worker.
It's handed the selected text and returns what to say:

```js
// Note Stats' logic, in its worker host: the command's handler. It is handed
// the selected text and returns what to say; it changes nothing.
import { connect } from '/@minerva/plugin-api.js';
import { countWords } from './words.js';

const minerva = await connect();

minerva.handle('countWords', ({ selection }) => {
  const n = countWords(selection ?? '');
  return { announce: `${n} ${n === 1 ? 'word' : 'words'} selected.` };
});
```

`words.js` (the counting both share) and `panel/index.html` are the rest.

## What makes a plugin refused

A plugin is checked whole. With any problem, none of it is used, and Minerva
reports every problem at once (the same per-item report as a skill that
doesn't parse), naming the plugin and, where it got that far, its id and
version. One bad plugin never stops another from loading.

A plugin is refused when:

- `plugin.json` is missing, isn't valid JSON, is over 64 KB, or is a link;
- a required field is missing or empty, there's an unknown field, or `id`
  doesn't match the folder's name;
- `version` isn't semver, `minerva` isn't a range, or this Minerva is outside
  that range;
- `contributes` is empty, or names a point plugins can't contribute to yet;
- its `id` is a [built-in plugin's](#built-in-plugins);
- it has a `code` section, which only built-in plugins may have for now;
- a contributed path:
  - isn't relative, uses `\`, or contains `..` or an empty segment;
  - isn't inside its point's folder (a type in `skills/`, say);
  - doesn't exist, or has the wrong extension;
  - is over 1 MB (a skill folder's `SKILL.md` too);
  - leaves the plugin folder once links are followed;
  - is a folder anywhere but `skills/`, or a skill folder without `SKILL.md`
    or holding a link that leaves the plugin;
  - is listed twice.

The rules are `src/main/plugins/manifest.ts` (the manifest) and
`src/main/plugins/package.ts` (the folder).

## A complete example

`reading-list` adds a Book Note type, a query for the unread ones, a skill
that summarizes a book note, and an inspection for finished books with no date. It lives in
[`tests/fixtures/plugins/reading-list/`](../tests/fixtures/plugins/reading-list/),
and a test checks that the manifest below is that folder's `plugin.json`, that
the folder is accepted, and that each file is one the matching seam parses.

```
reading-list/
  plugin.json
  types/book-note.md
  queries/unread-books.rq
  skills/reading-summary.md
  inspections/finished-books.ttl
```

```json
{
  "id": "reading-list",
  "name": "Reading List",
  "version": "1.0.0",
  "minerva": ">=3.0.0",
  "description": "A Book Note type for what you're reading, a query for the unread ones, a skill that writes a reading summary, and a check for finished books with no date.",
  "author": "Ada Example",
  "license": "MIT",
  "contributes": {
    "object-types": ["types/book-note.md"],
    "saved-queries": ["queries/unread-books.rq"],
    "skills": ["skills/reading-summary.md"],
    "inspections": ["inspections/finished-books.ttl"]
  },
  "settings": {
    "summaryLength": {
      "type": "string",
      "title": "Summary length",
      "enum": ["short", "long"],
      "default": "short"
    }
  }
}
```

`types/book-note.md` is an ordinary type definition. Its notes are
`types:BookNote`, and its `status` property is indexed as
`minerva:meta-status`:

```markdown
---
label: Book Note
icon: 📗
color: "#a6e3a1"
properties:
  - name: author
    type: text
  - name: status
    type: enum
    options: [unread, reading, finished]
  - name: finished
    type: date
---

## Why I'm reading it

## Notes
```

`queries/unread-books.rq` is a saved query, named by its `# @name` line:

```sparql
# @name Unread books
# @order 1

SELECT ?note ?title WHERE {
  ?note a types:BookNote ;
        dc:title ?title .
  OPTIONAL { ?note minerva:meta-status ?status }
  FILTER(!BOUND(?status) || ?status = "unread")
}
ORDER BY ?title
```

`skills/reading-summary.md` is a skill like any in `~/.minerva/skills/`,
except that it reads the plugin's `summaryLength` setting as
`{{plugin.settings.summaryLength}}`; see the fixture for its body.

`inspections/finished-books.ttl` is a SHACL shape (see *Inspections* above):
every Book Note either isn't `finished`, or has a `finished` date. A note that
fails it shows in the Inspections panel, worded by its `sh:message`, and
Settings → Inspections has a switch for it, *From Reading List*:

```turtle
@prefix sh:      <http://www.w3.org/ns/shacl#> .
@prefix types:   <https://minerva.dev/ontology/types#> .
@prefix minerva: <https://minerva.dev/ontology#> .
@prefix reading: <https://example.org/reading-list/shapes#> .

# A Book Note marked finished, with no date it was finished on.
reading:FinishedWithoutDate
  a sh:NodeShape ;
  sh:name "Finished books without a date" ;
  sh:description "Book notes marked finished that don't say when." ;
  sh:severity sh:Info ;
  minerva:inspectionGroup "notes" ;
  sh:targetClass types:BookNote ;
  sh:message "\"{$this}\" is finished but has no finished date" ;
  minerva:suggestedAction "Set its finished property to the day you finished it" ;
  sh:or (
    [ sh:not [ sh:path minerva:meta-status ; sh:hasValue "finished" ] ]
    [ sh:path minerva:meta-finished ; sh:minCount 1 ]
  ) .
```

## Another example: a cookbook

[`tests/fixtures/plugins/cookbook/`](../tests/fixtures/plugins/cookbook/)
fills four seams from files alone, and
`tests/main/plugins/cookbook-example.test.ts` installs it and checks each one:

- `types/recipe.md`: a **Recipe** type, so a note with `type: recipe` is
  typed in any thoughtbase on the machine, with nothing in `.minerva/types/`.
- `skills/find-variations.md`: a **research** skill, listed under
  Research ▸ Cooking and as `/variations`. Like any skill, the note it reads
  goes into the user's message, never the instructions.
- `queries/quick-recipes.rq`: **Quick recipes**, the recipes of 30 minutes or
  less, under Query ▸ Saved Queries in the plugin's section.
- `templates/Recipe.md`: a **Recipe** note template, in New Note and Insert
  Template.
