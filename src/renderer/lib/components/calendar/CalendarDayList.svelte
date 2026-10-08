<script lang="ts">
  /**
   * A calendar day's full list of events (#2702): what "+N more" opens, and
   * what Enter on a focused day opens — one popover, so every event is
   * reachable by keyboard however full its cell is (the vision doc's
   * "Accessibility: the WAI-ARIA date grid").
   *
   * A non-modal `role="dialog"` named for the day. It takes focus on its first
   * event; ↑/↓ (and Home/End) move between events, Enter opens one, and
   * **Escape closes it and returns focus to the day** (`onClose(true)`). A
   * press outside, or focus leaving it, closes it where focus already is.
   * Each event shows the shared hover preview on focus and on hover, as in the
   * grid.
   */
  import { tick } from 'svelte';
  import type { TimelineEvent } from '../timeline/timeline-events';
  import type { NoteHover } from '../note-hover/note-hover.svelte';

  interface Props {
    /** "Tuesday, 6 October 2026". */
    label: string;
    events: TimelineEvent[];
    /** The day cell it opened from: placed against it, focus returns to it. */
    anchor: HTMLElement;
    /** "9:00 AM", or null for an all-day event. */
    timeOf: (ev: TimelineEvent) => string | null;
    hover: NoteHover;
    /** The hover preview's id, and the event it shows (for `aria-describedby`). */
    cardId: string;
    cardKey: string | null;
    onOpen: (key: string) => void;
    onClose: (returnFocus: boolean) => void;
  }
  let { label, events, anchor, timeOf, hover, cardId, cardKey, onOpen, onClose }: Props = $props();

  let el = $state<HTMLDivElement>();
  let pos = $state<{ left: number; top: number } | null>(null);
  const GAP = 8;

  function place(): void {
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(GAP, Math.min(a.left, window.innerWidth - w - GAP));
    const top = Math.max(GAP, Math.min(a.top, window.innerHeight - h - GAP));
    pos = { left, top };
  }

  // Place against the day, then take focus: the first event, or the list itself when the day has none.
  $effect(() => {
    if (!el) return;
    place();
    void tick().then(() => {
      const first = el?.querySelector<HTMLElement>('[data-day-event]');
      (first ?? el)?.focus();
    });
  });

  // A press anywhere else closes it, leaving focus where the press put it.
  $effect(() => {
    const onDown = (e: PointerEvent) => { if (el && !el.contains(e.target as Node)) onClose(false); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', place);
    };
  });

  function items(): HTMLElement[] {
    return [...(el?.querySelectorAll<HTMLElement>('[data-day-event]') ?? [])];
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = list[Math.min(list.length - 1, i + 1)];
    else if (e.key === 'ArrowUp') next = list[Math.max(0, i - 1)];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else return;
    e.preventDefault();
    next?.focus();
  }

  function onFocusout(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    // Focus moving to the hover preview, or nowhere (a window switch), keeps it open.
    if (to && el && !el.contains(to) && !(to instanceof Element && to.closest('.note-hover-preview'))) onClose(false);
  }

  const count = $derived(`${events.length} ${events.length === 1 ? 'event' : 'events'}`);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  class="cal-pop"
  class:cal-pop-placing={pos === null}
  role="dialog"
  aria-label="{label}, {count}"
  tabindex="-1"
  data-calendar-day-list
  style:left="{pos?.left ?? 0}px"
  style:top="{pos?.top ?? 0}px"
  onkeydown={onKeydown}
  onfocusout={onFocusout}
>
  <div class="cal-pop-head">
    <span class="cal-pop-title">{label}</span>
    <button type="button" class="cal-pop-close" aria-label="Close" onclick={() => onClose(true)}>✕</button>
  </div>
  {#if events.length === 0}
    <p class="cal-pop-empty">No events.</p>
  {:else}
    <ul class="cal-pop-list">
      {#each events as ev (ev.key)}
        {@const time = timeOf(ev)}
        <li>
          <button
            type="button"
            class="cal-pop-item"
            class:approx={ev.approx}
            data-day-event
            data-note-path={ev.key}
            aria-label={ev.label}
            aria-describedby={cardKey === ev.key ? cardId : undefined}
            onclick={() => onOpen(ev.key)}
            onfocus={(e) => hover.focus({ key: ev.key, target: ev.key, anchor: e.currentTarget, fallbackTitle: ev.title })}
            onblur={() => hover.blur(ev.key)}
            onpointerenter={(e) => hover.pointerEnter({ key: ev.key, target: ev.key, anchor: e.currentTarget, fallbackTitle: ev.title })}
            onpointerleave={() => hover.pointerLeave(ev.key)}
          >
            <span class="cal-pop-time">{time ?? (ev.ranged ? 'Multi-day' : 'All day')}</span>
            <span class="cal-pop-name">{ev.title}</span>
            <span class="cal-pop-date">{ev.dateText}{ev.approx ? ' (approximate)' : ''}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* A card surface: --bg-button + --text, the pairing that holds in the contrast theme (#2679 / #2688). */
  .cal-pop {
    position: fixed;
    z-index: 20;
    width: 260px;
    max-height: min(360px, calc(100vh - 16px));
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-button);
    color: var(--text);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
    font-family: var(--font-sans);
  }
  .cal-pop:focus { outline: none; }
  .cal-pop-placing { visibility: hidden; }
  .cal-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 4px 6px; }
  .cal-pop-title { font-size: 12px; font-weight: 600; }
  .cal-pop-close {
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .cal-pop-close:hover { background: color-mix(in oklch, var(--text) 10%, transparent); }
  .cal-pop-empty { margin: 4px; font-size: 12px; color: var(--text); }
  .cal-pop-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .cal-pop-item {
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
  .cal-pop-item.approx { border-left-style: dashed; }
  .cal-pop-item:hover { background: color-mix(in oklch, var(--text) 8%, transparent); }
  .cal-pop-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  .cal-pop-time { grid-row: span 2; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; padding-top: 1px; }
  .cal-pop-name { font-size: 12.5px; font-weight: 500; overflow-wrap: anywhere; }
  .cal-pop-date { font-size: 11px; }
</style>
