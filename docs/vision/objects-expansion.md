# Vision: Objects Expansion — Place/Event, Map View (#2063 design spike, #2064), Timeline (#2611)

Resolves the two decisions #2064 identified as blocking both the Place stock
type (#2065) and the Map view (#2066), mirroring the design-spike pattern
`docs/vision/objects.md`'s "Resolved decisions" section used for the original
Typed Objects epic (#1061). Output is a decision, not code — nothing here
ships until #2065/#2066 build against it.

## Decision 1: a `geo` property type, not a `text` convention

**Add a 6th `PropertyType`: `geo`.** Stored as a single string value,
`"<lat>,<lng>"` in decimal degrees — no free-text address, no geocoding, no
structured lat/lng sub-fields for v1. Deferring geocoding entirely (lat/lng
only) is explicitly one of the options the issue allowed, and it's the
cheapest correct v1: address→coordinate resolution is a distinct, separable
feature (needs a geocoding service, its own network/privacy tradeoffs, its
own UI) that a Place object can grow into later without changing the stored
shape — a string is a string either way.

**Why this beats the "convention on `text`" alternative, concretely, not just
in principle:** traced every touch point a new `PropertyType` value hits before
deciding. It is far cheaper than the issue's own framing ("touches the
property-model type union in several places") suggested:

- `src/main/graph/indexers/frontmatter.ts`'s `coerceDeclared` switch has **no
  default case** — TypeScript exhaustiveness checking means adding `'geo'` to
  `PROPERTY_TYPES` produces a **compile error** everywhere a type-aware switch
  needs a new arm, starting with this one (`case 'geo': return asString();` —
  one line, no new XSD datatype, no blank node). This is a feature, not a cost:
  it's the compiler doing the "don't forget this" work a text convention would
  leave to documentation and code review.
- `PropertiesPanel.svelte`'s property-value form and `TypeEditorDialog.svelte`'s
  property-row editor both already fall through to their generic
  text-input branch for any type they don't special-case — a `geo` property
  needs **zero changes** in either to be creatable and editable today (a
  dedicated lat/lng picker or map-click control is a nice-to-have for #2065 to
  add later, not a prerequisite).
- The read-back path (`getNoteTypedProperties`, `getTypeInstances`) is fully
  type-agnostic — every property value is a `string | null` regardless of
  type, so `geo` needs no read-side changes either.

Net: the entire v1 diff is one array entry (`PROPERTY_TYPES`) and one
compiler-forced line (`coerceDeclared`). The benefit over a silent `text`
convention is real and durable: `geo` is a discoverable, explicit choice in
the type editor's own type dropdown (not tribal knowledge that "a property
named `location` means something special"), and every *future*
type-aware feature (Map view's own property lookup, card/cover selection,
CSV/table export type hints) gets the same compile-time reminder to consider
it, the same way it will for any of the existing five.

## Decision 2: MapLibre GL, OpenFreeMap vector tiles, no API key required

**Revised from an earlier draft of this doc, which recommended Leaflet +
raster tiles + a user-supplied MapTiler key.** That was the right call against
the alternatives considered at the time, but missed a better one: OpenFreeMap
(verified directly against its own docs, not from memory) is a free,
open-source vector-tile service with **no API key, no signup, no stated rate
limits, and commercial/bulk use explicitly permitted** — a materially
different posture from `tile.openstreetmap.org`'s raw tile server, which
exists specifically to *not* be used this way. It's backed by a single
maintainer (ex-MapHub) funded via GitHub Sponsors, with a documented
self-hosting option as a fallback if the public instance ever becomes
unreliable — a real risk to note, not a reason to dismiss it (see below).
It's also directly precedented for this exact product shape: Obsidian's own
Bases map view (`obsidianmd/obsidian-maps`) — a very close analog to
Minerva's own Place/Event ask, rendering notes-with-coordinates as map
markers — uses OpenFreeMap as its default tile source, with MapLibre GL JS
as the renderer. Missed in the first pass of this doc; caught on review.

**MapLibre GL, not Leaflet, follows from that.** OpenFreeMap serves *vector*
tiles (a style.json plus protobuf tile data), not raster images — Leaflet's
native strength is raster `<img>`-tag tiles, and consuming vector tiles
through it means a plugin bridging Mapbox-vector-tile rendering, not the
library's natural mode. MapLibre GL JS is the vector-tile-native renderer
OpenFreeMap itself recommends, and is what Obsidian's implementation actually
uses. Still lazy-loaded via dynamic `import()`, mirroring
`vega-renderer.ts`/`mermaid-renderer.ts`'s established pattern (module-cached
promise; an idempotent `hydrate*Blocks(root)` walk keyed by a
`data-*-rendered` attribute, invoked from the preview's post-render effect) —
not a new embedding mechanism, the same one #2067 will reuse for the
note-embeddable view.

**Why not Vega-Lite** (already a dependency, zero new package): checked what
it would actually render. `vega-renderer.ts` **actively blocks any `url` field
in a spec** as a deliberate security measure (`makeBlockingLoader`) — meaning
a Vega-Lite geo mark in this app could only plot points/shapes against
*locally-bundled* GeoJSON/TopoJSON boundary data, never fetch real basemap
tiles. That's a fundamentally different (and much weaker) product for "a
highlighted map of the note's places" than an actual interactive street-level
map — it's the right tool for a choropleth over bundled political boundaries,
not for "where is this place, zoomed in enough to be useful."

**CSP cost, honestly stated:** MapLibre GL fetches vector tiles via
`fetch`/XHR, which hits the renderer CSP's `connect-src` allowlist (currently
scoped to jsdelivr/unpkg/huggingface for WASM/model downloads) — this needs
one new entry, `tiles.openfreemap.org` (verified against OpenFreeMap's own
quick-start docs), the same shape of change as any of the existing allowlisted
hosts. This is the one real cost the Leaflet-raster-tiles approach would have
avoided (`img-src` is already wide open to any HTTPS host) — worth it for
landing on a genuinely free, policy-compliant, zero-setup-friction default
instead of trading that friction onto every user via a required API key.

**Sustainability / fallback plan, since a single-maintainer free service is a
real dependency risk, not a hypothetical one:** OpenFreeMap's documented
self-hosting option means Minerva isn't locked in if the public instance
degrades — the Map view's tile/style source should be a Settings-configurable
URL from day one (mirrors how Obsidian itself exposes "Settings → Maps → add a
background with a tile URL or style URL"), with `tiles.openfreemap.org`'s
"liberty" or "bright" style as the shipped default, not a hardcoded
assumption. A user (or Minerva itself, later, if warranted) can point at a
self-hosted OpenFreeMap instance, MapTiler, or any other MapLibre-style-spec
provider without a code change.

## Depends on / enables

- Enables #2065 (Place/Event stock types) to declare a `location` property of
  type `geo` and #2066 (Map view) to render it, without either re-litigating
  these two questions mid-implementation.
- No dependency on #2036 (external classes/predicates) — Place/Event can
  optionally gain `externalClass: schema:Place`/`schema:Event` later, purely
  additively, exactly as the epic's own "soft interaction, not a dependency"
  note says.

---

## Timeline (#2606 design spike, #2611)

Resolves the decisions #2611 identified for the Timeline layout (epic #2606):
how it renders, what a partial date means, how many events it holds, and
which years it supports. Same shape as the map spike above: a decision, not
a feature. The exception is the date-precision rule, which is
`src/shared/objects/date-precision.ts` (with
`tests/shared/objects/date-precision.test.ts`) because a rule like that is only
pinned once it runs. The lane-packing rule shipped the same way, as
`src/shared/objects/interval-lanes.ts`. Neither file has a caller yet; #2608
is the first.

All numbers below come from an Apple M1 Max (32 GB, macOS 26), Node 25.9.0,
and Playwright 1.63's headless Chromium 153.0.8010.12, measured on 2026-10-07.
The prototypes were throwaway scripts and are not in the repo.

### Decision 1: our own SVG, positioned with `d3-time`, not a timeline library

**Draw the timeline as Svelte-rendered SVG in the DOM.** One `<g>` per event
(a `<rect>` for a span, a marker for a point, plus a `<text>` label), each
carrying `data-note-path`, `role="link"` and an `aria-label`. The axis is a
plain linear map from civil-axis ms to px (`x = (t − d0) · width / (d1 − d0)`).
Ticks come from **`d3-time`**'s `utcTicks` / `utcTickInterval` and the `utc*`
intervals. Labels come from **`Intl.DateTimeFormat`** with `timeZone: 'UTC'`.

**Alternatives considered:**

| | Size (min + gzip) | A11y in its output | Export | Theming | Licence, upkeep |
|---|---|---|---|---|---|
| **Own SVG + `d3-time`** | **2.1 KB** (`utcTicks` + intervals) | ours: `role="link"`, labels, roving focus | SVG survives `snapshotLiveBlock` with links (verified below) | CSS tokens directly | ISC; d3-time 3.1.0 is already in the lockfile |
| Own SVG + `d3-scale` `scaleUtc` | 9.9 KB (pulls in d3-time-format, d3-interpolate and d3-array) | same | same | same | ISC; already in the lockfile |
| vis-timeline 8.5.4 (standalone) | 163.0 KB + 3.6 KB CSS | none: **0** `aria-*`, `role` or `tabindex` in the bundle | absolutely positioned `div`s; links possible via a template, but its own resize/redraw logic has to settle first | hard-coded colours in its CSS, all overridden per theme | Apache-2.0 OR MIT, released 2026-08-12; depends on moment, which is in maintenance mode |
| timelines-chart 2.14.3 | 46.5 KB | none (0 `aria-*`/`role`) | SVG | d3 colour scales | MIT, last release 2026-04-05; a swimlane-of-states chart with no lane packing |
| TimelineJS 3.9.13 | 66.4 KB + Less/CSS | slideshow | n/a | n/a | MPL-2.0; a one-event-per-slide storyteller, not an axis view |

Sizes are esbuild `--bundle --minify` of the import shown, then `gzip -9`.

**Why not `d3-scale`, even though vega already brings it in?** `pnpm why`
shows `d3-scale@4.0.2` and `d3-time@3.1.0` in the tree only through vega
(`vega-scale`) and mermaid (`d3`), not as direct dependencies. In the current
production renderer build (`vite build -c vite.renderer.config.mts`), they sit
in lazy shared chunks: `time-*.js` (5.8 KB gz, d3-scale's time scale plus
d3-time and d3-time-format) and `linear-*.js` (2.5 KB gz). The entry chunk only lists them as preload dependencies. A timeline that
imported `scaleUtc` would usually share those chunks, so it would cost little.
It still isn't worth it: the scale is one line of arithmetic, and
`scaleUtc().tickFormat` is d3-time-format's `%Y`, which is **wrong at the
edges** (see Decision 4). With `d3-time` alone, the cost is 2.1 KB gz, small
enough to import statically from the timeline component.

**What #2608 does with it:**
- Declare `d3-time` (pinned at the lockfile's `3.1.0`, so the lockfile gains no
  new package) in `package.json`. Do not import it as a phantom of vega's tree.
  Nothing here adds the dependency.
- Import it statically. The entry chunk is 3.37 MB against the
  3.70 MB budget in `bundle-budget.spec.ts`, and 2 KB gz (5.7 KB raw) doesn't
  need a `load-*.ts` loader the way MapLibre does.

**CSP: nothing to change.** It is the same for every option. SVG geometry
attributes aren't styles, and Svelte's `style=` falls under the existing
`style-src 'unsafe-inline'`. There is no script injection and no fetch, so
`connect-src` is unchanged (unlike the map's `tiles.openfreemap.org`). Nothing
is remote: hatching patterns are inline `<pattern>`s and labels use the app
fonts. vis-timeline wouldn't need a CSP change either (it has no `eval` or
`new Function` and fetches nothing), so CSP doesn't decide this.

**Export: SVG stays linked all the way to the PDF. This was verified, not
assumed.** In Chromium, an SVG with
`<g data-note-path tabindex="0" role="link" aria-label>` children went through
the exact transformation `snapshotLiveBlock`'s `linkRows` applies (an
HTML-namespace `<a>` replacing each `[data-note-path]` element, attributes
copied), then `stripInteractivity`'s tabindex removal, then main's
`data-note-link` → `href` rewrite, and was then re-parsed as a page:

- The HTML parser creates each `<a>` inside `<svg>` in the **SVG namespace**.
  It keeps the copied `transform`, lays out at the original box width, and is
  exposed as `link "Moon landing, 20 July 1969"` with its URL.
- **`page.pdf()` emitted a `/URI` link annotation for each SVG link**, as well
  as for an HTML-anchor control. This is the same Chromium as Electron's print.

So #2609 takes the SVG branch of its table: no `canvasesToImages`, and no event
list is *needed* under the image. (An accessible list still exists, for #2608's
reasons, not export's.)

**SVG against absolutely positioned HTML, measured:** both were drawn from the
same packed layout (raw DOM, before Svelte's overhead), timed to forced layout
and to the second `requestAnimationFrame`:

| events | SVG: build + layout / to 2nd rAF / nodes | HTML: build + layout / to 2nd rAF / nodes |
|---|---|---|
| 100 | 5.5 ms / 26 ms / 301 | 3.9 ms / 30 ms / 101 |
| 1,000 | 13.9 ms / 18.7 ms / 3,001 | 11.2 ms / 16.3 ms / 1,001 |
| 10,000 | 102.7 ms / 160 ms / 30,001 | 87.8 ms / 140 ms / 10,001 |

HTML is about 15% cheaper. SVG still wins on everything else: one coordinate
system for the axis, gridlines, bars and hatch patterns; vector output in a
PDF; and links that were verified above. (The 100-event "to 2nd rAF" figures
are mostly frame wait.)

**Accessibility** (#2608's list, made concrete):
- Use **one tab stop with a roving `tabindex`** over the events in packing
  order (`packLanes().order`, which is time order), not one tab stop per event.
  That keeps Tab usable at 1,000 events and keeps working once off-screen
  events are virtualised away.
- Give the timeline `role="group"` with an `aria-label`, and each event
  `role="link"` with a label like "Moon landing, 20 July 1969" or "Apollo 11,
  16–24 July 1969". Chromium's accessibility tree reports exactly that.
- The accessible **list alternative** is the same events in the same order, as
  a list of links. The Undated tray is part of it.

**Theming** pairs a surface token with a text token, never one alone
(#2679/#2688). Contrast was measured from `global.css`'s values:

| pair | dark | light | contrast |
|---|---|---|---|
| `--accent-ink` label on an `--accent` bar | 8.87 | 6.36 | 6.21 |
| `--accent` bar or point against `--bg` (non-text, needs 3:1) | 9.17 | 6.08 | 6.21 |
| `--text-muted` tick label on `--bg` | 6.22 | 6.45 | 10.16 |
| `--accent-dim` against `--bg` | 5.71 | **2.44** | 3.73 |
| `--border-strong` against `--bg` | **2.11** | **1.81** | 3.14 |

- Bars and points are drawn in `--accent` with `--accent-ink` text.
- The axis and its labels use `--text-muted`.
- Gridlines use `--border`. They are decorative, so the 3:1 rule doesn't
  apply.
- **Don't encode imprecision with `--accent-dim`**, which fails 3:1 in light,
  the export theme. **Don't draw the axis line in `--border-strong`**, which
  fails 3:1 in dark and light.

**"Visibly imprecise" without hover, so it survives print:**
- The uncertain stretch of an event is drawn as a **diagonal hatch in
  `--accent` with a dashed `--accent` outline**. The certain stretch is solid.
- For a range, the uncertain stretches are `startSpan` and, when the end is
  at calendar precision, `endSpan` (from `dateRange`, Decision 2). The certain
  stretch is `[startSpan.end, endSpan.start)` and may be empty, in which case
  the whole bar is hatched.
- A lone partial date (`1969`) is hatched across its whole span.
- A span narrower than the point marker at the current zoom draws as a point.
  A day at decade zoom is a point; a year at decade zoom is a short hatched
  bar.
- Pattern `id`s must be unique per instance, using Svelte's `$props.id()`.
  Two timelines on one exported page would otherwise share one `#hatch`.

### Decision 2: a written date is a span, not an instant

This is executable as `src/shared/objects/date-precision.ts`. Its API:

```ts
type CalendarPrecision = 'year' | 'month' | 'day';
type ClockPrecision = 'minute' | 'second' | 'millisecond';
type DatePrecision = CalendarPrecision | ClockPrecision;

parseDateValue(raw): ParsedDate | null   // fields as written + precision + offsetMinutes
dateSpan(raw, opts?): CivilSpan | null   // { start, end, precision }: half-open, civil ms
spanOfParsed(parsed, opts?): CivilSpan | null
dateRange(startRaw, endRaw?, opts?):
  | { ok: true; range: { start, end, startSpan, endSpan, endIssue: null | 'invalid' | 'before-start' } }
  | { ok: false; reason: 'missing' | 'invalid' }
civilMs(year, month0, day, h?, m?, s?, ms?)   // Date.UTC without the 0–99 → 1900s trap
// also: PRECISION_ORDER, isClockPrecision, MAX_CIVIL_MS
// opts: { zoneOffsetMinutes?: (instantMs) => number }   // the viewer's zone; injectable
```

The rules:

- **`YYYY`, `YYYY-MM` and `YYYY-MM-DD` are each the half-open span of their
  own precision.** `1969` is [1969-01-01, 1970-01-01), `1969-07` is
  [07-01, 08-01), and `1969-07-20` is [20th, 21st).
- **The civil axis.** Spans are calendar fields encoded as UTC ms. So a date
  is the same span for every viewer, and a day is always 86,400,000 ms. The
  suite passed under `TZ=America/New_York`, `Pacific/Auckland` and
  `Asia/Kolkata` as well as the default zone. Everything that draws must use UTC-mode tools: `utc*` intervals, and
  `Intl` with `timeZone: 'UTC'`.
- **The end of a range:**
  - **At calendar precision, an end is inclusive of its whole span.** `end:
    1969-07-24` runs through the 24th. **An end coarser than its start runs
    to the end of its own span**: `date: 1969-07-20, end: 1970` ends on
    1971-01-01.
  - **At clock precision, an end is the instant itself.** 14:30–16:00 ends at
    16:00, not 16:01. Calendars treat all-day and timed ends the same way.
  - An end may fall inside the start's span (`date: 1969, end: 1969-03`); it
    then narrows the range to January–March.
- **An end that doesn't come after the start's beginning is set aside.**
  The range becomes the start's own span, with `endIssue: 'before-start'`. It
  is not swapped, which would guess, and not dropped, which would lose a
  dated event over a typo. An end that isn't a date gets `endIssue:
  'invalid'` the same way. #2608 should show either on the hover card ("end
  date ignored: before the start"). "Not after" includes a zero-length clock
  range (`T14:30` → `T14:30`).
- **Invalid values are never repaired.** `1969-02-30`, `1969-7`, `T24:00`, a
  leap second, a 4-digit fraction, an offset past ±14:00, ISO week or ordinal
  dates, and `July 1969` all parse to `null`. `dateRange` returns
  `{ ok: false, reason: 'invalid' }` for an unreadable start, separately from
  `'missing'`. Both go to the **Undated** tray. An invalid start should say
  why ("couldn't read the date '1969-02-30'"), so it isn't silently dropped.
  `Date.parse` is never used: it reads a bare `1969-07-20T20:17` in the
  runtime's local zone and `0044` as 1944.
- **Room for `datetime` (#2613): its parse is implemented, not just left
  room for.** It fell out naturally, and it was needed anyway. Today's `date`
  property already accepts `YYYY-MM-DDTHH:mm…` (`frontmatter.ts`'s
  `ISO_DATETIME_RE` types it `xsd:dateTime`), and the `yaml` parser keeps it
  as a string, so the timeline meets clock values from day one.
  - The format is `YYYY-MM-DDTHH:mm[:ss[.s{1,3}]][Z|±HH:MM]`.
  - **A value without an offset is floating**: wall-clock time on the civil
    axis, the same for every viewer.
  - **A value with an offset is an instant.** It is placed at the viewer's
    wall-clock reading of that instant via `zoneOffsetMinutes`, which
    defaults to the runtime's local zone and is asked about that instant, so
    DST is correct.
  - What #2613 still owns: the property type itself, the editor input,
    display, sorting, filters, and graph typing.
- **Consistency with range filters (#2533) is pinned by a test.** For
  four-digit calendar values, `view-spec.ts`'s lexical `inRange` is exactly
  "the value's span start lies in [span(min).start, span(max).end)". A
  13-value × 6-min × 6-max table in the test asserts that `matchesFilter` and
  that span reading agree. So #2608's "a date range filter also bounds Fit"
  is that same interval. The lexical filter breaks where the span reading
  doesn't, in two places:
  - **Signed or short years** (`-43`, `44`, `12026` don't order as strings).
  - **Mixed offsets**, which #2613 already plans to compare as parsed
    instants.

  **Recommendation for #2613:** move `inRange`'s date branch to compare
  `dateSpan` starts, which fixes both. It wasn't changed here because this
  spike ships no feature code.
- **Nothing timeline-specific** is in the file: no axis, pixels or lanes. A
  Calendar layout asks the same questions: which days does this event cover,
  and is its start only known to the month?

### Decision 3: scale limits, measured

**Lane packing** is `src/shared/objects/interval-lanes.ts`, with tests that
include a brute-force oracle on random data:

```ts
packLanes(items: { key, start, end, title }[], { minExtent?, gap? })
  → { lanes: Map<key, lane>, laneCount, order: key[] }
```

- Items are taken in order of **start, then end, then title, then key**.
  Titles compare in code-unit order, not by `localeCompare`, so the result
  doesn't depend on the viewer's locale. The key, a note path, is a unique
  final tie-break, so equal items never swap between runs.
- Each item occupies `[start, max(end, start + minExtent)) + gap` and goes in
  the **lowest-numbered free lane**. That is first-fit by lane index, done in
  O(n log n) with two heaps.
- It is unit-agnostic. **#2608 packs in pixels at the current zoom**, so that
  `minExtent` (the point marker's width, about 12 px) and `gap` (about 4 px)
  keep a point and a short bar from overlapping on screen. So **lanes are
  recomputed on zoom, not on pan**: pan is a `transform` on the event group.
- **`order` is also the keyboard's time order.**

**Timings.** Synthetic events: 10% year, 20% month, 50% day and 20% minute
precision, with 30% carrying an `end`. "Spread" covers 1900–2026 and "dense"
packs everything into 2026. Each is the median of 15 runs, Fit-all at 1,200 px:

| events | parse + `dateRange` | map to px | `packLanes` | total, d3 `scaleUtc` path | lanes at Fit (spread / dense) |
|---|---|---|---|---|---|
| 100 | 0.24 ms | 0.01 ms | 0.05 ms | 0.40 ms | 5 / 19 |
| 1,000 | 2.35 ms | 0.03 ms | 0.42 ms | 3.8 ms | 30 / 146 |
| 10,000 | 23.0 ms | 0.30 ms | 6.4 ms | 37.6 ms | 176 / 1,415 |
| 100,000 | n/m | n/m | n/m | 436 ms | 1,520 / 14,389 |

- Mapping through d3's `scaleUtc`, which allocates a `Date` per call, costs
  7.9 ms at 10,000 events against 0.30 ms for plain arithmetic. That's
  another reason for the one-line scale.
- Rendering costs are in the SVG/HTML table under Decision 1.

**Thresholds for #2608:**
- **Parse once per data revision, not per frame.** At 10,000 events, parsing
  is about 23 ms; a zoom re-maps and re-packs in about 7 ms.
- **Up to about 1,000 dated events, render everything.** Measured: 14 ms
  build + layout and 3,000 SVG nodes, before Svelte's own overhead.
- **Above about 1,000 events in view, virtualise.** Render only events whose
  extent meets the visible range (plus half a screen either side) and the
  visible lanes. Packing still covers every event, so lanes don't jump while
  you pan. Rendering all 10,000 costs 100–160 ms per zoom step, which is
  visible jank. The roving tab stop above is what keeps the keyboard working
  once events leave the DOM.
- **Lanes are the real limit, more than event count.** One year of 1,000
  events already needs 146 lanes at Fit.
  - In the app, the lane area scrolls vertically under a sticky axis.
  - In **export** (#2609, a static image of one range at 760 px), cap the
    drawing at **30 lanes**. Events past the cap fold into a "+N more"
    marker per tick interval, and the full set is still listed by the
    Undated/list section, since a PDF can't scroll.
- **Clustering by count is not needed for 4.0.** It is only needed past about
  10,000 events, where parsing alone approaches a frame budget. Thoughtbases
  with that many Event notes are not the 4.0 target. Revisit with a real
  thoughtbase.

### Decision 4: supported range, years -99,999 to 99,999

- **The helper reads any year JS `Date` can hold**: whole years -271,820 to
  275,759, from the first day `Date` reaches (-271821-04-20) to the last
  (+275760-09-12). It uses proleptic Gregorian dates and astronomical year
  numbering, as ISO 8601, XSD 1.1, ECMAScript and `Intl` all do:
  - `0000` is 1 BCE and `-0043` is 44 BCE. `Intl.DateTimeFormat('en-US',
    { era: 'short' })` formats it as "44 BC", which a test asserts.
  - October 1582 has 31 days; Julian-calendar dates are not converted.
  - Years 0–99 really are years 0–99. Plain `Date.UTC(44, 0, 1)` gives 1944,
    a trap `civilMs` avoids and the tests cover.
- **A year on its own may be any integer of up to six digits** (`44`, `-43`,
  `12026`). This is forced, not a nicety: the frontmatter parser's `yaml`
  reads an unquoted `date: 0044`, `date: -0043` or `date: +12026` as a
  *number*, and the indexer stores `String(n)`, which is `44`, `-43` or
  `12026`. Month, day and clock values need ISO's four-digit or signed
  4–6-digit year (`-0043-03-15`).
- **The Timeline draws years -99,999 to 99,999**, and #2608 clamps its view
  domain there.
  - This is where `d3-time` is safe: `utcTicks` produced correct ticks from
    the ±99,999-year Fit, through months in year -99,999, down to 5-minute
    steps.
  - It returns **no ticks** once the domain gets near `Date`'s limit: ±250,000
    years, or anything starting at -271,820.
  - A value the helper reads but the timeline can't draw goes to the Undated
    tray as "outside the timeline's range". It is not dropped.
- **Labels never use d3-time-format's `%Y`.** It formats year 12026 as
  "2026", because it pads `year % 10000`, and year -43 as "-0043".
  `Intl.DateTimeFormat` with `timeZone: 'UTC'` gives "12026", and "44 BC" with
  `era` set. #2608 should add `era` only when the visible domain reaches
  year ≤ 0.
- **Known gaps outside the timeline:**
  - The graph types only four-digit forms (`frontmatter.ts`'s `YEAR_RE` and
    the related patterns). A `-43` or `12026` value is stored as a plain
    string literal, so SPARQL range queries won't treat it as a date.
  - The lexical range filter misorders such values (see Decision 2).
  - Neither breaks the timeline, which reads the lexical value through the
    helper. Both are #2613's to fix if it wants BCE in filters and SPARQL.

### What the dependent stories do as a result

- **#2607 (view spec):**
  - `from` / `to` are date values in Decision 2's grammar (`from: 1960`,
    `to: 1975`). The visible domain is `dateRange(from, to)`: from the start
    of `from`'s span to the end of `to`'s.
  - Read them with `String(…)`, because YAML makes `1960` a number.
  - A `to` that doesn't come after `from`, or an unreadable value, reads back
    as "fit all" (both omitted). It does not throw, like the rest of the
    spec.
  - Write the coarsest precision that states the range: a year when both
    edges sit on year boundaries, otherwise `YYYY-MM-DD`, and clock precision
    only after #2613.
  - Use `layout: timeline` and a `LAYOUT_NAMES` label of `timeline`.
- **#2608 (TypeView):**
  - Rendering, axis, theming, hatching and accessibility: Decision 1.
  - Spans and the Undated tray, with its reasons (missing, invalid, outside
    the range): Decisions 2 and 4.
  - Packing in pixels with `packLanes`, and the thresholds: Decision 3.
  - Add `d3-time@3.1.0` as a direct dependency.
- **#2609 (export):**
  - Take the SVG branch: no `canvasesToImages`, links via `data-note-path`.
    The path through to PDF link annotations is verified.
  - Export mode means the spec's `from`/`to` or Fit, at 760 px, with no
    controls, a 30-lane cap with "+N more", per-instance pattern ids, the
    light theme (the pairings above), and the Undated list after the drawing.
- **#2613 (`datetime`):**
  - Use `parseDateValue` / `dateSpan` as the parse and precision table. It
    already covers date-only, partial, floating, `Z` / offset and invalid
    values, and the floating-unless-offset rule is implemented.
  - Also owned there: the property type, `xsd:dateTime` / `xsd:date` typing,
    and moving `inRange` to span comparison.

### Questions for the maintainer before #2607 starts

1. **Arrow keys:** the epic says arrows *step through events*, while #2608
   says arrows *pan*. Proposal:
   - Left and Right move the roving focus to the previous or next event,
     panning to keep it visible.
   - Shift+Left and Shift+Right pan without moving focus.
   - +/− zoom, Home and End go to the first and last event, and Enter opens.
2. **A backwards `end`:** is setting it aside and flagging it on the hover
   card right, or should such an event go to the Undated tray as an error?
3. **BCE input:** is astronomical numbering (`-0043` = 44 BCE) acceptable as
   the only syntax? A `44 BCE` sugar would read better, but it is a second
   grammar that the graph, filters and #2613 would all have to learn.
4. **The supported range** of -99,999 to 99,999 for drawing: fine, or narrow
   it to ±9,999 for simpler labels?
5. **The 30-lane export cap** and the about-1,000 virtualisation threshold:
   accept as starting values, to be tuned in #2608 against a real
   thoughtbase?
6. **Moving the date range filter to span comparison** (Decision 2): in #2613
   as suggested, or as its own small fix sooner? It changes how a signed
   year is filtered today, which is currently misordered.
