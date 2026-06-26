# Charts — Vega-Lite & Vega

Minerva renders [Vega-Lite](https://vega.github.io/vega-lite/) and full
[Vega](https://vega.github.io/vega/) specs in the Markdown preview, the same way
it renders Mermaid diagrams: write a fenced block whose body is the JSON spec and
it renders to a chart.

````markdown
```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {
    "values": [
      { "category": "A", "value": 28 },
      { "category": "B", "value": 55 },
      { "category": "C", "value": 43 }
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}
```
````

Use a ` ```vega ` fence for a full Vega spec. Both render through
[`vega-embed`](https://github.com/vega/vega-embed), which is lazy-loaded on first
use, so notes without charts pay nothing.

**Insert → Chart…** offers starter scaffolds that drop a complete, valid spec
with the cursor positioned for the first edit:

- inline-data charts (Bar, Line, Area, Scatter, Time Series, Pie) that render
  immediately — the cursor lands in the data array so your first edit is
  "replace my data";
- live-data charts (From SPARQL, From Table, From Cell) wired to Minerva's own
  data (see [Binding charts to Minerva data](#binding-charts-to-minerva-data)) —
  the cursor lands in the query / table / cell reference;
- an **Empty Block** for starting from scratch.

Each chart gets the built-in **"⋯" actions menu** (export PNG/SVG, view
source/compiled spec) and a **collapse toggle** in the fence toolbar. Charts are
skinned to the active Catppuccin theme and re-skin automatically when you switch
themes. A spec that sets its own colors keeps them — the theme is only the
default layer.

## Data: inline only (security)

A chart spec can arrive from outside your control — via import, the web clipper,
or a shared vault — so it is treated as partially-untrusted input, the same
posture as file-path access elsewhere in Minerva.

**Charts render from inline data only.** Any `url` reference in a spec — a
`data.url` remote fetch, an image-mark `url`, a transform-lookup `url` — is
**refused**, and the chart shows a clear "remote data disabled" notice instead of
silently phoning home. Put your data in the spec:

```json
{ "data": { "values": [ { "x": 1, "y": 2 } ] }, "mark": "point" }
```

Under the hood:

- The Vega data **loader** is replaced with one that rejects every remote/file
  fetch. Inline `data.values` never touch the loader.
- Vega **expressions** run through the CSP-safe interpreter (the renderer's
  Content-Security-Policy has no `unsafe-eval`). Pure data-transform expressions
  — the point of Vega — keep working; nothing in the expression language can
  reach the network or filesystem.
- A spec's `usermeta.embedOptions` is stripped before rendering, so a spec can't
  re-enable codegen or swap the loader through that channel.

## Binding charts to Minerva data

A chart can draw from the knowledge base's own live data instead of inlining
values. Name a source in `data` and Minerva resolves it to rows before
rendering — the chart still only ever sees inline values, so the security
posture above is unchanged.

**SPARQL** (against the knowledge graph) and **SQL** (against the project's
CSV/DuckDB tables) are supported today.

SPARQL:

````markdown
```vega-lite
{
  "data": { "sparql": "SELECT ?tag (COUNT(?n) AS ?count) WHERE { ?n minerva:hasTag ?t . ?t minerva:tagName ?tag } GROUP BY ?tag" },
  "mark": "bar",
  "encoding": {
    "x": { "field": "tag", "type": "nominal" },
    "y": { "field": "count", "type": "quantitative" }
  }
}
```
````

- The standard prefixes (`minerva`, `thought`, `dc`, `rdf`, `rdfs`, `xsd`,
  `csvw`, `owl`, `prov`, …) are auto-injected — no need to declare them.
- SPARQL returns every value as a string; a column whose values are all numeric
  is coerced to numbers so `quantitative` encodings work. Columns with dates or
  labels stay strings (Vega infers `temporal` / `nominal`).
- A data-bound chart shows a **⟳ refresh** button in its toolbar to re-run the
  query after the graph changes; it also re-resolves whenever the note
  re-renders.
- A query error renders a clear inline notice, never a silent empty chart.

SQL / table (the project's CSV files are registered as DuckDB tables):

````markdown
```vega-lite
{
  "data": { "sql": "SELECT month, revenue FROM sales ORDER BY month" },
  "mark": "line",
  "encoding": { "x": {"field":"month","type":"ordinal"}, "y": {"field":"revenue","type":"quantitative"} }
}
```
````

- `"data": { "table": "sales" }` is sugar for `SELECT * FROM "sales"` (the name
  is quoted as a DuckDB identifier).
- Table names come from the CSV path (`deriveTableName`) or a `table_name:` in
  the CSV's companion `.md`; the Tables view lists them.

**Compute cell** — bind to the output of a runnable cell in the same note. Give
the cell a stable id and reference it:

````markdown
```sql {id=sales}
SELECT month, revenue FROM sales
```

```vega-lite
{
  "data": { "cell": "sales" },
  "mark": "line",
  "encoding": { "x": {"field":"month","type":"ordinal"}, "y": {"field":"revenue","type":"quantitative"} }
}
```
````

The chart reads the cell's stored `output` block, so **run the cell first**; its
⟳ refresh button re-reads the latest output. A cell that hasn't run (or whose
output isn't tabular) renders a clear notice.

Bound charts don't yet render in **exports** (#885) — they degrade to the spec
there.

## Export

When you export a note, charts are rendered to **static SVG** so the published
artifact actually shows the visualization instead of a wall of JSON:

- **HTML / PDF** (and the static-site / bundle exporters): each ` ```vega-lite ` /
  ` ```vega ` block is rendered headlessly in the main process (no browser
  window) and embedded as an `<img>` (an inline SVG data URI). A neutral light
  theme is applied so charts read on a white page.
- **Markdown export** keeps the spec fence **verbatim** — a Vega spec is
  portable to other Vega-aware tools, and a multi-kilobyte data URI would bloat
  the file. Re-render it wherever it's opened next.

The security policy holds at export too: a chart that references remote data is
refused (no fetch from the export process), and any chart that can't render —
bad spec, blocked data — degrades to its spec text plus a short note. One broken
chart never fails the whole export.
