# Extending Minerva

When Minerva can't do something you want, the answer is usually to add it
yourself, and usually without code. This is the story the **Extend Minerva**
skill (Analysis → Organization) tells an assistant (#2652), written for a
person.

## The ladder: cheapest rung first

Every way in is a rung on one ladder. Each rung up costs more to understand,
review and keep working, so start at the bottom and climb only as far as you
need:

| Rung | What it is | Reach for it when |
|---|---|---|
| **setting** | Something already built in, switched on or tuned | It's there and you haven't found it |
| **skill** | A markdown prompt in a menu ([authoring skills](authoring-skills.md)) | You want the assistant to do a kind of thinking, on a note or a selection |
| **object type** | A kind of note with properties ([authoring types](authoring-types.md)) | You want to track a kind of thing: books, people, decisions |
| **query view** | A saved SPARQL or SQL query, or a note template | You want to see or start something the same way each time |
| **plugin** | A folder bundling any of the above, per machine ([authoring plugins](authoring-plugins.md)) | Several pieces belong together, or you want them in every thoughtbase |
| **mcp** | An MCP server a plugin ships: code, out of process | It needs code: an outside API, a file format, a real computation |
| **source** | Changing Minerva itself, or forking it ([forking](forking.md)) | Nothing above can reach it |

Most requests stop at a skill or a type. Code is the second-to-last rung, not
the first.

**The catalog says which seams exist and which rung each is on**:
[extension-points.md](extension-points.md), generated from
`src/shared/extensions/points.ts`. The assistant reads the same catalog with
`list_extension_points` and `describe_extension_point`, and so can a coding
agent over `minerva mcp`. A seam on the `source` rung takes no contributions
yet: only Minerva's own code adds to it.

## With the assistant

Run **Analysis → Organization → Extend Minerva** and say what you want ("I
want Minerva to keep a reading list, with a status per book"). It:

1. asks what it needs to, then looks the seams up in the catalog rather than
   guessing;
2. proposes the lowest rung that fits, and says why not the one below;
3. drafts it, once you agree.

It writes nothing itself:

- **A setting** it just names; there's nothing to draft.
- **An object type** for this thoughtbase is filed as a proposal, which you
  approve in the Proposals panel.
- **A saved query** it gives you to save from the Query panel.
- **A skill or a plugin** is shown as a card in the conversation, with every
  file in full. **Save to my skills** (a skill) or **Install** (a plugin)
  does what Settings → Skills → Import or Settings → Plugins → Install from
  folder… would, with the same checks. **Save to folder…** writes it
  wherever you pick, to edit or share. **Not now** does nothing.

The draft is checked before you see it, with the same parser and manifest
checker Settings uses, so a card you're shown can be saved. Installing a
plugin runs nothing: an MCP server it ships stays off until you switch it on
in Settings → MCP Servers, which shows you the exact command and asks first.
Main writes the copy of the draft it checked, never anything sent back from
the window.

## By hand, or with a coding agent

- **A skill**: a `.md` file in `~/.minerva/skills/`; see
  [authoring skills](authoring-skills.md).
- **A type**: a `.md` file in `<thoughtbase>/.minerva/types/`, or Settings →
  Object Types; see [authoring types](authoring-types.md).
- **A plugin**: a folder with a `plugin.json`, installed from Settings →
  Plugins; see [authoring plugins](authoring-plugins.md).
- **A plugin to start from**: `minerva plugin new <id> --kind <kind>` makes
  one with a working skill, type, query, template, citation style, theme or
  inspection, or a sidebar view or a command written as plugin code.
- **An MCP server**: `minerva plugin new <id> --mcp node` (or
  `--mcp python`) makes a plugin with a working server, a skill scoped to its
  tools and a test; see [the CLI](cli.md#plugin-scaffold).

Before you install one, `minerva plugin check <folder>` puts it through what
Minerva does with it and says what would fail; see
[the CLI](cli.md#plugin-check).

Whichever way you go, the same rules hold. A plugin can't shadow a built-in or
one of your own. Nothing runs code inside Minerva. Anything the assistant
writes to your notes is a proposal you approve.
