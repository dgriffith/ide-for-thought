# Vision: Objects Expansion — Place/Event, Map View (#2063 design spike, #2064)

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

## Decision 2: Leaflet, raster tiles, MapTiler with a user-supplied API key

**Leaflet**, not MapLibre GL, not Vega-Lite. Lazy-loaded via dynamic
`import()`, mirroring `vega-renderer.ts`/`mermaid-renderer.ts`'s exact
established pattern (module-cached promise; an idempotent `hydrate*Blocks(root)`
walk keyed by a `data-*-rendered` attribute, invoked from the preview's
post-render effect) — not a new embedding mechanism, the same one #2067 will
reuse for the note-embeddable view.

**Why not Vega-Lite** (already a dependency, zero new package): checked what
it would actually render. `vega-renderer.ts` **actively blocks any `url` field
in a spec** as a deliberate security measure (`makeBlockingLoader`) — meaning
a Vega-Lite geo mark in this app could only plot points/shapes against
*locally-bundled* GeoJSON/TopoJSON boundary data, never fetch real basemap
tiles. That's a fundamentally different (and much weaker) product for "a
highlighted map of the note's places" than an actual interactive street-level
map — it's the right tool for a choropleth over bundled political boundaries,
not for "where is this place, zoomed in enough to be useful."

**Why Leaflet over MapLibre GL:** both are net-new dependencies with no CSP
conflict in principle, but they hit the CSP differently in practice. Leaflet's
raster tile layer requests tiles as plain `<img>` elements, and the current
CSP's `img-src: 'self' data: blob: https:` **already allows any HTTPS host** —
zero CSP change needed. MapLibre GL's vector tiles are fetched via
`fetch`/XHR as protobuf, which hits `connect-src`'s narrow allowlist and would
require naming the tile host there explicitly. MapLibre's actual strength
(smooth vector rendering, custom styling at scale) solves a problem Minerva's
Place objects don't have — a personal thoughtbase will have tens or hundreds
of Place notes, not the large, high-frequency-pan datasets vector tiles exist
for. Leaflet is the simpler, more mature, better-fit choice for "put a
modest number of pins on a map."

**Tile source: no hardcoded direct OpenStreetMap tile server.**
`tile.openstreetmap.org`'s own usage policy explicitly prohibits exactly this
use case — bulk/production use from a distributed application — so using it
directly isn't a mere technical shortcut, it's a policy violation with real
long-tail risk (rate-limiting or blocking that shows up unpredictably as
adoption grows, entirely outside Minerva's control to fix after the fact).
Instead: **the Map view requires a user-supplied API key for a commercial
tile provider, defaulting to MapTiler** (generous free tier — 100k tile loads/
month at time of writing — explicitly aimed at exactly this kind of
low-to-moderate-volume app). Store the key in Settings (mirrors how other
optional external-service credentials already live in this app's settings
surface, e.g. LLM provider keys). Map view degrades gracefully with no key
set: a friendly "add a map tile provider key in Settings to enable this view"
prompt, not a blank or broken map — matching the CLAUDE.md UI philosophy of no
hand-holding but also no silent dead ends. This is additive, optional, and
per-user — a thoughtbase with no Place notes, or a user who never sets a key,
sees zero behavior change anywhere else in the app.

## Depends on / enables

- Enables #2065 (Place/Event stock types) to declare a `location` property of
  type `geo` and #2066 (Map view) to render it, without either re-litigating
  these two questions mid-implementation.
- No dependency on #2036 (external classes/predicates) — Place/Event can
  optionally gain `externalClass: schema:Place`/`schema:Event` later, purely
  additively, exactly as the epic's own "soft interaction, not a dependency"
  note says.
