<script lang="ts">
  /**
   * Map layout for the Typed Objects multi-view (#2066) — one marker per
   * instance with a valid `geo`-typed property value. Mirrors `GraphCanvas.svelte`
   * (cytoscape)'s lifecycle exactly: lazy-load the heavy lib in `onMount`'s async
   * IIFE behind a `disposed` guard, instantiate against an owned `<div>`, tear
   * down in `onMount`'s returned cleanup — NOT the markdown-fence-hydrate pattern
   * `vega-renderer.ts` uses, which solves a different problem.
   *
   * Read-only, like every other layout here (list/table/gallery all just open the
   * note on click) — clicking a marker opens its note, nothing more. No shared
   * selection/highlight state exists anywhere in this multi-view today (verified
   * before building this), so this doesn't invent one either. Each marker's
   * native `title` attribute is set to the instance's title, so hovering shows
   * the OS/browser's own tooltip — no custom popup UI to build or maintain.
   *
   * The tile style is the view's `mapStyle` (#2665): `light` / `dark` pin
   * OpenFreeMap's named style, `auto` follows the app theme (`styleUrlForTheme`,
   * read when the style is applied — an app-theme switch alone doesn't restyle
   * an open map). Choosing a style in the on-map control switches it LIVE via
   * `map.setStyle`, which keeps the camera; the pins are DOM `Marker`s, not
   * style layers, so they survive the swap untouched — nothing to re-add.
   * MapLibre's attribution control re-reads the new style's sources on its own.
   *
   * Each marker is colored by the instance's own EXACT type (via
   * `objectTypesStore.typeForNote`), not the tab's type — a "Place" map
   * includes subclass instances (`rdfs:subClassOf*` in note-properties.ts),
   * so e.g. a Restaurant and a Hotel sharing a Place tab get their own
   * colors instead of one uniform pin, mirroring the row icon lookup
   * TypeView.svelte already does for list/table/gallery.
   */
  import { onMount } from 'svelte';
  import type * as maplibregl from 'maplibre-gl';
  import { loadMapLibre } from '../map/load-maplibre';
  import { exportStyleUrl, mapStyleUrl, resolveMapStyle } from '../map/maplibre-style';
  import { MAP_STYLES, type MapStyle } from '../../../shared/objects/map-style';
  import { MAP_EXPORT_ERROR_GRACE_MS, MAP_EXPORT_PIXEL_RATIO, MAP_EXPORT_TIMEOUT_MS, MAP_TILES_FAILED, attributionText, compositeMap, parseLatLng, type MapExportHooks, type MapPlace } from '../map/map-export';
  import { objectTypesStore } from '../stores/object-types.svelte';
  import type { TypeInstanceRow } from '../../../shared/objects/type-def';

  type MapLibreModule = typeof maplibregl;

  interface Props {
    instances: TypeInstanceRow[];
    /** Name of the type's `geo`-typed property (e.g. `location`). */
    locationProperty: string;
    onOpenNote: (relativePath: string) => void;
    /** Render once for an export instead of interactively (#2511): light
     *  style, no controls, then hand back a PNG of exactly this framing —
     *  or the places, when the map can't be drawn. */
    exportHooks?: MapExportHooks;
    /** The view's tile style (#2665); `auto` follows the app theme. An
     *  export uses it too, except that `auto` exports light. */
    mapStyle?: MapStyle;
    /** Shows the on-map light/dark/auto control and receives a choice.
     *  Absent (a note embed, an export) → no control, as embeds have no
     *  filter controls either (#2534). */
    onMapStyleChange?: (style: MapStyle) => void;
  }
  let { instances, locationProperty, onOpenNote, exportHooks, mapStyle = 'auto', onMapStyleChange }: Props = $props();

  const STYLE_LABELS: Record<MapStyle, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  const STYLE_TITLES: Record<MapStyle, string> = {
    auto: 'Follow the app appearance',
    light: 'Light map, whatever the app appearance',
    dark: 'Dark map, whatever the app appearance',
  };
  /** Which style the tiles actually are — drives the pins' dark-tile halo. */
  const resolvedStyle = $derived(resolveMapStyle(mapStyle));

  let container = $state<HTMLDivElement>();
  // Flips true once the map is constructed — a plain `map`/`gl` reference
  // mutating doesn't retrigger the `$effect` below, so readiness needs its
  // own reactive signal for the effect to pick up "the map exists now" the
  // same way it picks up "instances changed."
  let ready = $state(false);
  let map: maplibregl.Map | null = null;
  let gl: MapLibreModule | null = null;
  let markers: maplibregl.Marker[] = [];
  /** The style URL the map was built with or last switched to — so the live
   *  switch below only calls `setStyle` on a real change. */
  let appliedStyleUrl: string | null = null;
  /** Markers placed and framed at least once — an export capture waits for it. */
  let placed = false;

  /** Rebuilds every marker from the current `instances` prop. Re-run whenever
   *  the prop changes (a note added/edited/removed while this map is already
   *  open, #2028-adjacent report) — not just once at mount, which is what the
   *  original #2066 implementation did, and why a note added after the map
   *  was opened never got a pin. */
  function syncMarkers(): void {
    if (!gl || !map) return;
    for (const marker of markers) marker.remove();
    markers = [];
    const bounds = new gl.LngLatBounds();
    for (const inst of instances) {
      const parsed = parseLatLng(inst.values[locationProperty] ?? null);
      if (!parsed) continue;
      const [lat, lng] = parsed;
      const color = objectTypesStore.typeForNote(inst.path)?.color;
      const marker = new gl.Marker(color ? { color } : undefined).setLngLat([lng, lat]).addTo(map);
      marker.getElement().style.cursor = 'pointer';
      marker.getElement().title = inst.title;
      marker.getElement().addEventListener('click', () => onOpenNote(inst.path));
      markers.push(marker);
      bounds.extend([lng, lat]);
    }
    // Camera/projection math (fitBounds, setCenter/Zoom) doesn't depend on the
    // style/tiles having finished loading — markers and camera framing are
    // correct immediately after construction. Force a resize first: the
    // container may not have had its final layout size at construction time
    // (e.g. mounting while a sibling layout tab is animating out), and a
    // stale internal size skews fitBounds' math.
    map.resize();
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, animate: false });
    } else {
      // No located instances — a reasonable default view rather than an
      // arbitrary/empty-looking one.
      map.setCenter([0, 20]);
      map.setZoom(1);
    }
    placed = true;
  }

  onMount(() => {
    let disposed = false;

    void (async () => {
      const mod = await loadMapLibre();
      if (disposed || !container) return;
      gl = mod;
      if (exportHooks) {
        map = new mod.Map({
          container,
          style: exportStyleUrl(mapStyle),
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          pixelRatio: MAP_EXPORT_PIXEL_RATIO,
          canvasContextAttributes: { preserveDrawingBuffer: true },
        });
        armExportCapture(map, exportHooks);
      } else {
        appliedStyleUrl = mapStyleUrl(mapStyle);
        map = new mod.Map({
          container,
          style: appliedStyleUrl,
        });
        map.addControl(new mod.NavigationControl(), 'top-right');
      }
      ready = true;
    })();

    return () => {
      disposed = true;
      for (const marker of markers) marker.remove();
      markers = [];
      map?.remove();
      map = null;
      gl = null;
      appliedStyleUrl = null;
      ready = false;
    };
  });

  /**
   * Each style source as LOADED — where a TileJSON-backed source (OpenFreeMap's
   * are) carries its attribution, which the style JSON itself doesn't. Same
   * place MapLibre's own attribution control reads it from.
   */
  function loadedSources(m: maplibregl.Map): Record<string, { attribution?: string }> {
    const declared = (m.getStyle()?.sources ?? {}) as Record<string, { attribution?: string }>;
    const out: Record<string, { attribution?: string }> = {};
    for (const id of Object.keys(declared)) {
      const loaded = (m.getSource(id) as { attribution?: string } | undefined)?.attribution;
      const attribution = loaded ?? declared[id]?.attribution;
      out[id] = attribution ? { attribution } : {};
    }
    return out;
  }

  /** The located instances, as the export's fallback lists them. */
  function places(): MapPlace[] {
    const out: MapPlace[] = [];
    for (const inst of instances) {
      const ll = parseLatLng(inst.values[locationProperty] ?? null);
      if (ll) out.push({ path: inst.path, title: inst.title, lat: ll[0], lng: ll[1] });
    }
    return out;
  }

  /**
   * Export capture (#2511): once the map is `idle` — style loaded, every
   * tile in, nothing animating — flatten canvas + pins into one PNG. Any
   * map error first, or no `idle` within the bound, hands back the places
   * instead, so a half-drawn map is never published as if it were whole.
   */
  function armExportCapture(m: maplibregl.Map, hooks: MapExportHooks): void {
    let settled = false;
    let failed = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const fallBack = (reason: string) => finish(() => hooks.onCaptured({ ok: false, reason, places: places() }));
    const finish = (run: () => Promise<void> | void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      void Promise.resolve(run()).catch((err: unknown) => {
        hooks.onCaptured({ ok: false, reason: err instanceof Error ? err.message : String(err), places: places() });
      });
    };
    const timer = setTimeout(() => finish(() => hooks.onCaptured({ ok: false, reason: 'the map tiles took too long to load', places: places() })), MAP_EXPORT_TIMEOUT_MS);
    m.on('error', () => {
      if (failed) return;
      failed = true;
      grace = setTimeout(() => fallBack(MAP_TILES_FAILED), MAP_EXPORT_ERROR_GRACE_MS);
    });
    m.on('idle', () => {
      // `idle` before the markers are placed would capture a pinless map;
      // placing them moves the camera, so another `idle` follows.
      if (!placed || settled) return;
      if (failed) {
        fallBack(MAP_TILES_FAILED);
        return;
      }
      finish(async () => {
        const rect = m.getContainer().getBoundingClientRect();
        const pins = markers.map((mk) => ({ element: mk.getElement(), point: m.project(mk.getLngLat()) }));
        const image = await compositeMap(m.getCanvas(), pins, rect.width, rect.height);
        hooks.onCaptured({
          ok: true, image, width: rect.width, height: rect.height,
          attribution: attributionText({ sources: loadedSources(m) }), places: places(),
        });
      });
    });
  }

  // Live style switch (#2665): a changed `mapStyle` restyles the open map in
  // place. `setStyle` leaves the camera alone, and the pins are DOM markers
  // outside the style, so markers and framing are exactly as they were.
  // Export mode renders once, in the style it was built with.
  $effect(() => {
    const url = mapStyleUrl(mapStyle);
    if (!ready || !map || exportHooks || url === appliedStyleUrl) return;
    appliedStyleUrl = url;
    map.setStyle(url);
  });

  // Re-syncs on the map becoming ready (first placement) AND on every later
  // `instances`/`locationProperty` change (an already-open map picking up a
  // newly added/edited/removed instance).
  $effect(() => {
    instances;
    locationProperty;
    ready;
    syncMarkers();
  });
</script>

<div class="type-view-map-wrap" class:dark-tiles={resolvedStyle === 'dark'}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="type-view-map" bind:this={container} role="application" aria-label="Map" tabindex="0"></div>
  {#if onMapStyleChange && !exportHooks}
    <div class="map-style-switch" role="group" aria-label="Map style">
      {#each MAP_STYLES as s (s)}
        <button
          type="button"
          aria-pressed={mapStyle === s}
          class:active={mapStyle === s}
          title={STYLE_TITLES[s]}
          onclick={() => { if (s !== mapStyle) onMapStyleChange(s); }}
        >{STYLE_LABELS[s]}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .type-view-map-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .type-view-map {
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--bg-inset);
  }

  /* Enlarges each pin's hover/click target without changing its visual size
     or position. The default MapLibre marker is a 27x41px teardrop SVG —
     small, and mostly a narrow tapering point rather than a filled
     rectangle, so a near-miss falls through to the map underneath (reported:
     the hover tooltip only seemed to work "on the very tip"). `.maplibregl-marker`
     is a third-party class (not one this component defines), hence :global.
     An absolutely-positioned ::before with `inset` extends the hit area on
     all sides without contributing to the marker div's own layout size —
     MapLibre's anchor/offset math reads that size to position the icon so
     its tip lands on the coordinate, and inflating it directly (e.g. via
     padding) would shift the icon off its true location. Empty `content`
     and no background keeps it fully invisible. */
  /* Light / Dark / Auto (#2665), top-left — the zoom buttons own top-right.
     Its own surface rather than theme tokens over the tiles, because the
     tiles' brightness is the view's choice, not the app's. */
  .map-style-switch {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 2;
    display: flex;
    border-radius: 5px;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
  }
  .map-style-switch button {
    padding: 3px 9px;
    border: 1px solid var(--border);
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .map-style-switch button:first-child { border-radius: 5px 0 0 5px; }
  .map-style-switch button:last-child { border-radius: 0 5px 5px 0; }
  .map-style-switch button:not(:first-child) { border-left: none; }
  .map-style-switch button.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .map-style-switch button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; position: relative; }

  /* On dark tiles a pin in a dark type colour can sink into the background;
     a thin light halo keeps every pin's outline readable. */
  .dark-tiles :global(.maplibregl-marker svg) {
    filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.5));
  }

  :global(.maplibregl-marker::before) {
    content: '';
    position: absolute;
    inset: -8px;
  }
</style>
