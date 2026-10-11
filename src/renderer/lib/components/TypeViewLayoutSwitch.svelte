<script lang="ts">
  /**
   * A type view's layout switcher (#1070), on a board its **Group by** picker
   * (#2602), and on a timeline its **Date by** picker (#2715). Split out of `TypeView.svelte` with the Kanban layout, so
   * the board's toolbar control didn't push that file past its size budget.
   *
   * Which layouts are offered is the host's call, from the layout registry
   * (`layoutsFor`, `shared/objects/view-layouts.ts`, #2623): Map needs a `geo`
   * property, Kanban an enum, Timeline and Calendar a date or datetime one.
   * This only draws them, with the registry's labels.
   *
   * The Group by picker lists the type's enum properties and appears only when
   * there is a choice to make (more than one). A pick goes through
   * `onStateChange` like every other toolbar control, so it lands on the tab
   * and round-trips through the session, the embed and Save as note. A new
   * grouping starts from its enum's own column order: a `columnOrder` (#2614)
   * names another property's values, so it's cleared with the pick.
   *
   * **Show empty columns** (#2614) sits beside it on every board (default on,
   * since an empty column is still a drop target).
   *
   * The **Date by** picker is the same control with the same rule, over
   * `date-by.ts`'s choices: the type's date and datetime properties (less
   * Event's `end` beside `date`), shown only when there is more than one. The
   * selected value is `resolveDateBy` — the view's `dateBy`, else the default
   * (`date`, else the first). A pick writes `dateBy` through `onStateChange`.
   * It is ONE spec field shared by the dated layouts (Timeline and Calendar,
   * `dated` in the registry), so a view switched between them keeps it.
   */
  import { enumProperties, resolveGroupBy } from '../../../shared/objects/kanban';
  import { dateByChoices, resolveDateBy } from '../../../shared/objects/date-by';
  import type { PropertyDef } from '../../../shared/objects/type-def';
  import { layoutDef, type ViewLayout } from '../../../shared/objects/view-layouts';

  type Layout = ViewLayout;

  interface Props {
    layout: Layout;
    /** The layouts this type can show, in order (`layoutsFor`). */
    layouts: readonly Layout[];
    /** The type's effective properties. */
    properties: PropertyDef[];
    /** The view's `groupBy` (null = the first enum). */
    groupBy: string | null;
    /** The view's `dateBy` (null = the default date property). */
    dateBy?: string | null;
    /** The view's Show empty columns (#2614). */
    showEmptyColumns: boolean;
    onStateChange: (patch: { layout?: Layout; groupBy?: string | null; columnOrder?: string[]; showEmptyColumns?: boolean; dateBy?: string | null }) => void;
  }
  let { layout, layouts, properties, groupBy, dateBy = null, showEmptyColumns, onStateChange }: Props = $props();

  const LAYOUTS = $derived(layouts.map((id) => ({ id, label: layoutDef(id).label })));
  const groupChoices = $derived(enumProperties(properties));
  const grouped = $derived(resolveGroupBy(groupBy, properties));
  const dateChoices = $derived(dateByChoices(properties));
  const dated = $derived(resolveDateBy(dateBy, properties));
</script>

{#if layoutDef(layout).dated && dateChoices.length > 1 && dated}
  <label class="tv-groupby">
    Date by
    <select value={dated.name} onchange={(e) => onStateChange({ dateBy: e.currentTarget.value })}>
      {#each dateChoices as p (p.name)}
        <option value={p.name}>{p.label ?? p.name}</option>
      {/each}
    </select>
  </label>
{/if}

{#if layoutDef(layout).grouped && groupChoices.length > 1 && grouped}
  <label class="tv-groupby">
    Group by
    <select value={grouped.name} onchange={(e) => onStateChange({ groupBy: e.currentTarget.value, columnOrder: [] })}>
      {#each groupChoices as p (p.name)}
        <option value={p.name}>{p.label ?? p.name}</option>
      {/each}
    </select>
  </label>
{/if}
{#if layoutDef(layout).grouped && grouped}
  <label class="tv-groupby">
    <input type="checkbox" checked={showEmptyColumns} onchange={(e) => onStateChange({ showEmptyColumns: e.currentTarget.checked })} />
    Show empty columns
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
  .tv-groupby input { margin: 0; accent-color: var(--accent); }
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
