<script lang="ts">
  /**
   * The card a Timeline event shows on hover or keyboard focus (#2608): the
   * type's render card (`selectInstanceCardFields`, `shared/objects/card.ts`
   * — what Kanban's cards and the preview's hover cards show) with the
   * event's dates, and two notes the drawing can't carry in words: that a
   * partial date is approximate, and that a written `end` was set aside (the
   * epic's decision 2: the event stays at its start, and the card says why).
   *
   * A `role="tooltip"` the focused event points at with `aria-describedby`,
   * so a screen reader hears the same flag a sighted user sees. Placed by the
   * host in px within the timeline; it never takes focus or pointer events.
   */
  import TypeIcon from '../TypeIcon.svelte';
  import { selectInstanceCardFields } from '../../../../shared/objects/card';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../../shared/objects/type-def';
  import type { TimelineEvent } from './timeline-events';
  import { DATE_PROPERTY, END_PROPERTY } from './timeline-events';

  interface Props {
    id: string;
    event: TimelineEvent;
    type: TypeInfo;
    properties: PropertyDef[];
    display: (prop: PropertyDef, value: string | null) => string;
    rowType: (inst: TypeInstanceRow) => TypeInfo | null;
    x: number;
    y: number;
    /** Open to the left of `x` (near the right edge). */
    flip: boolean;
  }
  let { id, event, type, properties, display, rowType, x, y, flip }: Props = $props();

  const byName = $derived(new Map(properties.map((p) => [p.name, p] as const)));
  // The dates are the card's heading line, so the date properties aren't repeated as fields.
  const fields = $derived(selectInstanceCardFields(type, properties, event.inst, { omit: [DATE_PROPERTY, END_PROPERTY] }));
  const rt = $derived(rowType(event.inst));
</script>

<div {id} class="tl-card" class:flip role="tooltip" data-export-omit style="left:{x}px;top:{y}px">
  <span class="tl-card-title">
    {#if rt}<TypeIcon type={rt} size={13} />{/if}
    <span>{event.title}</span>
  </span>
  <span class="tl-card-date">{event.dateText}{#if event.approx}<span class="tl-card-approx"> · approximate</span>{/if}</span>
  {#if event.endNote}<span class="tl-card-flag" data-end-issue>⚠ {event.endNote}</span>{/if}
  {#each fields as f (f.name)}
    {@const prop = byName.get(f.name)}
    <span class="tl-card-field"><span class="tl-card-flabel">{f.label}</span> {prop ? display(prop, f.value) : f.value}</span>
  {/each}
</div>

<style>
  .tl-card {
    position: absolute;
    z-index: var(--z-popover, 20);
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: max-content;
    max-width: 280px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elev);
    color: var(--text);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    font-family: var(--font-sans);
    font-size: 11.5px;
    line-height: 1.4;
    pointer-events: none;
  }
  .tl-card.flip { transform: translateX(-100%); }
  .tl-card-title { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; overflow-wrap: anywhere; }
  .tl-card-date { color: var(--text-muted); }
  .tl-card-approx { font-style: italic; }
  .tl-card-flag { color: var(--text); font-weight: 600; }
  .tl-card-field { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tl-card-flabel { font-weight: 600; }
</style>
