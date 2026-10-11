<script lang="ts">
  /** The Map layout (#2066) through the registry's `view` (#2623). */
  import TypeViewMap from '../TypeViewMap.svelte';
  import type { MapStyle } from '../../../../shared/objects/map-style';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

{#if view.locationProperty}
  <TypeViewMap
    instances={view.instances}
    locationProperty={view.locationProperty}
    onOpenNote={view.onOpenNote}
    mapStyle={view.mapStyle} type={view.type} properties={view.properties} display={view.display}
    {...(view.mapExport ? { exportHooks: view.mapExport } : {})}
    {...(view.readOnly || view.mapExport ? {} : { onMapStyleChange: (next: MapStyle) => view.onStateChange({ mapStyle: next }) })}
  />
{:else}
  <!-- A saved/persisted tab claims the Map layout but the type no longer has
       a geo property (e.g. edited after the view was saved) — a message
       rather than a map with nothing to plot. -->
  <p class="tv-empty">This type has no location property.</p>
{/if}
