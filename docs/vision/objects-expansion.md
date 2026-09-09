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
