# Vision: SQL — Tabular Data as a Library Citizen

## Position

A thoughtbase should hold more than prose. Research generates tables — experiment runs, survey results, spreadsheet exports, scraped datasets, reading lists with structured metadata — and those tables are part of what the user knows. Minerva treats them as first-class library members: you drop a CSV into the thoughtbase and it becomes a queryable table, indexed alongside notes and the graph, reachable by the same tools.

The graph already handles one axis of structured data: Turtle blocks in notes and standalone `.ttl` files populate an RDF store that SPARQL queries. The SQL vision is the parallel on the tabular axis: CSV files populate a DuckDB-backed store that SQL queries. Users pick the query language closest to the shape of the question — SPARQL for relationships and types, SQL for aggregations and joins over rows.

## Differentiator

Most knowledge tools treat tabular data as foreign — something you link to ("see the attached spreadsheet"), embed verbatim, or bounce out to a separate tool to query. Minerva's edge is that **the same library holds both shapes of data**, and both are queryable from inside the environment. The existing graph panel becomes a _data_ panel with language-tagged query cells; CSVs in the thoughtbase appear in the Sources panel (or its sibling) and can be opened, inspected, and cross-joined with the graph.

SQL is load-bearing here for a reason: it's the query language everyone already knows. SPARQL is powerful but niche; the barrier to "I can answer a question about my library" drops substantially when the user has SQL as a fallback. The LLM assistant benefits too — its SQL generation is approximately 1000× more reliable than its SPARQL generation because of training-data ratios.

## Capability surface

- **CSV ingestion as a first-class library operation.** Any `.csv` in the thoughtbase gets registered as a DuckDB table on the same watcher pipeline that picks up Turtle files and sources. Table naming follows a predictable convention (relative path → identifier, with a frontmatter-declared override).
- **Schema inference by default, declaration when needed.** DuckDB auto-detects column types; a sidecar frontmatter or `.schema.yaml` pins them explicitly for users who care about date handling, categoricals, or non-UTF-8 encodings.
- **Query language parity in the existing panel.** The current Query Panel (SPARQL) extends to accept `sql` as a second fence language in the query UI. Switching between SPARQL and SQL is a dropdown or a fence-tag change.
- **Stock queries for common shapes.** The stock-queries menu grows a SQL section: "rows per table," "schema of X," "null rates per column," etc.
- **CSV viewer integration.** The existing `CsvTable` component renders a CSV file's contents; the "Query this" affordance opens the panel pre-populated with `SELECT * FROM <table>`.
- **Cross-axis joins through Python (phase 2, see Compute).** Federation across SPARQL and SQL in a single query is out of scope for v1 — users sequence the two through a Python cell or intermediate results.
- **Engine choice: DuckDB via the Node native binding**, main-process. Rationale documented separately; primary driver is `read_csv_auto`'s frictionless zero-ETL story.

## Scope discipline

- **Not a data warehouse.** Personal-KM scale. Thousands-to-millions of rows is the sweet spot; gigabytes of ETL workload is not the use case.
- **Not a spreadsheet editor.** Users edit CSVs with whatever tool they prefer (VS Code, Excel, etc.); Minerva queries them.
- **Not a replacement for the graph.** Tabular data and RDF serve different shapes of question. Adding SQL doesn't deprecate SPARQL — both axes coexist.
- **Not inventing new file formats.** CSV stays CSV on disk. Any Minerva-specific metadata (table name overrides, column type pins) lives in sidecar files that the user can delete without losing data.

## Open decisions

- **Table naming convention.** `notes/data/2024-experiment.csv` → table name `notes_data_2024_experiment`? Or the stem `experiment_2024`? Likely: both, with a frontmatter-declared `table_name` winning when present.
- **DuckDB embedding shape.** Native Node binding (main-process) vs DuckDB-wasm (either side). Native gets us tighter file-system integration and slightly better perf; WASM gets us bundle-size flexibility. Start native, keep the WASM path open.
- **Schema declaration format.** Frontmatter on a companion note? Sidecar `.schema.yaml`? JSON Schema subset? Picking a format is a small but load-bearing choice — users will grow attached.
- **Also-ingest Parquet / Arrow / JSON?** DuckDB reads all three natively. Do we surface them now or CSV-only and add others on demand? Probably CSV-only at launch; the rest are a one-line extension when users ask.
- **What about embedded CSV blocks inside notes (via a ````csv` fence)?** Tempting symmetry with Turtle blocks, but note files would bloat fast and diffing CSV-in-markdown is awkward. Probably out of scope.

## Depends on / enables

- **Depends on**: the existing Turtle-ingest watcher model (`.minerva/sources/` has a parallel story; `.csv` files anywhere in the tree are the trigger).
- **Enables**: the SQL fence language in the Compute notebook work. Users can run SQL in a note without needing Python installed.
