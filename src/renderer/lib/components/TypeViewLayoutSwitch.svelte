<script lang="ts">
  /**
   * A type view's layout switcher (#1070) and, on a board, its **Group by**
   * picker (#2602). Split out of `TypeView.svelte` with the Kanban layout, so
   * the board's toolbar control didn't push that file past its size budget.
   *
   * Which layouts are offered depends on the type's (effective) properties:
   * - **Map** only for a type with a location-shaped (`geo`) property (#2066) —
   *   not a menu item that's always present but broken for Book/Person/etc.
   * - **Kanban** only for a type with an enum property (`canShowKanban`,
   *   #2601), since a board's columns are an enum's options.
   *
   * The Group by picker lists the type's enum properties and appears only when
   * there is a choice to make (more than one). A pick goes through
   * `onStateChange` like every other toolbar control, so it lands on the tab
   * and round-trips through the session, the embed and Save as note.
   */
  import { canShowKanban, enumProperties, resolveGroupBy } from '../../../shared/objects/kanban';
  import type { PropertyDef } from '../../../shared/objects/type-def';

  type Layout = 'list' | 'table' | 'gallery' | 'map' | 'kanban';

  interface Props {
    layout: Layout;
    /** The type's effective properties. */
    properties: PropertyDef[];
    /** The view's `groupBy` (null = the first enum). */
    groupBy: string | null;
    onStateChange: (patch: { layout?: Layout; groupBy?: string | null }) => void;
  }
  let { layout, properties, groupBy, onStateChange }: Props = $props();

  const LAYOUTS = $derived<{ id: Layout; label: string }[]>([
    { id: 'list', label: 'List' },
    { id: 'table', label: 'Table' },
    { id: 'gallery', label: 'Gallery' },
    ...(properties.some((p) => p.type === 'geo') ? [{ id: 'map' as const, label: 'Map' }] : []),
    ...(canShowKanban(properties) ? [{ id: 'kanban' as const, label: 'Kanban' }] : []),
  ]);
  const groupChoices = $derived(enumProperties(properties));
  const grouped = $derived(resolveGroupBy(groupBy, properties));
</script>

{#if layout === 'kanban' && groupChoices.length > 1 && grouped}
  <label class="tv-groupby">
    Group by
    <select value={grouped.name} onchange={(e) => onStateChange({ groupBy: e.currentTarget.value })}>
      {#each groupChoices as p (p.name)}
        <option value={p.name}>{p.label ?? p.name}</option>
      {/each}
    </select>
  </label>
{/if}
<div class="tv-switch" role="tablist" aria-label="View">
  {#each LAYOUTS as l (l.id)}
    <button
      role="tab"
      aria-selected={layout === l.id}
      class:active={layout === l.id}
      onclick={() => onStateChange({ layout: l.id })}
    >{l.label}</button>
  {/each}
</div>

<style>
  .tv-groupby { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
  .tv-groupby select {
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    font-size: 11.5px;
  }
  .tv-switch { display: flex; gap: 0; }
  .tv-switch button {
    padding: 3px 10px;
    border: 1px solid var(--border);
    background: var(--bg-button);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .tv-switch button:first-child { border-radius: 5px 0 0 5px; }
  .tv-switch button:last-child { border-radius: 0 5px 5px 0; }
  .tv-switch button:not(:first-child) { border-left: none; }
  .tv-switch button.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
</style>
