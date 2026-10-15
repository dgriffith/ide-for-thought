# Authoring Plugins

A plugin bundles things Minerva already knows how to read (skills, object
types, saved queries, note templates, citation styles) into one folder you can
add to a machine and remove again. It is the **plugin** rung of the ladder in
[`extension-points.md`](extension-points.md): reach for it once a single skill,
type or query isn't enough, and for an MCP server only when something has to
*run*.

> **Status (#2631).** This page describes the plugin *format*, which Minerva
> reads and checks (#2632). Loading a plugin's contributions into the app is
> the loader's job (#2633), and installing, enabling and removing without a
> restart is #2634. Until those land, a plugin folder is checked but nothing
> in it is used.

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
