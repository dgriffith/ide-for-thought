<script lang="ts">
  /** The Kanban layout (#2602) through the registry's `view` (#2623). */
  import TypeViewKanban from '../TypeViewKanban.svelte';
  import type { LayoutView } from './layout-view';

  let { view }: { view: LayoutView } = $props();
</script>

<TypeViewKanban
  type={view.type} properties={view.properties} group={view.group} columns={view.board} visible={view.visible}
  display={view.display} rowType={view.rowType} selectable={view.selectable}
  isSelected={view.isSelected} onCardClick={view.onRowClick} onCardContextMenu={view.onRowContextMenu}
  refPath={view.refPath} onRefContextMenu={view.onRefContextMenu}
  onMove={view.onMoveCard} onUndoMove={view.onUndoMove}
  {...(view.onMoveColumn ? { onMoveColumn: view.onMoveColumn } : {})}
  exportMode={view.exportMode}
/>
