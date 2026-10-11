<script lang="ts">
  /** The Timeline layout (#2608) through the registry's `view` (#2623). */
  import TypeViewTimeline from '../TypeViewTimeline.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

<TypeViewTimeline
  type={view.type} properties={view.properties} instances={view.instances} filters={view.filters}
  from={view.from} to={view.to} dateBy={view.dateBy}
  display={view.display} rowType={view.rowType} onOpenNote={view.onOpenNote}
  onStateChange={(p) => view.onStateChange(p)} readOnly={view.readOnly} exportMode={view.exportMode}
/>
