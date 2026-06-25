<script lang="ts">
  /**
   * Drag-tab-to-split drop target (#817). Rendered as an overlay over a pane
   * only while a tab is being dragged. It hit-tests the cursor into one of five
   * zones (four edges + center), previews where the tab will land, and reports
   * the chosen zone on drop. The parent maps the zone to a split + move.
   */
  import { dropZoneFromFraction, type DropZone } from '../editor/drop-zone';

  interface Props {
    onDropZone: (zone: DropZone) => void;
  }

  let { onDropZone }: Props = $props();

  let hover = $state<DropZone | null>(null);

  function zoneFrom(e: DragEvent): DropZone {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = r.width > 0 ? (e.clientX - r.left) / r.width : 0.5;
    const y = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5;
    return dropZoneFromFraction(x, y);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault(); // allow drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    hover = zoneFrom(e);
  }

  function onDragLeave() {
    hover = null;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const zone = zoneFrom(e);
    hover = null;
    onDropZone(zone);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pane-dropzone" ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}>
  {#if hover}
    <div class="preview {hover}"></div>
  {/if}
</div>

<style>
  .pane-dropzone {
    position: absolute;
    inset: 0;
    z-index: 5;
  }

  .preview {
    position: absolute;
    background: color-mix(in oklch, var(--accent) 22%, transparent);
    border: 1px solid var(--accent);
    pointer-events: none;
    transition: all 80ms ease;
  }
  /* Each edge zone previews the half the moved tab will occupy; center fills. */
  .preview.left { inset: 0 50% 0 0; }
  .preview.right { inset: 0 0 0 50%; }
  .preview.top { inset: 0 0 50% 0; }
  .preview.bottom { inset: 50% 0 0 0; }
  .preview.center { inset: 0; }
</style>
