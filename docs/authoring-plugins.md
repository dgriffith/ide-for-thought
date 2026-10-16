# Authoring Plugins

A plugin bundles things Minerva already knows how to read (skills, object
types, saved queries, note templates, citation styles) into one folder you can
add to a machine and remove again. It is the **plugin** rung of the ladder in
[`extension-points.md`](extension-points.md): reach for it once a single skill,
type or query isn't enough, and for an MCP server only when something has to
*run*.

> **Status (#2631).** Minerva reads and checks the plugin format (#2632), and
> loads everything a plugin can contribute today (#2633): skills, object
> types, saved queries, note templates, and citation styles and locales.
> **Settings → Plugins** installs one from a folder or a zip, turns plugins on
> and off and removes them, all without a restart (#2634); installing from a
> git URL is next.

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
```

Plugins are **per machine**. A thoughtbase can recommend a plugin by id
(#2635) but never carries one: a plugin inside a thoughtbase would be content
someone else chose, travelling with a shared folder.

The folder may be a link to where you're writing the plugin, so you can work
on it in place. Everything is then contained in the link's *target*.

## Installing and managing

**Settings → Plugins** lists what's installed (on or off, its version, what
it contributes) and the folders that were refused, with why.

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
| `contributes` | yes | Extension point → the files it adds there. At least one. |
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

Inspections, commands, live blocks, views, themes and MCP servers open to
plugins as their stories land (#2637, #2645). Until then, naming one in
`contributes` refuses the plugin.

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
- a contributed path:
  - isn't relative, uses `\`, or contains `..` or an empty segment;
  - isn't inside its point's folder (a type in `skills/`, say);
  - doesn't exist, or has the wrong extension;
  - leaves the plugin folder once links are followed;
  - is a folder anywhere but `skills/`, or a skill folder without `SKILL.md`
    or holding a link that leaves the plugin;
  - is listed twice.

The rules are `src/main/plugins/manifest.ts` (the manifest) and
`src/main/plugins/package.ts` (the folder).

## A complete example

`reading-list` adds a Book Note type, a query for the unread ones, and a skill
that summarizes a book note. It lives in
[`tests/fixtures/plugins/reading-list/`](../tests/fixtures/plugins/reading-list/),
and a test checks that the manifest below is that folder's `plugin.json`, that
the folder is accepted, and that each file is one the matching seam parses.

```
reading-list/
  plugin.json
  types/book-note.md
  queries/unread-books.rq
  skills/reading-summary.md
```

```json
{
  "id": "reading-list",
  "name": "Reading List",
  "version": "1.0.0",
  "minerva": ">=3.0.0",
  "description": "A Book Note type for what you're reading, a query for the unread ones, and a skill that writes a reading summary.",
  "author": "Ada Example",
  "license": "MIT",
  "contributes": {
    "object-types": ["types/book-note.md"],
    "saved-queries": ["queries/unread-books.rq"],
    "skills": ["skills/reading-summary.md"]
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

`skills/reading-summary.md` is a skill like any in `~/.minerva/skills/`; see
the fixture for its body.
