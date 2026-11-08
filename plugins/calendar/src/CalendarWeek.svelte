<script lang="ts">
  /**
   * The Calendar's time grid (#2951, epic #2949): a week's seven days — or,
   * for the Day view (#2952), one — as an all-day strip over 24 hours, drawn
   * from `time-grid.ts`'s layout. `Calendar.svelte` owns the page, the
   * writes and the popovers; this draws and handles the keyboard.
   *
   * - **The strip** holds day-precision and 24h+ events as bars, cut and
   *   hatched as the month grid's are, up to `STRIP_LINES` lines; past that
   *   `overflowRow` keeps the last line for "+N more", which opens the day's
   *   list.
   * - **The hours** are 48 half-hour rows of `SLOT_PX`. A timed piece is a
   *   button inside the cell where it starts, sized down to its end and
   *   across its share of the column (`lane` / `lanes`), so the ARIA grid
   *   stays rows of cells. Its left edge is its type's colour; an invented
   *   end is hatched; a cut at midnight shows ‹ / ›.
   * - **Scroll:** each page opens on its first timed event (half an hour
   *   before it), else on 8:00.
   * - **Now** is a line across today's column; a day whose clocks change
   *   says so in its header and marks the hour (`dstNote`).
   * - **Keyboard**, one tab stop (a roving tabindex on a cell; slot −1 is the
   *   day's all-day cell): ←/→ a day (`onGoToDay` turns the page past an
   *   edge), ↑/↓ half an hour (↑ from 0:00 reaches the all-day cell), Page
   *   Up/Down a week, Home/End the page's first and last day, Enter the
   *   day's list — or, choosing a day for *Move to date…*, that day. Tab from
   *   a cell goes into the events it holds, in time order; Shift+Tab or
   *   Escape from an event back to its cell.
   * - **Opening a day** (#2952, the week only): Alt+Enter on a cell, or a
   *   double-click on a day's number, asks for that day (`onOpenDay`).
   * - **One column** (the Day view): an event tall enough shows a second
   *   line, `detailOf`'s (the note's first card field).
   * - **Moving by time** (#2953, `timeMoves`; absent read-only): drag a timed
   *   event's body to move it, or its bottom edge to resize it, snapping to
   *   15 minutes, across days in a week (`time-drag.ts`). On a focused event,
   *   Alt+↑/↓ moves it 15 minutes and Alt+Shift+↑/↓ moves its end; focus
   *   follows the event to where it's drawn next. The write, its undo and its
   *   announcement are the host's.
   */
  import { tick } from 'svelte';
  import { DAY_MS } from '../../../src/shared/time';
  import { addDays, dayStart, overflowRow, type GridWeek, type PlacedSegment } from '../../../src/shared/objects/calendar-grid';
  import { dstNote, hasClockEnd, type TimeGridLayout, type TimedPiece } from '../../../src/shared/calendar/time-grid';
  import { dayName, timeOf, weekdayNames } from '../../../src/shared/calendar/calendar-model';
  import type { TimelineEvent } from '../../../src/shared/timeline/timeline-events';
  import type { NoteHover } from './hover.svelte';
  import { isMenuKey, openMenuAt } from './drag-keys';
  import { clockLabel, clockRange } from './week-nav';
  import { SNAP_MINUTES, timeDrag, type TimeDragKind, type TimeMoves } from './time-drag';

  interface Props {
    page: GridWeek;
    layout: TimeGridLayout;
    eventFor: (key: string) => TimelineEvent;
    /** An event's type colour, or null for the accent. */
    colorOf: (key: string) => string | null;
    /** Civil ms: today's start, and now. */
    today: number;
    now: number;
    locale?: string | undefined;
    /** The id of the title that names the grid. */
    labelledBy: string;
    /** *Move to date…* is choosing a day: the event being moved, and the bar that explains it. */
    movingKey: string | null;
    moveBarId: string;
    hover: NoteHover;
    cardId: string;
    cardKey: string | null;
    onOpen: (key: string) => void;
    /** Minerva's note menu for an event; null where the view has none. */
    onMenu: ((e: MouseEvent, key: string) => void) | null;
    onDayList: (day: number, anchor: HTMLElement) => void;
    /** Choosing a day: this one. */
    onChooseDay: (day: number) => void;
    onCancelChoose: () => void;
    /** Show the page holding `day` (focus moved past the page's edge). */
    onGoToDay: (day: number) => void;
    /** Open `day` in the Day view; null where that isn't offered (the Day view itself). */
    onOpenDay?: ((day: number) => void) | null;
    /** An event's second line (the Day view); null for none. */
    detailOf?: ((key: string) => string | null) | null;
    /** Moving and resizing by time; null where nothing moves. */
    timeMoves?: TimeMoves | null;
  }
  let {
    page, layout, eventFor, colorOf, today, now, locale, labelledBy, movingKey, moveBarId,
    hover, cardId, cardKey, onOpen, onMenu, onDayList, onChooseDay, onCancelChoose, onGoToDay,
    onOpenDay = null, detailOf = null, timeMoves = null,
  }: Props = $props();
  const uid = $props.id();

  /** Pixels: a half-hour row, a strip line, and the least a timed event is drawn. */
  const SLOT_PX = 24;
  const LINE_PX = 20;
  const MIN_EVENT_PX = 16;
  const PX_PER_MIN = SLOT_PX / 30;
  /** All-day lines shown before "+N more". */
  const STRIP_LINES = 3;
  const SLOTS = Array.from({ length: 48 }, (_, i) => i);
  const DEFAULT_SCROLL_MIN = 8 * 60;

  const choosing = $derived(movingKey !== null);
  const columns = $derived(page.days.map((d) => ({ day: d, names: weekdayNames(d.weekday, locale), dst: dstNote(d.start) })));

  // ── The strip ─────────────────────────────────────────────────────────
  const stripCapacity = $derived(layout.allDay.slotCount <= STRIP_LINES ? Math.max(1, layout.allDay.slotCount) : STRIP_LINES);
  const strip = $derived(overflowRow(layout.allDay, stripCapacity));
  const stripStarting = (c: number): PlacedSegment[] => strip.visible.filter((s) => s.startCol === c);
  const stripCount = $derived(page.days.map((_, c) => layout.allDay.segments.filter((s) => s.startCol <= c && s.endCol > c).length));

  // ── The hours ─────────────────────────────────────────────────────────
  const slotOf = (min: number) => Math.min(47, Math.floor(min / 30));
  /** The pieces starting in each cell, by `col:slot`, in time order. */
  const byCell = $derived.by(() => {
    const m = new Map<string, TimedPiece[]>();
    layout.timed.forEach((pieces, col) => {
      for (const p of pieces) {
        const k = `${col}:${slotOf(p.startMin)}`;
        const list = m.get(k);
        if (list) list.push(p); else m.set(k, [p]);
      }
    });
    return m;
  });
  const piecesAt = (col: number, slot: number): TimedPiece[] => byCell.get(`${col}:${slot}`) ?? [];

  /** "9:00 – 10:30", "22:00 – Wednesday 7 October, 2:30", or the start alone. */
  function whenText(ev: TimelineEvent): string {
    const start = timeOf(ev, locale);
    if (start === null) return ev.dateText;
    if (!hasClockEnd(ev)) return `${dayName(ev.start, locale)}, ${start}`;
    const sameDay = dayStart(ev.end - 1) === dayStart(ev.start);
    if (sameDay) return `${dayName(ev.start, locale)}, ${clockRange((ev.start - dayStart(ev.start)) / 60_000, (ev.end - dayStart(ev.start)) / 60_000, locale)}`;
    return `${dayName(ev.start, locale)}, ${start} – ${dayName(ev.end - 1, locale)}, ${clockLabel((ev.end - dayStart(ev.end)) / 60_000, locale)}`;
  }
  /** The chip's time: the range when there's room for two lines and the end is known. */
  function chipTime(p: TimedPiece, ev: TimelineEvent): string | null {
    if (p.continuesBefore) return null;
    const start = timeOf(ev, locale);
    if (!p.endKnown || p.endMin - p.startMin < 60 || p.continuesAfter) return start;
    return clockRange(p.startMin, p.endMin, locale);
  }
  const descKeys = $derived([...new Set([...strip.visible.map((s) => s.key), ...layout.timed.flat().map((p) => p.key)])]);
  const descId = (key: string) => `${uid}-d-${descKeys.indexOf(key)}`;
  const describe = (key: string) => [descId(key), cardKey === key ? cardId : null].filter(Boolean).join(' ');

  // ── Now and scroll ────────────────────────────────────────────────────
  const LAST_MINUTE = 24 * 60 - 1;
  const todayCol = $derived(page.days.findIndex((d) => d.start === today));
  const nowMin = $derived(Math.max(0, Math.min(LAST_MINUTE, (now - today) / 60_000)));

  /** The page's first timed event that starts on the page, in minutes past midnight; null when none. */
  const firstEventMin = $derived.by(() => {
    let first = Infinity;
    for (const col of layout.timed) for (const p of col) if (!p.continuesBefore) first = Math.min(first, p.startMin);
    return first === Infinity ? null : first;
  });
  /** The minute a page opens on: its first timed event, half an hour early; else 8:00. */
  const firstMin = $derived(firstEventMin === null ? DEFAULT_SCROLL_MIN : Math.max(0, firstEventMin - 30));
  let hours = $state<HTMLDivElement>();
  let scrolledFor = -1;
  $effect(() => {
    const key = page.start;
    const min = firstMin;
    if (!hours || key === scrolledFor) return;
    scrolledFor = key;
    hours.scrollTop = min * PX_PER_MIN;
  });

  // ── Focus: one tab stop ───────────────────────────────────────────────
  let focusedDay = $state<number | null>(null);
  let focusedSlot = $state<number | null>(null);
  const tabDay = $derived(focusedDay !== null && focusedDay >= page.start && focusedDay < page.end ? focusedDay : todayCol >= 0 ? today : page.start);
  const tabSlot = $derived(focusedSlot ?? slotOf(firstEventMin ?? DEFAULT_SCROLL_MIN));
  let grid = $state<HTMLDivElement>();

  const cellSel = (day: number, slot: number) => `[role="gridcell"][data-day="${day}"][data-slot="${slot}"]`;

  /** Focus a cell, showing its page first. Called by the calendar for *Move to date…*. */
  export async function focusCell(day: number, slot: number | null = null): Promise<void> {
    const d = dayStart(day);
    focusedDay = d;
    if (slot !== null) focusedSlot = slot;
    if (d < page.start || d >= page.end) onGoToDay(d);
    await tick();
    const s = slot ?? tabSlot;
    const el = grid?.querySelector<HTMLElement>(cellSel(d, s));
    el?.scrollIntoView?.({ block: 'nearest' });
    el?.focus();
  }

  function onGridKeydown(e: KeyboardEvent): void {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!cell || e.target !== cell) return;
    if (onOpenDay && e.altKey && e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !choosing) {
      e.preventDefault();
      onOpenDay(tabDay);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const day = tabDay;
    const slot = tabSlot;
    const columnsCount = page.days.length;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); void focusCell(addDays(day, -1), slot); return;
      case 'ArrowRight': e.preventDefault(); void focusCell(addDays(day, 1), slot); return;
      case 'ArrowUp': e.preventDefault(); void focusCell(day, Math.max(-1, slot - 1)); return;
      case 'ArrowDown': e.preventDefault(); void focusCell(day, Math.min(47, slot + 1)); return;
      case 'PageUp': e.preventDefault(); void focusCell(addDays(day, -columnsCount), slot); return;
      case 'PageDown': e.preventDefault(); void focusCell(addDays(day, columnsCount), slot); return;
      case 'Home': e.preventDefault(); void focusCell(page.start, slot); return;
      case 'End': e.preventDefault(); void focusCell(page.end - DAY_MS, slot); return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (choosing) onChooseDay(day);
        else onDayList(day, cell);
        return;
      case 'Escape':
        if (!choosing) return;
        e.preventDefault();
        onCancelChoose();
        return;
      case 'Tab': {
        if (e.shiftKey || choosing) return;
        const first = cell.querySelector<HTMLElement>('[data-calendar-event]');
        if (!first) return;
        e.preventDefault();
        first.focus();
      }
    }
  }

  // ── Moving by time (#2953) ────────────────────────────────────────────
  /** A drag is under way: no hover previews, which the app draws over the frame (`time-drag.ts`). */
  let dragging = false;
  /** An event moved by the keyboard: focus it again where it's drawn next. */
  let refocusKey: string | null = null;
  $effect(() => {
    void layout;
    const key = refocusKey;
    if (key === null) return;
    void tick().then(() => {
      const el = hours?.querySelector<HTMLElement>(`.wk-ev[data-note-path="${CSS.escape(key)}"]`);
      if (el && el !== document.activeElement) { el.focus(); el.scrollIntoView?.({ block: 'nearest' }); }
    });
  });

  /** Alt+↑/↓ moves a timed event 15 minutes; with Shift, its end. */
  function timeKey(e: KeyboardEvent, el: HTMLElement): boolean {
    if (!timeMoves || !e.altKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false;
    if (!el.classList.contains('wk-ev')) return false;
    e.preventDefault();
    e.stopPropagation();
    const key = el.dataset['notePath']!;
    const kind: TimeDragKind = e.shiftKey ? 'resize' : 'move';
    const refusal = timeMoves.refusal(key, kind);
    if (refusal !== null) { timeMoves.refused(refusal); return true; }
    const minutes = e.key === 'ArrowUp' ? -SNAP_MINUTES : SNAP_MINUTES;
    refocusKey = key;
    if (kind === 'move') timeMoves.move(key, minutes);
    else timeMoves.resize(key, minutes);
    return true;
  }

  /** Keys on an event: Tab / Shift+Tab through its cell's events, Escape back to the cell, the menu key. */
  function onEventKeydown(e: KeyboardEvent): void {
    const el = e.currentTarget as HTMLElement;
    const cell = el.closest<HTMLElement>('[role="gridcell"]')!;
    if (timeKey(e, el)) return;
    if (onMenu && isMenuKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      openMenuAt(el);
      return;
    }
    const all = [...cell.querySelectorAll<HTMLElement>('[data-calendar-event]')];
    const i = all.indexOf(el);
    if (e.key === 'Escape') { e.preventDefault(); cell.focus(); return; }
    if (e.key !== 'Tab') return;
    if (e.shiftKey) { e.preventDefault(); (all[i - 1] ?? cell).focus(); return; }
    const next = all[i + 1];
    if (next) { e.preventDefault(); next.focus(); }
  }

  function onCellClick(day: number, slot: number): void {
    focusedDay = day;
    focusedSlot = slot;
    if (choosing) onChooseDay(day);
  }
  const eventHandlers = (key: string, ev: TimelineEvent) => ({
    onclick: (e: MouseEvent) => { e.stopPropagation(); onOpen(key); },
    oncontextmenu: (e: MouseEvent) => onMenu?.(e, key),
    onpointerenter: (e: PointerEvent) => { if (!dragging) hover.pointerEnter({ key, target: key, anchor: e.currentTarget as Element, fallbackTitle: ev.title }); },
    onpointerleave: () => hover.pointerLeave(key),
    onfocus: (e: FocusEvent) => hover.focus({ key, target: key, anchor: e.currentTarget as Element, fallbackTitle: ev.title }),
    onblur: () => hover.blur(key),
    onkeydown: onEventKeydown,
  });

  const cellCount = (n: number) => (n === 0 ? 'no events' : n === 1 ? '1 event' : `${n} events`);
  const dstText = (n: NonNullable<ReturnType<typeof dstNote>>) => n.kind === 'skipped'
    ? `Clocks go forward: ${clockLabel(n.atMin, locale)} – ${clockLabel(n.atMin + n.minutes, locale)} is skipped`
    : `Clocks go back: ${clockLabel(n.atMin, locale)} – ${clockLabel(n.atMin + n.minutes, locale)} happens twice`;
</script>

<!-- The cells are the tab stops (a roving tabindex), not the grid itself. -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  bind:this={grid}
  class="wk"
  class:wk-choosing={choosing}
  role="grid"
  aria-labelledby={labelledBy}
  data-week-start={page.start}
  style:--cols={page.days.length}
  onkeydown={onGridKeydown}
  use:timeDrag={{
    enabled: timeMoves !== null && !choosing,
    pxPerMinute: PX_PER_MIN,
    refusal: (key, kind) => timeMoves?.refusal(key, kind) ?? null,
    previewText: (key, kind, minutes) => timeMoves?.previewText(key, kind, minutes) ?? null,
    onMove: (key, minutes) => timeMoves?.move(key, minutes),
    onResize: (key, minutes) => timeMoves?.resize(key, minutes),
    onRefused: (_key, text) => timeMoves?.refused(text),
    onDragStart: () => { dragging = true; hover.close(); },
    onDragEnd: () => { dragging = false; },
  }}
>
  <div class="wk-top" role="rowgroup">
    <div class="wk-row wk-head" role="row">
      <div class="wk-corner" role="columnheader" aria-label="Time"></div>
      {#each columns as { day, names, dst } (day.start)}
        <div class="wk-colhead" class:wk-today={day.start === today} role="columnheader" aria-label="{dayName(day.start, locale)}{dst ? `. ${dstText(dst)}` : ''}">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span aria-hidden="true"><span class="wk-wd">{names.short}</span> <span class="wk-num" ondblclick={onOpenDay && !choosing ? () => onOpenDay(day.start) : undefined}>{day.day}</span></span>
          {#if dst}<span class="wk-dst" aria-hidden="true" title={dstText(dst)}>{dst.kind === 'skipped' ? 'Clocks forward' : 'Clocks back'}</span>{/if}
        </div>
      {/each}
    </div>
    <div class="wk-row wk-strip" role="row" style:--lines={stripCapacity}>
      <div class="wk-time wk-allday-label" role="rowheader">all-day</div>
      {#each page.days as day, c (day.start)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="wk-cell wk-allday"
          role="gridcell"
          tabindex={day.start === tabDay && tabSlot === -1 ? 0 : -1}
          data-day={day.start}
          data-slot={-1}
          aria-describedby={choosing && day.start === tabDay && tabSlot === -1 ? moveBarId : undefined}
          onclick={() => onCellClick(day.start, -1)}
          onfocus={() => { focusedDay = day.start; focusedSlot = -1; }}
        >
          <span class="visually-hidden">{dayName(day.start, locale)}, all day, {cellCount(stripCount[c] ?? 0)}</span>
          {#each stripStarting(c) as s (s.key)}
            {@const ev = eventFor(s.key)}
            {@const span = s.endCol - s.startCol}
            {@const solid = s.uncertainFromCol === null ? 1 : (s.uncertainFromCol - s.startCol) / span}
            <button
              type="button"
              class="wk-bar"
              class:wk-cont-before={s.continuesBefore}
              class:wk-cont-after={s.continuesAfter}
              class:wk-approx={s.uncertainFromCol !== null}
              tabindex="-1"
              style:top="{s.slot * LINE_PX + 2}px"
              style:--span={span}
              style:--solid="{solid * 100}%"
              style:--ev-color={colorOf(s.key)}
              data-calendar-event
              data-note-path={s.key}
              data-moving={movingKey === s.key || undefined}
              aria-describedby={describe(s.key)}
              {...eventHandlers(s.key, ev)}
            >
              {#if s.uncertainFromCol !== null}<span class="wk-hatch" aria-hidden="true"></span>{/if}
              {#if s.continuesBefore}<span class="wk-mark" aria-hidden="true">‹</span>{/if}
              <span class="wk-title">{ev.title}</span>
              {#if s.continuesAfter}<span class="wk-mark wk-mark-after" aria-hidden="true">›</span>{/if}
            </button>
          {/each}
          {#if (strip.more[c] ?? 0) > 0}
            <button
              type="button"
              class="wk-more"
              tabindex="-1"
              style:top="{(stripCapacity - 1) * LINE_PX + 2}px"
              aria-label="{strip.more[c]} more on {dayName(day.start, locale)}"
              onclick={(e) => { e.stopPropagation(); onDayList(day.start, e.currentTarget.closest('[role="gridcell"]') as HTMLElement); }}
            >+{strip.more[c]} more</button>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <div class="wk-hours" role="rowgroup" bind:this={hours}>
    {#each SLOTS as slot (slot)}
      <div class="wk-row wk-slot" class:wk-hour={slot % 2 === 0} role="row">
        <div class="wk-time" role="rowheader" aria-label={clockLabel(slot * 30, locale)}>
          {#if slot % 2 === 0 && slot > 0}<span aria-hidden="true">{clockLabel(slot * 30, locale)}</span>{/if}
        </div>
        {#each columns as { day, dst }, c (day.start)}
          {@const pieces = piecesAt(c, slot)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="wk-cell"
            class:wk-today-col={day.start === today}
            role="gridcell"
            tabindex={day.start === tabDay && slot === tabSlot ? 0 : -1}
            data-day={day.start}
            data-slot={slot}
            aria-describedby={choosing && day.start === tabDay && slot === tabSlot ? moveBarId : undefined}
            onclick={() => onCellClick(day.start, slot)}
            onfocus={() => { focusedDay = day.start; focusedSlot = slot; }}
          >
            <span class="visually-hidden">{dayName(day.start, locale)}, {clockLabel(slot * 30, locale)}, {cellCount(pieces.length)}</span>
            {#if dst && slotOf(dst.atMin) === slot}
              <span class="wk-dst-line" class:wk-dst-twice={dst.kind === 'repeated'} aria-hidden="true" title={dstText(dst)} style:top="{(dst.atMin - slot * 30) * PX_PER_MIN}px" style:height="{dst.minutes * PX_PER_MIN}px"></span>
            {/if}
            {#if c === todayCol && slotOf(nowMin) === slot}
              <span class="wk-now" aria-hidden="true" style:top="{(nowMin - slot * 30) * PX_PER_MIN}px"></span>
            {/if}
            {#each pieces as p (p.key)}
              {@const ev = eventFor(p.key)}
              {@const time = chipTime(p, ev)}
              {@const height = Math.max(MIN_EVENT_PX, (p.endMin - p.startMin) * PX_PER_MIN) - 1}
              {@const detail = detailOf && height >= 3 * MIN_EVENT_PX ? detailOf(p.key) : null}
              <button
                type="button"
                class="wk-ev"
                class:wk-short={height < 2 * MIN_EVENT_PX}
                class:wk-approx={!p.endKnown}
                class:wk-cont-before={p.continuesBefore}
                class:wk-cont-after={p.continuesAfter}
                tabindex="-1"
                style:top="{(p.startMin - slot * 30) * PX_PER_MIN}px"
                style:height="{height}px"
                style:left="calc({(p.lane / p.lanes) * 100}% + 1px)"
                style:width="calc({100 / p.lanes}% - 3px)"
                style:--ev-color={colorOf(p.key)}
                data-calendar-event
                data-note-path={p.key}
                data-col={p.col}
                data-start-min={p.startMin}
                data-end-min={p.endMin}
                data-lane={p.lane}
                data-lanes={p.lanes}
                data-moving={movingKey === p.key || undefined}
                aria-describedby={describe(p.key)}
                aria-keyshortcuts={timeMoves ? 'Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : undefined}
                {...eventHandlers(p.key, ev)}
              >
                {#if p.continuesBefore}<span class="wk-mark" aria-hidden="true">‹</span>{/if}
                {#if time}<span class="wk-time-text">{time}</span>{/if}
                <span class="wk-title">{ev.title}</span>
                {#if detail}<span class="wk-detail">{detail}</span>{/if}
                {#if p.continuesAfter}<span class="wk-mark wk-mark-after" aria-hidden="true">›</span>{/if}
                {#if timeMoves && !p.continuesAfter}<span class="wk-resize" data-resize-handle aria-hidden="true"></span>{/if}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <div hidden>
    {#each descKeys as key (key)}
      {@const ev = eventFor(key)}
      <span id={descId(key)}>{ev.title}, {whenText(ev)}</span>
    {/each}
  </div>
</div>

<style>
  .wk { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; border-top: 1px solid var(--border); background: var(--bg); }
  .wk-row { display: grid; grid-template-columns: 5em repeat(var(--cols), minmax(0, 1fr)); }
  .wk-top { flex-shrink: 0; border-bottom: 1px solid var(--border); }
  .wk-head { border-bottom: 1px solid var(--border); }
  .wk-colhead { padding: 4px 6px; font-size: 11px; color: var(--text-muted); min-width: 0; }
  .wk-num {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 18px; height: 18px; padding: 0 3px; border-radius: 999px;
    font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--text);
  }
  /* Today: a ring and a bold number — never colour alone. */
  .wk-today .wk-num { font-weight: 700; box-shadow: 0 0 0 2px var(--text); }
  .wk-dst { display: block; font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wk-time { font-size: 10.5px; color: var(--text-muted); text-align: right; padding-right: 6px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .wk-slot .wk-time span { position: relative; top: -7px; }
  .wk-allday-label { padding-top: 4px; }
  .wk-strip .wk-cell { height: calc(var(--lines) * 20px + 4px); }
  .wk-hours { flex: 1; min-height: 0; overflow-y: auto; }
  .wk-cell {
    position: relative;
    min-width: 0;
    border-left: 1px solid var(--border);
    box-sizing: border-box;
    outline: none;
  }
  .wk-slot .wk-cell { height: 24px; }
  .wk-hour .wk-cell { border-top: 1px solid var(--border); }
  .wk-slot:not(.wk-hour) .wk-cell { border-top: 1px dotted color-mix(in oklch, var(--border) 60%, transparent); }
  .wk-today-col { background: color-mix(in oklch, var(--accent) 4%, var(--bg)); }
  .wk-cell:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
  .wk-choosing .wk-cell { cursor: pointer; }
  .wk-choosing .wk-cell:focus { box-shadow: inset 0 0 0 2px var(--accent); }
  .wk-choosing .wk-ev, .wk-choosing .wk-bar, .wk-choosing .wk-more { pointer-events: none; }

  .wk-ev, .wk-bar {
    position: absolute;
    z-index: 1;
    display: flex;
    gap: 4px;
    padding: 1px 5px;
    overflow: hidden;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-left: 3px solid var(--ev-color, var(--accent));
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    font-size: 11.5px;
    line-height: 14px;
    text-align: left;
    cursor: pointer;
  }
  .wk-ev { flex-direction: column; align-items: flex-start; }
  .wk-ev.wk-short { flex-direction: row; align-items: center; white-space: nowrap; padding-top: 0; padding-bottom: 0; }
  .wk-ev:hover, .wk-bar:hover, .wk-ev:focus-visible, .wk-bar:focus-visible { border-color: var(--ev-color, var(--accent)); outline: none; }
  .wk-ev[data-moving], .wk-bar[data-moving] { outline: 2px dashed var(--accent); outline-offset: 1px; }
  /* Moving by time (#2953): the bottom edge resizes; a dragged event says where it lands. */
  .wk-resize { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; cursor: ns-resize; }
  .wk-ev[data-dragging] { z-index: 3; opacity: 0.85; box-shadow: 0 4px 14px color-mix(in oklch, var(--bg) 50%, transparent); }
  .wk-ev[data-drop-time]::after {
    content: attr(data-drop-time);
    position: absolute; right: 2px; top: 1px;
    padding: 0 4px; border-radius: 3px;
    background: var(--text); color: var(--bg);
    font-size: 10.5px; font-weight: 600; font-variant-numeric: tabular-nums;
  }
  /* An invented end (none written, or a coarse one): hatched, the month grid's approximate style. */
  .wk-ev.wk-approx {
    border-bottom: 1px dashed var(--ev-color, var(--accent));
    background: repeating-linear-gradient(45deg, color-mix(in oklch, var(--ev-color, var(--accent)) 30%, var(--bg-button)) 0 2px, var(--bg-button) 2px 5px);
  }
  .wk-ev.wk-cont-before { border-top-left-radius: 0; border-top-right-radius: 0; border-top-style: dashed; }
  .wk-ev.wk-cont-after { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .wk-time-text { font-weight: 600; font-variant-numeric: tabular-nums; }
  .wk-title { overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .wk-short .wk-title { white-space: nowrap; }
  .wk-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; color: var(--text-muted); font-size: 11px; }
  .wk-mark { font-weight: 700; }
  .wk-mark-after { margin-left: auto; }

  .wk-bar {
    left: 2px;
    height: 18px;
    align-items: center;
    white-space: nowrap;
    width: calc(var(--span) * 100% + (var(--span) - 1) * 1px - 4px);
    border-color: var(--ev-color, var(--accent));
  }
  .wk-bar.wk-cont-before { left: 0; border-left-width: 1px; border-top-left-radius: 0; border-bottom-left-radius: 0; width: calc(var(--span) * 100% + (var(--span) - 1) * 1px - 2px); }
  .wk-bar.wk-cont-after { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .wk-bar.wk-approx { border-right-style: dashed; }
  .wk-hatch {
    position: absolute; top: -1px; bottom: -1px; left: var(--solid); right: -1px;
    border: 1px dashed var(--ev-color, var(--accent));
    background: repeating-linear-gradient(45deg, color-mix(in oklch, var(--accent) 45%, var(--bg-button)) 0 2px, var(--bg-button) 2px 5px);
    pointer-events: none;
  }
  .wk-bar .wk-title, .wk-bar .wk-mark { position: relative; background: var(--bg-button); padding: 0 2px; border-radius: 2px; }
  .wk-more {
    position: absolute; left: 2px; right: 2px; height: 18px; padding: 0 5px;
    border: none; border-radius: 4px; background: transparent; color: var(--text);
    font-family: inherit; font-size: 11px; font-weight: 600; text-align: left; cursor: pointer;
  }
  .wk-more:hover { background: color-mix(in oklch, var(--text) 10%, transparent); }

  /* Now: a line with a dot, in the text colour — position, not colour, carries it. */
  .wk-now { position: absolute; z-index: 2; left: 0; right: 0; border-top: 2px solid var(--text); pointer-events: none; }
  .wk-now::before { content: ''; position: absolute; left: -4px; top: -5px; width: 8px; height: 8px; border-radius: 999px; background: var(--text); }
  /* A DST change: the skipped hour dashed off, or the repeated one doubled. */
  .wk-dst-line {
    position: absolute; left: 0; right: 0; z-index: 0; pointer-events: none;
    border-top: 1px dashed var(--text-muted); border-bottom: 1px dashed var(--text-muted);
    background: repeating-linear-gradient(-45deg, color-mix(in oklch, var(--text) 8%, transparent) 0 3px, transparent 3px 7px);
  }
  .wk-dst-twice { border-style: double; }
</style>
