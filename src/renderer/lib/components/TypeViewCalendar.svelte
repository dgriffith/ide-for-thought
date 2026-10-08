<script lang="ts">
  /**
   * The Calendar layout of a type view (#2702, epic #2699): a month grid of the
   * notes of any type with a date property, placed by the view's *Date by*
   * (`dateBy`; `date` by default). `TypeView` scopes and filters the
   * instances; this draws them. The design is the Calendar story's
   * (`docs/vision/objects-expansion.md`, "Calendar", and the nine decisions
   * confirmed on #2699); the grid maths is `shared/objects/calendar-grid.ts`.
   *
   * - **The page** is `month` (`"2026-10"`), absent meaning this month.
   *   Previous / Today / Next write it back through `onStateChange` (Today
   *   writes null, the current month). A page shows 4–6 rows (`monthWeeks`),
   *   from the per-machine week start (`settings-calendar.svelte.ts`: the
   *   system region, or Monday / Sunday / Saturday), with leading and trailing
   *   days dimmed, and ISO week numbers when that setting is on.
   * - **Events** are read once per data revision (`calendar-model.ts`, through
   *   the Timeline's read). A day or clock start sits in its cell, a clock one
   *   with its local time; an offset value lands on the viewer's own day
   *   (decision 7) and the hover card says what was written when that day
   *   differs. A multi-day event is a bar cut at each row (`segmentByWeek`),
   *   one slot across its row (`layoutMonth`), with ‹ › continuation marks; an
   *   end coarser than the start hatches the days it only might cover
   *   (`uncertainFromCol`), the Timeline's approximate style.
   * - **Overflow.** A cell's capacity is measured, not assumed: each row's
   *   height (ResizeObserver) less the day number, in 20px slots, never under
   *   two (rows have a 64px floor and the grid scrolls below it). Past it,
   *   `overflowRow` keeps the last slot for "+N more" and never draws a bar
   *   in pieces. "+N more", and Enter on a day, open the day's whole list
   *   (`CalendarDayList`); Escape closes it and returns focus to the day.
   * - **Bands and tray** (decision 3): month-only starts in a month band and
   *   year-only starts in a year band, on every page their range meets, each
   *   marked "since …"/"until …" where it runs past the page; shown above the
   *   grid but after it in tab order. Undated notes are in the Undated tray.
   * - **Keyboard**, the WAI-ARIA date grid: `role="grid"` with one tab stop
   *   (a roving tabindex on the focused day). ←/→ a day, ↑/↓ a week, turning
   *   the page past the grid's edge; Page Up/Down a month and Shift+Page
   *   Up/Down a year, clamped (`addMonthsClamped`); Home/End the row's ends;
   *   Enter (or Space) the day's list. Today is `aria-current="date"` with a
   *   ring and a bold number, not colour alone.
   * - **Hover preview** (#2713): the shared `NoteHoverPreview` on hover over an
   *   event and on keyboard focus in the day list, with the dates as extra
   *   lines and the type's card fields.
   * - **Read-only** (an embed, `readOnly`): paging still works — it changes
   *   what is shown, not the note — but nothing is written back.
   * - **Export** (`exportMode`, #2704): the page's month as a static grid
   *   (`CalendarExportGrid`, in place of the interactive one) with every
   *   event listed in its day's cell — "+N more" can't open on paper. No
   *   navigation, tab stops, hover or popover; every event, band entry and
   *   Undated row a link through `data-note-path`; a legend when anything is
   *   hatched. The bands and the Undated tray follow the grid: in print the
   *   grid is what the reader came for, and a band above it could push the
   *   month onto a second page. The week start and week numbers are the
   *   per-machine settings, as in the preview the author exported from.
   * - **Reschedule** (#2703; not read-only, not export): drag an event onto
   *   another day (`calendar/event-drag.ts`, pointer events) and the whole
   *   event moves by drop day − grab day, whichever segment was grabbed; or,
   *   from the day's list, Shift+F10 / ContextMenu → *Move to date…*, which
   *   puts the grid in "choose a day" mode (`CalendarMoveBar`: Enter or a
   *   click on a day moves it there, a typed date works too, Escape cancels).
   *   The write is the `kanban-moves` store's `rescheduleEvent` (start and end
   *   in one save, `date-shift.ts`'s rule); ⌘Z here undoes the calendar's
   *   last move. An event whose start or end is only a month or year doesn't
   *   move: a drag or the menu says why.
   */
  import { tick, untrack } from 'svelte';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../shared/objects/type-def';
  import {
    addDays, addMonths, addMonthsClamped, coveredDays, formatMonthAnchor, layoutMonth, monthOf, monthWeeks, overflowRow,
    parseMonthAnchor, rowWeekNumber, weekEdge, type CalendarMonth, type PlacedSegment, type Weekday,
  } from '../../../shared/objects/calendar-grid';
  import { civilMs } from '../../../shared/objects/date-precision';
  import NoteHoverPreview from './NoteHoverPreview.svelte';
  import CalendarDayList from './calendar/CalendarDayList.svelte';
  import CalendarBands from './calendar/CalendarBands.svelte';
  import CalendarExportGrid from './calendar/CalendarExportGrid.svelte';
  import { createNoteHover } from './note-hover/note-hover.svelte';
  import { timelineProperties, type TimelineEvent } from './timeline/timeline-events';
  import { buildCalendarModel, dayEvents, dayName, monthTitle, pageBands, pageItems, timeOf, weekdayNames, writtenAs, yearName } from './calendar/calendar-model';
  import { getCalendarSettings } from '../stores/settings-calendar.svelte';
  import { announce } from '../stores/announcer.svelte';
  import { eventDrag } from './calendar/event-drag';
  import CalendarMoveBar from './calendar/CalendarMoveBar.svelte';
  import { createReschedule } from './calendar/reschedule-controller.svelte';

  interface Props {
    type: TypeInfo;
    properties: PropertyDef[];
    /** The view's instances, scoped and filtered. */
    instances: TypeInstanceRow[];
    /** The page (`"2026-10"`); null = this month. */
    month: string | null;
    /** The view's Date by (null = the default, `date-by.ts`). */
    dateBy?: string | null;
    display: (prop: PropertyDef, value: string | null) => string;
    rowType: (inst: TypeInstanceRow) => TypeInfo | null;
    onOpenNote: (path: string) => void;
    onStateChange: (patch: { month: string | null }) => void;
    /** An embed: pages, but writes nothing back. */
    readOnly?: boolean;
    /** Draw for an export (#2704; see the header). */
    exportMode?: boolean;
    /** Formatting locale; the viewer's when absent. */
    locale?: string;
    /** The week start and week numbers; the per-machine settings when absent. */
    weekStart?: Weekday;
    showWeekNumbers?: boolean;
  }
  let {
    type, properties, instances, month, dateBy = null, display, rowType, onOpenNote, onStateChange,
    readOnly = false, exportMode = false, locale, weekStart, showWeekNumbers,
  }: Props = $props();

  const uid = $props.id();
  const settings = getCalendarSettings();
  const interactive = $derived(!readOnly && !exportMode);
  const firstDay = $derived<Weekday>(weekStart ?? settings.weekStart);
  const weekNumbers = $derived(showWeekNumbers ?? settings.showWeekNumbers);

  /** Line metrics, px: the day number, one event slot (an 18px chip and its gap), and the cell's padding. */
  const DAY_PX = 22;
  const SLOT_PX = 20;
  const PAD_PX = 4;
  /** Before a row is measured (and in a test DOM, which has no layout). */
  const FALLBACK_CAPACITY = 4;
  const MIN_CAPACITY = 2;

  const dates = $derived(timelineProperties(dateBy, properties));
  const model = $derived(buildCalendarModel(instances, locale ? { ...dates, locale } : dates));

  // ── The page ──────────────────────────────────────────────────────────
  function todayCivil(): number {
    const now = new Date();
    return civilMs(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const today = todayCivil();
  /** A page turned here, ahead of (or, read-only, instead of) the `month` prop. */
  let override = $state<CalendarMonth | null>(null);
  // A `month` that arrives as props (our own write echoing back, a restored
  // tab, Back) is the page from then on.
  $effect(() => { void month; untrack(() => { override = null; }); });
  const page = $derived<CalendarMonth>(override ?? parseMonthAnchor(month) ?? monthOf(today));
  const pageKey = (m: CalendarMonth) => m.year * 12 + m.month;

  function goTo(m: CalendarMonth, opts: { current?: boolean } = {}): void {
    override = m;
    if (interactive) onStateChange({ month: opts.current ? null : formatMonthAnchor(m) });
  }

  const weeks = $derived(monthWeeks(page, firstDay));
  const gridStart = $derived(weeks[0]!.start);
  const gridEnd = $derived(weeks[weeks.length - 1]!.end);
  const rows = $derived(layoutMonth(pageItems(model.grid, weeks), weeks));
  const bands = $derived(pageBands(model, page, locale));
  const title = $derived(monthTitle(page, locale));
  const columns = $derived(weeks[0]!.days.map((d) => weekdayNames(d.weekday, locale)));

  // ── Capacity, measured per row ────────────────────────────────────────
  let rowHeights = $state<number[]>([]);
  function capacityOf(row: number): number {
    const h = rowHeights[row] ?? 0;
    if (h <= 0) return FALLBACK_CAPACITY;
    return Math.max(MIN_CAPACITY, Math.floor((h - DAY_PX - PAD_PX) / SLOT_PX));
  }
  function measureRow(node: HTMLElement, row: number) {
    let r = row;
    if (typeof ResizeObserver === 'undefined') return { update(next: number) { r = next; } };
    const ro = new ResizeObserver(() => {
      const h = node.clientHeight;
      if (rowHeights[r] !== h) { const next = [...rowHeights]; next[r] = h; rowHeights = next; }
    });
    ro.observe(node);
    return { update(next: number) { r = next; }, destroy() { ro.disconnect(); } };
  }
  const drawn = $derived(rows.map((row) => ({ ...overflowRow(row, capacityOf(row.row)), slotCount: row.slotCount })));
  /** Segments to draw in a cell: the ones that start there. */
  function startingAt(r: number, c: number): PlacedSegment[] {
    return drawn[r]?.visible.filter((s) => s.startCol === c) ?? [];
  }
  /** Per row and column: how many events cover the day (drawn or behind "+N more"). */
  const counts = $derived(rows.map((row) => {
    const n = new Array<number>(7).fill(0);
    for (const s of row.segments) for (let c = s.startCol; c < s.endCol; c++) n[c]!++;
    return n;
  }));

  // ── Focus: one tab stop ───────────────────────────────────────────────
  let focusedDay = $state<number | null>(null);
  const tabDay = $derived.by<number>(() => {
    if (focusedDay !== null && focusedDay >= gridStart && focusedDay < gridEnd) return focusedDay;
    const { start, end } = { start: civilMs(page.year, page.month - 1, 1), end: civilMs(page.year, page.month, 1) };
    return today >= start && today < end ? today : start;
  });
  let grid = $state<HTMLDivElement>();

  async function focusDay(day: number, turn: 'off-grid' | 'other-month'): Promise<void> {
    focusedDay = day;
    const m = monthOf(day);
    const turnPage = turn === 'other-month' ? pageKey(m) !== pageKey(page) : day < gridStart || day >= gridEnd;
    if (turnPage) goTo(m);
    await tick();
    grid?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
  }

  function onGridKeydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const from = tabDay;
    let to: number;
    let turn: 'off-grid' | 'other-month' = 'off-grid';
    switch (e.key) {
      case 'ArrowLeft': to = addDays(from, -1); break;
      case 'ArrowRight': to = addDays(from, 1); break;
      case 'ArrowUp': to = addDays(from, -7); break;
      case 'ArrowDown': to = addDays(from, 7); break;
      case 'PageUp': to = addMonthsClamped(from, e.shiftKey ? -12 : -1); turn = 'other-month'; break;
      case 'PageDown': to = addMonthsClamped(from, e.shiftKey ? 12 : 1); turn = 'other-month'; break;
      case 'Home': to = weekEdge(from, firstDay, 'start'); break;
      case 'End': to = weekEdge(from, firstDay, 'end'); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (move.moving) move.confirm(from);
        else openList(from);
        return;
      case 'Escape':
        if (!move.moving) return;
        e.preventDefault();
        move.cancel(true);
        return;
      default: return;
    }
    e.preventDefault();
    void focusDay(to, turn);
  }

  // ── The day's list ────────────────────────────────────────────────────
  let listDay = $state<number | null>(null);
  let listAnchor = $state<HTMLElement | null>(null);
  function openList(day: number): void {
    const cell = grid?.querySelector<HTMLElement>(`[data-day="${day}"]`) ?? null;
    if (!cell) return;
    hover.close();
    focusedDay = day;
    listAnchor = cell;
    listDay = day;
  }
  function closeList(returnFocus: boolean): void {
    const day = listDay;
    listDay = null;
    listAnchor = null;
    if (returnFocus && day !== null) void tick().then(() => grid?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus());
  }
  // A page turn closes it.
  $effect(() => { void page; untrack(() => { if (listDay !== null) closeList(false); }); });

  // ── Hover preview ─────────────────────────────────────────────────────
  const hover = createNoteHover();
  const cardId = `${uid}-card`;
  const cardKey = $derived(exportMode ? null : hover.current?.key ?? null);
  const cardEvent = $derived(cardKey ? model.byKey.get(cardKey) ?? null : null);
  const cardWritten = $derived(cardEvent ? writtenAs(cardEvent, cardEvent.inst.values[dates.dateProperty]) : null);
  function hoverIn(ev: TimelineEvent, anchor: Element): void {
    if (!exportMode) hover.pointerEnter({ key: ev.key, target: ev.key, anchor, fallbackTitle: ev.title });
  }
  const fmtTime = (ev: TimelineEvent) => timeOf(ev, locale);

  function eventFor(key: string): TimelineEvent {
    return model.byKey.get(key)!;
  }
  /** A bar's span in columns, for its width. */
  const spanOf = (s: PlacedSegment) => s.endCol - s.startCol;

  // ── Reschedule (#2703, `calendar/reschedule-controller.svelte.ts`) ───
  const move = createReschedule({
    model: () => model, dates: () => dates, locale: () => locale, interactive: () => interactive,
    focusDay: (day) => void focusDay(day, 'other-month'), closeList: () => closeList(false),
  });
  const moveBarId = `${uid}-move`;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cal" class:cal-export={exportMode} onkeydown={move.onKeydown} onfocusout={move.onFocusout}>
  <div class="cal-toolbar">
    <h2 class="cal-title" id="{uid}-title">{title}</h2>
    {#if !exportMode}
      <div class="cal-nav">
        <button type="button" class="cal-btn" aria-label="Previous month" title="Previous month" onclick={() => goTo(addMonths(page, -1))}>‹</button>
        <button type="button" class="cal-btn" title="This month" onclick={() => goTo(monthOf(today), { current: true })}>Today</button>
        <button type="button" class="cal-btn" aria-label="Next month" title="Next month" onclick={() => goTo(addMonths(page, 1))}>›</button>
      </div>
    {/if}
  </div>

  {#if move.moving}
    <CalendarMoveBar
      title={move.moving.title}
      id={moveBarId}
      onTyped={move.confirm}
      onInvalid={(t) => announce(`${t.trim() === '' ? 'Nothing typed' : `“${t.trim()}” isn’t a day`}: type a date like 2026-10-12.`)}
      onCancel={() => move.cancel(true)}
    />
  {/if}

  <div class="cal-main">
    {#if exportMode}
    <CalendarExportGrid grid={model.grid} {page} weekStart={firstDay} {weekNumbers} {locale} />
    {:else}
    <!-- The days are the tab stops (a roving tabindex), not the grid itself. -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div
      bind:this={grid}
      class="cal-grid"
      class:cal-wk-on={weekNumbers}
      class:cal-choosing={move.moving !== null}
      role="grid"
      aria-labelledby="{uid}-title"
      data-month={formatMonthAnchor(page)}
      data-week-start={firstDay}
      onkeydown={onGridKeydown}
      use:eventDrag={{
        enabled: interactive && move.moving === null,
        refusal: move.refusalOf,
        coverage: (key) => { const ev = model.byKey.get(key); return ev ? coveredDays(ev) : null; },
        onDragStart: () => { hover.close(); if (listDay !== null) closeList(false); },
        onDrop: move.move,
        onRefused: (_key, text) => announce(text),
      }}
    >
      <div class="cal-row cal-head" role="row">
        {#if weekNumbers}<div class="cal-wk cal-wk-head" role="columnheader" aria-label="Week number"><span aria-hidden="true">Wk</span></div>{/if}
        {#each columns as col, c (c)}
          <div class="cal-colhead" role="columnheader" aria-label={col.long}><span aria-hidden="true">{col.short}</span></div>
        {/each}
      </div>
      {#each weeks as week, r (week.start)}
        {@const view = drawn[r]}
        <div
          class="cal-row cal-week"
          role="row"
          use:measureRow={r}
        >
          {#if weekNumbers}
            {@const wk = rowWeekNumber(week)}
            <div class="cal-wk" role="rowheader" aria-label="Week {wk.week}">{wk.week}</div>
          {/if}
          {#each week.days as day, c (day.start)}
            {@const isToday = day.start === today}
            {@const n = counts[r]?.[c] ?? 0}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="cal-day"
              class:cal-out={!day.inMonth}
              class:cal-today={isToday}
              role="gridcell"
              tabindex={day.start === tabDay ? 0 : -1}
              aria-label="{dayName(day.start, locale)}, {n === 0 ? 'no events' : n === 1 ? '1 event' : `${n} events`}"
              aria-current={isToday ? 'date' : undefined}
              aria-describedby={move.moving && day.start === tabDay ? moveBarId : undefined}
              data-day={day.start}
              onclick={() => { if (move.moving) move.confirm(day.start); else { focusedDay = day.start; } }}
              onfocus={() => (focusedDay = day.start)}
            >
              <span class="cal-num" aria-hidden="true">{day.day}</span>
              {#each startingAt(r, c) as s (s.key)}
                {@const ev = eventFor(s.key)}
                {@const time = fmtTime(ev)}
                {@const span = spanOf(s)}
                {@const multi = span > 1 || s.continuesBefore || s.continuesAfter}
                {@const solid = s.uncertainFromCol === null ? 1 : (s.uncertainFromCol - s.startCol) / span}
                <button
                  type="button"
                  class="cal-ev"
                  class:cal-bar={multi}
                  class:cal-cont-before={s.continuesBefore}
                  class:cal-cont-after={s.continuesAfter}
                  class:cal-approx={s.uncertainFromCol !== null}
                  class:cal-fixed={!interactive || move.refusalOf(s.key) !== null}
                  data-moving={move.moving?.key === s.key || undefined}
                  tabindex="-1"
                  style:top="{DAY_PX + s.slot * SLOT_PX}px"
                  style:--span={span}
                  style:--solid="{solid * 100}%"
                  data-calendar-event
                  data-note-path={s.key}
                  data-row={r}
                  data-start-col={s.startCol}
                  data-end-col={s.endCol}
                  data-slot={s.slot}
                  aria-label={ev.label}
                  aria-describedby={cardKey === s.key ? cardId : undefined}
                  onclick={(e) => { e.stopPropagation(); onOpenNote(s.key); }}
                  onpointerenter={(e) => hoverIn(ev, e.currentTarget)}
                  onpointerleave={() => hover.pointerLeave(s.key)}
                >
                  {#if s.uncertainFromCol !== null}<span class="cal-hatch" aria-hidden="true"></span>{/if}
                  {#if s.continuesBefore}<span class="cal-mark" aria-hidden="true">‹</span>{/if}
                  {#if time && !s.continuesBefore}<span class="cal-time">{time}</span>{/if}
                  <span class="cal-ev-title">{ev.title}</span>
                  {#if s.continuesAfter}<span class="cal-mark cal-mark-after" aria-hidden="true">›</span>{/if}
                </button>
              {/each}
              {#if (view?.more[c] ?? 0) > 0}
                <button
                  type="button"
                  class="cal-more"
                  tabindex="-1"
                  style:top="{DAY_PX + (capacityOf(r) - 1) * SLOT_PX}px"
                  aria-label="{view!.more[c]} more on {dayName(day.start, locale)}"
                  onclick={(e) => { e.stopPropagation(); openList(day.start); }}
                >+{view!.more[c]} more</button>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
    {/if}

    <CalendarBands
      bands={[{ id: 'year', head: `${yearName(page.year, locale)} · no month`, entries: bands.year }, { id: 'month', head: `${title} · no day`, entries: bands.month }]}
      {hover} {cardId} {cardKey} {exportMode} {onOpenNote}
    />
  </div>

  {#if model.undated.length > 0}
    <section class="cal-undated" aria-labelledby="{uid}-undated">
      <h3 id="{uid}-undated" class="cal-undated-head">Undated <span class="cal-undated-count">{model.undated.length}</span></h3>
      <ul class="cal-undated-list">
        {#each model.undated as u (u.key)}
          <li>
            <button type="button" class="cal-undated-row" data-note-path={u.key} data-undated-reason={u.reason} onclick={() => onOpenNote(u.key)}>
              <span class="cal-undated-title">{u.title}</span>
              <span class="cal-undated-reason">{u.reasonText}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if listDay !== null && listAnchor}
    <CalendarDayList
      label={dayName(listDay, locale)}
      events={dayEvents(model.grid, listDay)}
      anchor={listAnchor}
      timeOf={fmtTime}
      {hover}
      {cardId}
      {cardKey}
      onOpen={(key) => { closeList(false); onOpenNote(key); }}
      onClose={closeList}
      menu={interactive ? { refusal: move.refusalOf, onMoveToDate: move.start } : null}
    />
  {/if}

  {#if !exportMode}
    <NoteHoverPreview
      id={cardId}
      {hover}
      instance={cardEvent ? { type, properties, inst: cardEvent.inst, display, rowType: rowType(cardEvent.inst), omit: [dates.dateProperty, ...(dates.endProperty ? [dates.endProperty] : [])] } : null}
      extra={cardEvent ? cardLines : undefined}
    />
  {/if}
</div>

{#snippet cardLines()}
  {#if cardEvent}
    <!-- The dates head the preview, so the Date by property (and Event's `end`) aren't repeated as fields. -->
    <span class="cal-card-date">{cardEvent.dateText}{#if cardEvent.approx}<span class="cal-card-approx"> · approximate</span>{/if}</span>
    {#if cardWritten}<span class="cal-card-written" data-written-as>{cardWritten}</span>{/if}
    {#if cardEvent.endNote}<span class="cal-card-flag" data-end-issue>⚠ {cardEvent.endNote}</span>{/if}
  {/if}
{/snippet}

<style>
  .cal { flex: 1; min-height: 0; display: flex; flex-direction: column; font-family: var(--font-sans); }
  .cal-toolbar { display: flex; align-items: center; gap: 12px; padding: 8px 12px 6px; flex-shrink: 0; }
  .cal-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); min-width: 9em; }
  .cal-nav { display: flex; gap: 4px; }
  .cal-btn {
    min-width: 26px;
    padding: 2px 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .cal-btn:hover { border-color: var(--accent); }

  /* The grid scrolls below its 64px row floor; the bands sit above it (order), after it in tab order. */
  .cal-main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .cal-grid {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .cal-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .cal-wk-on .cal-row { grid-template-columns: 2.6em repeat(7, minmax(0, 1fr)); }
  .cal-head { flex-shrink: 0; border-bottom: 1px solid var(--border); }
  .cal-colhead, .cal-wk-head { padding: 4px 6px; font-size: 11px; font-weight: 600; color: var(--text-muted); text-align: left; }
  /* Rows share the height; 22px number + 2 slots + padding is the floor. */
  .cal-week { flex: 1 1 0; min-height: 66px; border-bottom: 1px solid var(--border); }
  .cal-wk {
    padding: 4px 4px 0;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    border-right: 1px solid var(--border);
  }
  .cal-day {
    position: relative;
    min-width: 0;
    padding: 2px 4px;
    border-right: 1px solid var(--border);
    box-sizing: border-box;
    outline: none;
  }
  .cal-day:last-child { border-right: none; }
  .cal-day:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
  .cal-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 3px;
    border-radius: 999px;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  /* Days of the neighbouring months: dimmed, still focusable. */
  .cal-out { background: color-mix(in oklch, var(--text) 4%, var(--bg)); }
  .cal-out .cal-num { color: var(--text-muted); }
  /* Today: a ring and a bold number — never colour alone. */
  .cal-today .cal-num { font-weight: 700; box-shadow: 0 0 0 2px var(--text); }

  /* An event: one 18px line. A bar spans its columns from the cell it starts in
     (cells are positioned without z-index, so it paints over the next cells). */
  .cal-ev {
    position: absolute;
    z-index: 1;
    left: 2px;
    width: calc(var(--span) * 100% + (var(--span) - 1) * 1px - 4px);
    height: 18px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 5px;
    overflow: hidden;
    border: 1px solid transparent;
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    font-size: 11.5px;
    line-height: 16px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .cal-ev:hover { border-color: var(--accent); }
  .cal-bar { border-color: var(--accent); }
  .cal-cont-before { border-left-width: 1px; border-top-left-radius: 0; border-bottom-left-radius: 0; left: 0; width: calc(var(--span) * 100% + (var(--span) - 1) * 1px - 2px); }
  .cal-cont-after { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .cal-cont-before.cal-cont-after { width: calc(var(--span) * 100% + (var(--span) - 1) * 1px); }
  /* An end coarser than the start: from there on, hatched with a dashed edge (the Timeline's approximate style). */
  .cal-hatch {
    position: absolute;
    top: -1px;
    bottom: -1px;
    left: var(--solid);
    right: -1px;
    border: 1px dashed var(--accent);
    background: repeating-linear-gradient(45deg, color-mix(in oklch, var(--accent) 45%, var(--bg-button)) 0 2px, var(--bg-button) 2px 5px);
    pointer-events: none;
  }
  .cal-approx { border-right-style: dashed; }
  .cal-time, .cal-ev-title, .cal-mark { position: relative; }
  .cal-ev-title { overflow: hidden; text-overflow: ellipsis; background: var(--bg-button); padding: 0 2px; border-radius: 2px; }
  .cal-time { font-variant-numeric: tabular-nums; font-weight: 600; background: var(--bg-button); padding: 0 2px; border-radius: 2px; }
  .cal-mark { font-weight: 700; background: var(--bg-button); padding: 0 1px; border-radius: 2px; }
  .cal-mark-after { margin-left: auto; padding-left: 2px; background: var(--bg-button); }
  /* Reschedule (#2703): the drop preview, the event being dragged or moved, and "choose a day". */
  .cal-ev:not(.cal-fixed) { cursor: grab; }
  .cal-day:global([data-drop-target]) { background: color-mix(in oklch, var(--accent) 16%, var(--bg)); box-shadow: inset 0 0 0 1px var(--accent); }
  .cal-ev:global([data-dragging]) { opacity: 0.45; }
  .cal-ev[data-moving] { outline: 2px dashed var(--accent); outline-offset: 1px; }
  .cal-choosing .cal-ev, .cal-choosing .cal-more { pointer-events: none; }
  .cal-choosing .cal-day { cursor: pointer; }
  .cal-choosing .cal-day:focus { box-shadow: inset 0 0 0 2px var(--accent); }
  .cal-more {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 18px;
    padding: 0 5px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .cal-more:hover { background: color-mix(in oklch, var(--text) 10%, transparent); }

  .cal-card-approx { font-style: italic; }
  .cal-card-flag { color: var(--text); font-weight: 600; }

  .cal-undated { flex-shrink: 0; max-height: 25%; overflow-y: auto; border-top: 1px solid var(--border); padding: 6px 6px 8px; }
  .cal-undated-head { margin: 2px 10px 4px; font-size: 12px; font-weight: 600; color: var(--text); font-family: var(--font-sans); }
  .cal-undated-count { font-family: var(--font-mono); font-weight: 400; color: var(--text-muted); }
  .cal-undated-list { list-style: none; margin: 0; padding: 0; }
  .cal-undated-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }
  .cal-undated-row:hover { background: color-mix(in oklch, var(--text) 5%, transparent); }
  .cal-undated-title { font-size: 13px; font-weight: 500; }
  .cal-undated-reason { font-size: 11.5px; color: var(--text-muted); }

  /* Export (#2704): nothing scrolls on a page; the grid is `CalendarExportGrid`'s. */
  .cal-export .cal-undated { max-height: none; overflow: visible; }
  .cal-export .cal-undated-row { cursor: default; }
</style>
