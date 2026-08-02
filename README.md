# Minerva

**A desktop workspace for thinking and building with AI.**

The best thinking you do with an AI vanishes into a scroll of throwaway
conversations — unsourced, unstructured, impossible to build on. Minerva is
where that work lands and stays: knowledge you can check, connect, and keep.
You and the AI build it together — with you fully in control.

Minerva is a local-first desktop app (Electron · Svelte 5 · TypeScript). Your
notes are plain markdown files on your disk, backed by an automatically
maintained knowledge graph.

## Thoughtbases

A **thoughtbase** is where your thinking on a subject lives and grows. Instead
of scattered documents and lost chat threads, you collect what you're working
through as **notes** — and notes link to each other, so ideas connect the way
they do in your head. Some you write yourself; some you draft side by side with
the AI. Over time it becomes a living map of what you know, not a folder of dead
files.

- **Notes of every kind** — a paragraph, an essay, a data table, a diagram, an
  image, a math derivation, or a captured web page.
- **Linked, not filed** — connect any note to any other: cite it, support it,
  contradict it, build on it.
- **Yours and the AI's, together** — write by hand, or let the AI draft,
  summarize, and gather — with you approving what actually lands.

## Features

### The editor

A fast CodeMirror 6 surface with live preview. Write plain markdown; get
rendered blocks without leaving the keyboard.

- **Three view modes** — source, preview, or split, toggled instantly.
- **Wiki-links & typed links** — `[[note]]` plus 11 semantic link types
  (supports, rebuts, depends-on, supersedes…), each color-coded.
- **Rich blocks inline** — callouts, tables, footnotes, highlights, math
  (KaTeX), and diagrams.
- **Code sections that run** — Python, SQL, SPARQL, and Vega/Vega-Lite charts
  render live against your data.
- **Voice dictation** — on-device speech-to-text with AI-powered expansion.

### The knowledge graph

On every change, Minerva reads the structure out of your writing — titles,
tags, links, metadata, even data tables — into an RDF **knowledge graph**: a
precise map of everything you've written and how it connects. That's what lets
the AI work from your real notes instead of guessing.

- **Grounded, not guessed** — the AI queries your graph to answer from what you
  actually wrote, and points back to the exact notes it drew on.
- **Insights surfaced** — trace how a claim is supported, find where notes
  contradict each other, or spot patterns across hundreds of them.
- **Built automatically** — titles, `#tags`, wiki-links, metadata, and data
  tables all fold in on save. No schema wrangling.
- **Query it yourself** — a built-in panel for direct SQL and SPARQL.

### Data & analysis

- **Python cells** — a `python` code fence turns any note into a notebook, with
  a `minerva.*` API (`notes()`, `sparql()`, `sql()`, `table()`) handing you your
  own library as data; output renders inline.
- **CSV → SQL tables** — any `.csv` becomes a typed DuckDB table you can query
  and bind straight into charts.
- **Analysis skills** — generate visualizations, find outliers, and find
  correlations, each returned as a note you review.

### Tools for Thought — skills

Nearly 50 **skills**: structured thinking operations you invoke from the
Learning, Research, and Analysis menus — *Explain Like I'm…*, *Check Facts*,
*Extract Key Claims*, *Steelman*, *Double Crux*, *Murphyjitsu*, and many more.
Each runs a careful prompt over your note and returns something you review.
Author your own in a markdown file; it shows up in the menus alongside the
built-ins.

### The AI proposes. You confirm.

Nothing an AI generates touches your thoughtbase directly. Every suggested
claim, edit, tag, or source arrives as a **proposal** you review side by side
and accept with a keystroke — or reject.

- **Review before it counts** — see exactly what would change, before it does.
- **You set the line** — new claims require your sign-off; trivial tags can
  apply quietly. Tune what needs approval.
- **Full provenance** — everything the AI touches records what proposed it, and
  when.
- **Guaranteed, not promised** — a built-in integrity check can prove nothing
  the AI created ever skipped your approval.

### Structured reasoning

Under the hood, Minerva models the *shape* of an argument, not just its text.
Its thought ontology captures claims, the grounds and warrants behind them,
questions and hypotheses, and the ways reasoning goes wrong (fallacies, biases,
rhetorical moves) — with anchored excerpts and W3C PROV-O provenance throughout,
all queryable.

### Sources & the web clipper

- **Minerva Clipper** — one-click browser capture of the rendered page and a
  canonical source ID, even behind a login.
- **Import anything** — PDFs (with OCR), DOI / ISBN / arXiv IDs, BibTeX, and
  Zotero RDF.
- **Real metadata & a source viewer** — read a source inline, anchor excerpts,
  and see every note that cites it.
- **Citations** — CSL styles (APA, Chicago, MLA…) and BibTeX export.

### Foundations

- **Local & private** — plain files on your disk; voice, embeddings, and search
  all run on-device.
- **Semantic + full-text search** — on-device embeddings find notes by meaning,
  not just keywords.
- **Live file sync** — edit notes anywhere; Minerva re-indexes the moment
  changes hit disk.
- **Keyboard-first** — every major action has a shortcut. A professional tool
  that stays out of your way.
- **Themes & layout** — dark, light, and high-contrast themes; split panes and
  multiple windows.

### Export & publish

No lock-in — export a single note or a whole folder tree to Markdown, HTML, PDF,
a browsable static site, Anki decks (`.apkg`), BibTeX, Pandoc (DOCX / EPUB / …),
or RDF/Turtle.

## Tech Stack

- **Electron** — Desktop runtime
- **Svelte 5** — UI framework (using runes)
- **TypeScript** — Strict mode throughout
- **CodeMirror 6** — Editor
- **markdown-it** — Rendering
- **rdflib** — Knowledge graph
- **DuckDB** — In-note SQL over CSV tables
- **onnxruntime-web** — On-device embeddings for semantic search
- **isomorphic-git** — Version control (no system git required)
- **Vite + electron-forge** — Build tooling

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Lint gate: tsc + svelte-check + eslint
pnpm lint

# Run tests
pnpm test

# Package the app
pnpm package

# Build distributable
pnpm build
```

Cutting a release (signing, tagging, publishing, auto-update) is documented in
[`docs/releasing.md`](docs/releasing.md).

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── notebase/   # File system operations
│   ├── graph/      # RDF knowledge graph
│   ├── compute/    # Runnable code cells (Python / SQL / SPARQL)
│   ├── skills/     # Tools-for-Thought skill files
│   └── llm/        # Approval engine (the AI proposes, you confirm)
├── preload/        # Context-isolated IPC bridge
├── renderer/       # Svelte UI
│   └── lib/
│       ├── components/
│       ├── stores/
│       └── ipc/
└── shared/         # Types and IPC channel constants
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+N | New Note |
| Cmd+S | Save |
| Cmd+O | Open Project |
| Cmd+B | Toggle Sidebar |
| Cmd+Shift+P | Cycle View Mode |
| Cmd+Shift+N | New Window |
| Cmd+Shift+W | Close Project |
| Cmd+Shift+C | Commit All |
| Cmd+Shift+R | Reveal in Finder |
| Cmd+F | Find |
| Cmd+H | Find & Replace |

## Contributing

Bug reports, feature ideas, skills, and pull requests are all welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how to open a
good PR.

## License

MIT — see [LICENSE](LICENSE).
