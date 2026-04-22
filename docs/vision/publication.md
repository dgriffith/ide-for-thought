# Vision: Publication — Knowledge That Can Leave the App

## Position

A library that only you can read isn't really yours; it's hostage to the tool. The moment your library becomes useful to someone else — a reader, a collaborator, a future you on a different machine — is the moment the library earns its keep. Minerva treats **export-to-readable-artifact as a core capability**, not a plugin or a third-party hand-off. Publication discipline is what turns a personal knowledge base into shareable work.

"Publication" in Minerva covers the full range of external artifacts the library can produce: a single note exported as HTML, a note tree exported as a navigable PDF, a curated subset of the thoughtbase rendered as a static site, an annotated reading bundle ("here's what I learned from this paper") shared with a collaborator. All of them resolve citations, strip private metadata, and preserve the structure the reader actually needs.

## Differentiator

Most knowledge tools either lock you in (Notion, Roam) or export badly — Obsidian's markdown-to-PDF is workable but citations are on their own, Logseq's sharing is basic, Notion's export has notorious gaps. The Minerva edge is **citations that survive the trip out**. The thoughtbase is RDF-backed, so `[[cite::smith-2023]]` in a note is already a structured reference. Turning it into APA, MLA, Chicago, or any CSL style on export is a rendering problem, not a data-recovery problem. Annotated-reading artifacts (a source plus its excerpts plus your notes about it) become a publishable format with almost no additional work, because all three shapes are already first-class objects in the graph.

## Capability surface

**Single-note export:**
- HTML — self-contained, citations inlined, optional bibliography footer, anchor-linked headings preserved, wiki-links translated to hyperlinks or footnotes depending on whether the target is in the export set.
- PDF — same shape, driven off the HTML pipeline (Electron's `webContents.printToPDF` already exists here).
- Clean markdown — frontmatter stripped of internal-only fields, wiki-links translated, code fences normalized.

**Note-tree export.** A folder, or a note + its transclusions + its cited sources, bundles into a navigable HTML site or a linked PDF. Minerva is a knowledge _environment_; if a subset of it is worth reading, a subset of it should be publishable as one coherent artifact.

**Static-site generation.** Any subset of the thoughtbase — a folder, a tag, a SPARQL query result — renders as a browsable static site with internal navigation preserved, backlinks rendered as related-notes sections, tag pages, and a full-text search index. The gwern.net / digital-garden model, with citation support the gardens usually lack.

**Citation style rendering via CSL** (Citation Style Language — the stack Zotero and Pandoc use). Author-year, numeric, inline, footnote, full styles from citationstyles.org. The source's `meta.ttl` drives the bibliography; Minerva's job is to hand CSL a clean record.

**Annotated-reading as a first-class export format.** One command produces "everything I read in this source + what I pulled out of it + what I've written about it." The graph already knows all three shapes; the format is a templating exercise, not a data-assembly one.

**Preview before publish.** Side-by-side with the source note, see exactly what the external reader sees — resolved citations, stripped metadata, wiki-links rendered as whatever the target needs. Same pattern as the existing Source / Preview split.

**Publish destinations:**
- **File export** first (write to a user-chosen folder).
- **Git-push-to-repo** second (static site to GitHub Pages, Netlify, etc.).
- **Minerva-hosted public library** eventually, for users who want a single-command share without running their own infra. Out of scope for initial ticket rounds.

**Private-by-default semantics.** The export pipeline includes only notes that _opt in_ — via a frontmatter flag, a tag, or their location in a designated subtree. Fail-safe on the side of "accidentally private" rather than "accidentally public," because the alternative is a user accidentally posting their personal notes to the internet. Any single export run gets a summary preview ("this export will publish 47 notes and 12 sources; click to review") before the write fires.

## Scope discipline

- **Not WYSIWYG authoring.** You write markdown; publication renders markdown. Google Docs already exists.
- **Not collaborative editing.** A separate, much bigger problem (CRDT, real-time presence, permissions). Publication is one-way out; collaboration is a two-way problem that warrants its own design pass.
- **Not feature-for-feature parity with Obsidian Publish.** That product picked a specific hosting story and a specific rendering style. Minerva's publication should be output-neutral — produce the artifact, let the user host it wherever.
- **Not a CMS.** No comments, no dashboards, no view analytics. Published output is static content the reader consumes; what they do with it is their business.
- **Not solving long-form manuscript authoring.** Books, thesis chapters, journal articles with complex layout requirements are still Quarto/RStudio/LaTeX territory. Minerva exports research artifacts; it doesn't replace typesetting.

## Open decisions

- **CSL engine.** `citeproc-js` is the obvious pick (what Zotero and Pandoc use under the hood). In-renderer or via a Pandoc sidecar? `citeproc-js` is pure JS, small bundle; probably in-renderer.
- **Static-site generator.** Bolt onto an existing one (Eleventy, Astro) or emit a minimal bespoke one? The "no Node toolchain in user's distribution" instinct argues for bespoke, but the feature surface is large and SSG is a mature space — standing on someone else's work is probably right.
- **Draft state.** When a note has half-finished thoughts you haven't cleaned up, does the export include them, warn you, or silently skip them? Probably a `status: draft` frontmatter convention with opt-in "include drafts" at export time.
- **Internal links to non-exported notes.** When a published note's wiki-links resolve to notes _not_ in the export set, do we render them as plain text, 404-ing anchors, or silently drop them? Default: plain text, with an option in the export config to turn them into tooltips or footnotes.
- **Transclusion-aware export.** `![[other-note]]` in a published note — inline the transcluded content, link to it if it's in the export set, or treat it as a reference? Likely: inline by default, with an opt-out.
- **Computed outputs from the Compute pillar.** A note generated from a notebook cell carries a `[[derivedFrom::…]]` link. On public export, strip the provenance trail (readers don't care about the internal notebook that produced the chart). On collaborator export, keep it (they might want to re-run the computation). Configurable per-export.

## Depends on / enables

- **Depends on**: the graph's citation infrastructure (already there), the existing Preview pipeline (already there), the source-viewer ingestion work (already there). The groundwork is laid.
- **Enables**: Minerva-as-research-output-pipeline — a path from reading through annotation through analysis through publication that never leaves the environment.
