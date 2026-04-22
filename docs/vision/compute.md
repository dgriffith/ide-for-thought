# Vision: Compute — Executing Code Over Your Library

## Position

Once the thoughtbase contains both the graph (via Turtle) and tables (via CSV / SQL), the next question is the obvious one: _can I run code over it?_ Most knowledge tools would answer "export your data, run the code elsewhere, paste the result back as text." Minerva's answer is: **notebooks live inside the library, and the library is their primary data source.**

A Minerva note with executable code fences is a notebook. The fence language (`sparql`, `sql`, `python`) picks the interpreter; the output renders inline; derived outputs — plots, tables, summaries — persist as their own notes with a provenance link back to the computation that produced them. The same editor, formatter, linker, and preview pipeline that serves normal notes serves notebooks unchanged.

## Differentiator

General-purpose notebook environments (Jupyter, Marimo, Observable) treat the library as something you import _into_ the notebook. Minerva inverts the relationship. A one-liner like `minerva.notes(tag="stats-methodology", since="2023")` returns a collection of Note objects — title, body, tags, backlinks, all the metadata the graph indexer has already extracted. A two-liner cross-joins that with a CSV table of publications you care about. A three-liner plots the intersection and saves the plot as a note with `[[derivedFrom::<notebook-id>]]` linking back to the computation that produced it.

The thoughtbase isn't data you have to pull _into_ the notebook; it's already there, shaped the way the notebook expects.

## Capability surface

**Markdown-native notebooks.** No separate `.ipynb` JSON format. An executable notebook is just a regular `.md` note with code fences in the right languages. Git-friendly by construction. Every other Minerva feature (formatter, search, wiki-links, backlinks) works unchanged.

**Three fence languages, same execution model:**

- `sparql` — runs against the existing rdflib store. Zero subprocess; purely in-process. Already the easiest land.
- `sql` — runs against DuckDB (see SQL vision). Also in-process; zero subprocess.
- `python` — runs against a Python subprocess per open notebook. The "full" compute story; the heaviest implementation work.

**Native library API** (available in all Python cells):

- `minerva.sparql(query: str) → DataFrame`
- `minerva.sql(query: str) → DataFrame`
- `minerva.notes(tag=…, since=…, …) → Collection[Note]`
- `minerva.source(id: str) → Source`  (metadata + body + excerpts)
- `minerva.excerpts(source=…, tag=…) → Collection[Excerpt]`
- `minerva.table(name: str) → DataFrame`  (convenience for full-table reads)

**Inline output rendering** for the standard shapes: tables, charts (via the existing Chart.js integration), images, HTML fragments. SQL and SPARQL results render as `CsvTable`-style tables immediately.

**Provenance by construction.** Saving a computed output as a note emits `[[derivedFrom::<notebook-id>]]` in the resulting file. Conversely, citations written inside a code cell index as real `[[cite::…]]` links — a notebook that quotes a source becomes discoverable from that source's backlinks.

**Assistant integration.** The LLM can propose a computation in whichever language fits the question ("histogram of excerpts by source year" → SPARQL + matplotlib, "monthly reading rate" → SQL over a table), emit the code, and offer to save the output. All through the existing approval gate; the assistant never silently executes code or writes files.

**Phased delivery.** Shipping this end-to-end in one chunk is too big. The natural phases:

1. **SPARQL fences** become executable in regular notes. Zero new infra — the rdflib store is already there. Smallest meaningful ship.
2. **SQL fences** become executable. Adds DuckDB and CSV ingest (see SQL vision).
3. **Python cells** with the `minerva.*` library. Real engineering: subprocess lifecycle, output protocol, interrupt handling.
4. **Provenance + assistant integration** on top.

## Scope discipline

- **Not a general-purpose scientific computing environment.** If you need multi-kernel management, package-manager UIs, distributed compute, or GPU access, use Jupyter / Colab / a real IDE. Minerva's notebooks compute _over the user's library_; the library is the boundary.
- **Not a spreadsheet.** No inline-formula cells, no cell dependencies other than Python's normal flow.
- **Not an authoring tool for computational reports.** Quarto, RStudio, Observable Framework already own that ground. Minerva's notebooks are for answering questions; the polished-manuscript path goes through the Publication pillar, not here.
- **Not inventing a notebook format.** Markdown-with-executable-fences is well-worn prior art (Quarto, Myst-NB, Observable Framework). Minerva implements the pattern for its own data model — it doesn't wrap an existing executor.
- **Not a heavy Python runtime wrapper.** We spawn the user's Python, inject a local `minerva` package, execute code through stdin / stdout JSON protocol. No bundled kernel, no isolated envs, no package resolution.

## Open decisions

- **Python runtime discovery.** Find the user's Python via `python3` on PATH? Let them configure it in settings? Bundle a minimal `uv`-managed runtime? Start with "use what's on PATH, settings override," punt a bundled runtime to the "polish" phase.
- **Cell execution protocol.** Line-based stdin with a cell-separator sentinel? A small socket-per-notebook? The simplest shape that gets us "run one cell, capture output" is line-based stdin; upgrade when interrupt and partial-output streaming demand more.
- **Rich output rendering.** Plots are Chart.js — we can emit JSON `{type: 'chart', config: {…}}` from Python via a `minerva.chart(…)` helper. Images (matplotlib `plt.savefig` to PNG, return as base64)? HTML fragments (Pandas `.to_html()`)? All trivially supported via a small display protocol.
- **Save-output-as-note UX.** Right-click a rendered output → "Save as note"? A `minerva.save(…)` call inside Python? Both, probably.
- **Long-running / interruptible cells.** `Ctrl-C` equivalent? Kill-and-restart the subprocess? Phase 1 is probably "no interrupt, kill-notebook-kills-subprocess." Interrupt is a real feature but non-trivial.
- **Dependency declaration.** A notebook-level `# /// script` pragma that declares `requires` (like `uv run`'s inline deps)? Users without it fall back to their global Python env. Later concern.

## Depends on / enables

- **Depends on**: SQL vision (for the `sql` fence and the `minerva.sql` / `minerva.table` APIs). SPARQL support can ship independently.
- **Enables**: the "LLM proposes a computation" pathway, which is the next step of conversational research assistance once the compute substrate exists.
