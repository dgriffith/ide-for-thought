<script lang="ts">
  /** The Calendar layout (#2702) through the registry's `view` (#2623). */
  import TypeViewCalendar from '../TypeViewCalendar.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

<TypeViewCalendar
  type={view.type} properties={view.properties} instances={view.instances}
  month={view.month} dateBy={view.dateBy}
  display={view.display} rowType={view.rowType} onOpenNote={view.onOpenNote}
  onStateChange={(p) => view.onStateChange(p)} readOnly={view.readOnly} exportMode={view.exportMode}
/>
