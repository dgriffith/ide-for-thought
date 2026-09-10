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
   * before building this), so this doesn't invent one either.
   *
   * Theme-aware via `styleUrlForTheme()` picking OpenFreeMap's light or dark
   * named style — read once at mount, not live-updated: switching the app theme
   * takes effect the next time this layout is (re)mounted (matches how a fresh
   * tab/reload already reads the current theme), not via a heavier `map.setStyle`
   * mid-session swap.
   */
  import { onMount } from 'svelte';
  import type * as maplibregl from 'maplibre-gl';
  import { loadMapLibre } from '../map/load-maplibre';
  import { styleUrlForTheme } from '../map/maplibre-style';
  import type { TypeInstanceRow } from '../../../shared/objects/type-def';

  type MapLibreModule = typeof maplibregl;

  interface Props {
    instances: TypeInstanceRow[];
    /** Name of the type's `geo`-typed property (e.g. `location`). */
    locationProperty: string;
    onOpenNote: (relativePath: string) => void;
  }
  let { instances, locationProperty, onOpenNote }: Props = $props();

  let container = $state<HTMLDivElement>();
  let map: maplibregl.Map | null = null;
  let markers: maplibregl.Marker[] = [];

  /** Parse a "<lat>,<lng>" geo value; null for missing/malformed — omitted, not
   *  errored, per #2066's acceptance criteria. */
  function parseLatLng(value: string | null): [number, number] | null {
    if (!value) return null;
    const parts = value.split(',').map((s) => Number(s.trim()));
    if (parts.length !== 2) return null;
    const [lat, lng] = parts;
    if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }

  function addMarkers(gl: MapLibreModule, m: maplibregl.Map): void {
    const bounds = new gl.LngLatBounds();
    for (const inst of instances) {
      const parsed = parseLatLng(inst.values[locationProperty] ?? null);
      if (!parsed) continue;
      const [lat, lng] = parsed;
      const marker = new gl.Marker().setLngLat([lng, lat]).addTo(m);
      marker.getElement().style.cursor = 'pointer';
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
    m.resize();
    if (!bounds.isEmpty()) {
      m.fitBounds(bounds, { padding: 48, maxZoom: 14, animate: false });
    } else {
      // No located instances — a reasonable default view rather than an
      // arbitrary/empty-looking one.
      m.setCenter([0, 20]);
      m.setZoom(1);
    }
  }

  onMount(() => {
    let disposed = false;

    void (async () => {
      const gl = await loadMapLibre();
      if (disposed || !container) return;
      map = new gl.Map({
        container,
        style: styleUrlForTheme(),
      });
      map.addControl(new gl.NavigationControl(), 'top-right');
      addMarkers(gl, map);
    })();

    return () => {
      disposed = true;
      for (const marker of markers) marker.remove();
      markers = [];
      map?.remove();
      map = null;
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="type-view-map" bind:this={container} role="application" aria-label="Map" tabindex="0"></div>

<style>
  .type-view-map {
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--bg-inset);
  }
</style>
