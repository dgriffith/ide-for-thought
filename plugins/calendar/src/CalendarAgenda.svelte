<script lang="ts">
  /**
   * The Day view's agenda (#2952, epic #2949): the day's events in order,
   * beside the hour grid, as the day's list (`CalendarDayList`) shows them —
   * all-day first, then by time — with each one's first card field.
   *
   * Shown only at wide widths (a container query on `.cal-main`); narrower,
   * it is `display: none`, so out of the tab order as well as out of sight,
   * and the grid alone is the day. One tab stop (a roving tabindex): ↑/↓ and
   * Home/End move between events, Enter opens one, the menu key asks for
   * Minerva's note menu. Hover and focus show the app's preview, as in the
   * grid.
   */
  import type { TimelineEvent } from '../../../src/shared/timeline/timeline-events';
  import type { NoteHover } from './hover.svelte';
  import { isMenuKey, openMenuAt } from './drag-keys';

  interface Props {
    /** "Wednesday, 7 October 2026". */
    label: string;
    events: TimelineEvent[];
    /** "9:00 AM", or null for an all-day event. */
    timeOf: (ev: TimelineEvent) => string | null;
    /** An event's second line: its first card field, or null. */
    detailOf: (key: string) => string | null;
    hover: NoteHover;
    cardId: string;
    cardKey: string | null;
    onOpen: (key: string) => void;
    /** Minerva's note menu for an event; null where the view has none. */
    onMenu: ((e: MouseEvent, key: string) => void) | null;
  }
  let { label, events, timeOf, detailOf, hover, cardId, cardKey, onOpen, onMenu }: Props = $props();
  const uid = $props.id();

  let focusedKey = $state<string | null>(null);
  const tabKey = $derived(events.some((e) => e.key === focusedKey) ? focusedKey : events[0]?.key ?? null);
  let list = $state<HTMLUListElement>();

  function onKeydown(e: KeyboardEvent): void {
    const item = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-agenda-event]');
    if (!item) return;
    if (onMenu && isMenuKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      openMenuAt(item);
      return;
    }
    const items = [...(list?.querySelectorAll<HTMLElement>('[data-agenda-event]') ?? [])];
    const i = items.indexOf(item);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = items[Math.min(items.length - 1, i + 1)];
    else if (e.key === 'ArrowUp') next = items[Math.max(0, i - 1)];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else return;
    e.preventDefault();
    next?.focus();
  }
</script>

<section class="cal-agenda" aria-label="Agenda, {label}" data-calendar-agenda>
  <div class="cal-agenda-head" aria-hidden="true">Agenda</div>
  {#if events.length === 0}
    <p class="cal-agenda-empty">No events.</p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ul class="cal-agenda-list" bind:this={list} onkeydown={onKeydown}>
      {#each events as ev, i (ev.key)}
        {@const time = timeOf(ev)}
        {@const detail = detailOf(ev.key)}
        <li>
          <span id="{uid}-desc-{i}" hidden>{ev.label}</span>
          <button
            type="button"
            class="cal-agenda-item"
            class:approx={ev.approx}
            tabindex={ev.key === tabKey ? 0 : -1}
            data-agenda-event
            data-note-path={ev.key}
            aria-describedby={[`${uid}-desc-${i}`, cardKey === ev.key ? cardId : null].filter(Boolean).join(' ')}
            aria-haspopup={onMenu ? 'menu' : undefined}
            onclick={() => onOpen(ev.key)}
            oncontextmenu={onMenu ? (e) => onMenu(e, ev.key) : undefined}
            onfocus={(e) => { focusedKey = ev.key; hover.focus({ key: ev.key, target: ev.key, anchor: e.currentTarget, fallbackTitle: ev.title }); }}
            onblur={() => hover.blur(ev.key)}
            onpointerenter={(e) => hover.pointerEnter({ key: ev.key, target: ev.key, anchor: e.currentTarget, fallbackTitle: ev.title })}
            onpointerleave={() => hover.pointerLeave(ev.key)}
          >
            <span class="cal-agenda-time">{time ?? (ev.ranged ? 'Multi-day' : 'All day')}</span>
            <span class="cal-agenda-name">{ev.title}</span>
            {#if detail}<span class="cal-agenda-detail">{detail}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .cal-agenda {
    flex: 0 0 240px;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    border-left: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }
  /* Beside the grid only where the grid keeps room for its events (#2952). */
  @container (max-width: 720px) {
    .cal-agenda { display: none; }
  }
  .cal-agenda-head { margin: 0 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
  .cal-agenda-empty { margin: 4px 0; font-size: 12px; }
  .cal-agenda-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .cal-agenda-item {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 8px;
    width: 100%;
    padding: 5px 6px;
    border: 1px solid transparent;
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }
  .cal-agenda-item.approx { border-left-style: dashed; }
  .cal-agenda-item:hover { background: color-mix(in oklch, var(--text) 8%, transparent); }
  .cal-agenda-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  .cal-agenda-time { grid-row: span 2; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; padding-top: 1px; }
  .cal-agenda-name { font-size: 12.5px; font-weight: 500; overflow-wrap: anywhere; }
  .cal-agenda-detail { font-size: 11px; color: var(--text-muted); overflow-wrap: anywhere; }
</style>
