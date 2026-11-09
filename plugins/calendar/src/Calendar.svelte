<script lang="ts">
  /**
   * The Calendar layout of a type view (#2702, epic #2699): a month grid of the
   * notes of any type with a date property, placed by the view's *Date by*
   * (`dateBy`; `date` by default). Since #2829 it is the built-in Calendar
   * plugin, in a plugin frame: Minerva scopes and filters the instances and
   * sends them as the `view`; this draws them, writes back its page
   * (`view.setState`) and asks Minerva to reschedule. The design is the Calendar story's
   * (`docs/vision/objects-expansion.md`, "Calendar", and the nine decisions
   * confirmed on #2699); the grid maths is `shared/objects/calendar-grid.ts`.
   *
   * - **The page** is `month` (`"2026-10"`), absent meaning this month.
   *   Previous / Today / Next write it back through `view.setState` (Today
   *   writes null, the current month). A page shows 4–6 rows (`monthWeeks`),
   *   from the per-machine week start Minerva sends as `view.week` (the
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
   *   grid but after it in tab order. Undated notes are in the Undated tray,
   *   whose heading hides and shows its list (the count stays) for the life
   *   of the frame, as the Timeline's; an export always lists it.
   * - **Keyboard**, the WAI-ARIA date grid: `role="grid"` with one tab stop
   *   (a roving tabindex on the focused day). ←/→ a day, ↑/↓ a week, turning
   *   the page past the grid's edge; Page Up/Down a month and Shift+Page
   *   Up/Down a year, clamped (`addMonthsClamped`); Home/End the row's ends;
   *   Enter (or Space) the day's list. Today is `aria-current="date"` with a
   *   ring and a bold number, not colour alone.
   * - **Hover preview** (#2713): the app's own preview (`ui.previewNote`,
   *   through `hover.svelte.ts`) on hover over an event and on keyboard focus
   *   in the day list, with the dates as extra lines and the type's card
   *   fields; its text comes back as a `preview` event to describe the item.
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
   *   from Minerva's note menu, *Move to date…* (the `moveToDate` event,
   *   #2929), which puts the grid in "choose a day" mode (`CalendarMoveBar`: Enter or a
   *   click on a day moves it there, a typed date works too, Escape cancels).
   *   The write is Minerva's, asked for with `view.reschedule` (its
   *   `rescheduleEvent`: start and end in one save, `date-shift.ts`'s rule,
   *   and Local History says the Calendar did it); ⌘Z here (`view.undoMove`)
   *   undoes the calendar's last move. An event whose start or end is only a
   *   month or year doesn't move: a drag or the menu says why.
   * - **Week** (#2951, `mode: "week"`, anchored on `date`, absent meaning
   *   today): the Month | Week switch writes `mode`, keeping the page and
   *   whether it follows today (`week-nav.ts`); ‹ Today › step a week and
   *   write `date`. `CalendarWeek` draws the week as an all-day strip over
   *   24 hours (`time-grid.ts`), with the bands and the Undated tray for the
   *   week. Events don't drag there yet (#2953); *Move to date…* chooses one
   *   of its days. An export lists the week as an agenda (#2955,
   *   `CalendarExportAgenda`: each day's events, all-day first, then by time),
   *   with the week's bands and the Undated tray after it; a Day, its day.
   * - **Day** (#2952, `mode: "day"`, on the same `date`): the week's grid
   *   with one column, each event showing its first card field as a second
   *   line; ‹ Today › step a day, and ←/→ past the column go to the next day.
   *   Week ↔ Day keeps `date`. Double-clicking a day's number, or Alt+Enter
   *   on a day, in Month or Week opens that day. At wide widths the day's
   *   events are listed beside the grid too (`CalendarAgenda`).
   * - **By time** (#2953, Week and Day): a timed event drags to another time
   *   or day, and its bottom edge to another end, snapping to 15 minutes;
   *   Alt+↑/↓ and Alt+Shift+↑/↓ do the same from the keyboard. Minerva
   *   writes (`view.retime` / `view.resize`), with undo; an event dated to a
   *   day only, or under a Date by with no end (for a resize), says why.
   * - **Creating** (#2954, Week and Day): drag across empty hours or the
   *   all-day strip, or Enter on an empty cell, asks Minerva for a new note
   *   of the view's type over that stretch (`view.createEvent`); Minerva asks
   *   for its title (and subtype) and creates it.
   * - **The note menu** (#2929; where the view has one, `view.rowMenu`, never
   *   in an export): a right-click on any event — in the grid, a band, the
   *   Undated tray or a day's list — or the menu key on a focused one, asks
   *   for Minerva's own note menu (`ui.showNoteMenu`): its tags and
   *   properties, and *Move to date…* where the calendar can move notes.
   */
  import { tick, untrack } from 'svelte';
  import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';
  import type { PropertyDef } from '../../../src/shared/objects/type-def';
  import {
    addDays, addMonths, addMonthsClamped, coveredDays, dayStart, formatDayAnchor, formatMonthAnchor, layoutMonth, monthOf, monthWeeks, overflowRow,
    parseDayAnchor, parseMonthAnchor, rowWeekNumber, timePage, weekEdge, type CalendarMonth, type PlacedSegment, type Weekday,
  } from '../../../src/shared/objects/calendar-grid';
  import { parseCalendarMode, type CalendarMode } from '../../../src/shared/objects/calendar';
  import { drawnRange, layoutTimeGrid, MIN_TIMED_MINUTES } from '../../../src/shared/calendar/time-grid';
  import { timeRefusalFor } from '../../../src/shared/calendar/reschedule-refusal';
  import { eventValue } from '../../../src/shared/calendar/create-event';
  import { DAY_MS } from '../../../src/shared/time';
  import CalendarWeek from './CalendarWeek.svelte';
  import type { TimeMoves } from './time-drag';
  import { clockLabel, monthFromWeek, stepPage, weekFromMonth, weekTitle } from './week-nav';
  import CalendarAgenda from './CalendarAgenda.svelte';
  import { civilMs } from '../../../src/shared/objects/date-precision';
  import CalendarDayList from './CalendarDayList.svelte';
  import CalendarBands from './CalendarBands.svelte';
  import CalendarExportGrid from './CalendarExportGrid.svelte';
  import CalendarExportAgenda from './CalendarExportAgenda.svelte';
  import { createPluginHover } from './hover.svelte';
  import { timelineProperties, type TimelineEvent } from '../../../src/shared/timeline/timeline-events';
  import { buildCalendarModel, dayEvents, dayName, monthTitle, pageBands, pageItems, rangeBands, timeOf, weekdayNames, writtenAs, yearName } from '../../../src/shared/calendar/calendar-model';
  import { eventDrag } from './event-drag';
  import { isMenuKey, openMenuAt } from './drag-keys';
  import CalendarMoveBar from './CalendarMoveBar.svelte';
  import { createReschedule } from './reschedule-controller.svelte';
  import { createCalendarSelection, provideSelection } from './selection.svelte';

  interface Props {
    minerva: MinervaPlugin;
    view: PluginViewState;
    /** Formatting locale; the viewer's when absent. */
    locale?: string;
  }
  let { minerva, view, locale }: Props = $props();
  // The connection is made once, before mount (`main.ts`), and never replaced,
  // so the hover and reschedule controllers rightly take it once.
  const connection = untrack(() => minerva);

  /** A call whose failure the user can't act on (the frame closing, say). */
  const quietly = (p: Promise<unknown>) => { p.catch(() => {}); };
  const announce = (text: string) => quietly(minerva.ui.announce({ text }));
  // The type's properties as Minerva declares them: the date helpers read a
  // property's name and type, which the view's carry.
  const properties = $derived(view.properties as unknown as PropertyDef[]);
  // The app's rows and the view's instances are both what the model reads (path, title, values).
  const instances = $derived(view.instances as unknown as Parameters<typeof buildCalendarModel>[0]);
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const month = $derived(str(view.spec['month']));
  const dateBy = $derived(str(view.spec['dateBy']));
  const readOnly = $derived(view.readOnly);
  const exportMode = $derived(view.exportMode);
  // The view's own selection (#2938), for every part of the calendar to read.
  const selection = createCalendarSelection(minerva, () => view);
  provideSelection(selection);
  /** A click on an event: with its modifiers where the view selects (⌘ toggles, ⇧ extends); a plain one opens it. */
  const onOpenNote = (path: string, e?: MouseEvent) => selection.click(path, e);
  const selectsWith = (e?: MouseEvent) => selection.selectable && !!e && (e.metaKey || e.ctrlKey || e.shiftKey);
  /** A drag or *Move to date…* on a selected event moves the selection (#2938). */
  const groupFor = (key: string): string[] | undefined => (selection.selectable && selection.has(key) && selection.paths.length > 1 ? [...selection.paths] : undefined);
  const onStateChange = (patch: Record<string, string | null>) => quietly(minerva.view.setState({ patch }));

  const uid = $props.id();
  const interactive = $derived(!readOnly && !exportMode);
  const firstDay = $derived<Weekday>(view.week.start);
  const weekNumbers = $derived(view.week.numbers);

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
  // `month` by value: it comes out of a spec object every refresh rebuilds, so
  // read directly, each graph change looked like a new month (page reset, day
  // list closed). A month that does arrive (our write echoing back, a restored
  // tab, Back) is the page from then on.
  const monthProp = $derived(month);
  $effect(() => { void monthProp; untrack(() => { override = null; }); });
  // ── Week and Day (#2951, #2952): `mode` and `date`, read by value as `month` is ──
  const modeProp = $derived(parseCalendarMode(view.spec['mode']));
  const dateProp = $derived(str(view.spec['date']));
  /** A mode or page chosen here, ahead of (or, read-only, instead of) the spec's. */
  let modeOverride = $state<CalendarMode | null>(null);
  /** `follows`: chosen as "today" (Today, or a switch from a month following today). */
  let dayOverride = $state<{ day: number; follows: boolean } | null>(null);
  $effect(() => { void modeProp; untrack(() => { modeOverride = null; }); });
  $effect(() => { void dateProp; untrack(() => { dayOverride = null; }); });
  const mode = $derived<CalendarMode>(modeOverride ?? modeProp ?? 'month');
  /** The week or day page's day: the one chosen here, else `date`, else today. */
  const anchor = $derived(dayOverride?.day ?? parseDayAnchor(dateProp) ?? today);
  const weekFollowsToday = $derived(dayOverride ? dayOverride.follows : parseDayAnchor(dateProp) === null);
  const weekPage = $derived(timePage(anchor, mode === 'day' ? 'day' : 'week', view.week.start));

  // In Week and Day the month grid's page is the anchor's month (where a switch back to Month opens).
  const page = $derived<CalendarMonth>(mode !== 'month' ? monthOf(anchor) : override ?? parseMonthAnchor(monthProp) ?? monthOf(today));
  const pageKey = (m: CalendarMonth) => m.year * 12 + m.month;
  const pageNumber = $derived(pageKey(page)); // a turn, not a re-derived object
  const weekStart = $derived(weekPage.start); // likewise: a refresh rebuilds `weekPage`, not its start

  function goTo(m: CalendarMonth, opts: { current?: boolean } = {}): void {
    override = m;
    if (interactive) onStateChange({ month: opts.current ? null : formatMonthAnchor(m) });
  }

  /** Show the week or day holding `day`; `current` writes `date` unset (follow today). */
  function goToWeek(day: number, opts: { current?: boolean } = {}): void {
    dayOverride = { day, follows: opts.current === true };
    if (interactive) onStateChange({ date: opts.current ? null : formatDayAnchor(day) });
  }

  /** The Month | Week | Day switch: keeps the page, and whether it follows today (`week-nav.ts`). */
  function switchMode(to: CalendarMode): void {
    if (to === mode) return;
    if (to !== 'month' && mode !== 'month') {
      // Week ↔ Day: the same `date`, so the day stays.
      modeOverride = to;
      if (interactive) onStateChange({ mode: to });
    } else if (to !== 'month') {
      const { anchor: day, date } = weekFromMonth({ page, followsToday: override === null && parseMonthAnchor(monthProp) === null, focused: focusedDay, today, weekStart: firstDay, mode: to });
      modeOverride = to;
      dayOverride = { day, follows: date === null };
      if (interactive) onStateChange({ mode: to, date });
    } else {
      const month = monthFromWeek({ anchor, followsToday: weekFollowsToday });
      modeOverride = 'month';
      override = parseMonthAnchor(month) ?? monthOf(today);
      if (interactive) onStateChange({ mode: null, month });
    }
    if (listDay !== null) closeList(false);
  }

  /** Open `day` in Day mode (#2952): a day number double-clicked, or Alt+Enter, in Month or Week. */
  function openDay(day: number): void {
    modeOverride = 'day';
    const follows = day === today && (mode === 'month' ? override === null && parseMonthAnchor(monthProp) === null : weekFollowsToday);
    dayOverride = { day, follows };
    if (interactive) onStateChange({ mode: 'day', date: follows ? null : formatDayAnchor(day) });
    if (listDay !== null) closeList(false);
  }

  const weeks = $derived(monthWeeks(page, firstDay));
  const gridStart = $derived(weeks[0]!.start);
  const gridEnd = $derived(weeks[weeks.length - 1]!.end);
  const rows = $derived(layoutMonth(pageItems(model.grid, weeks), weeks));
  /** Week or Day: its page, title and bands, on screen and in an export (an agenda there, #2955). */
  const timeMode = $derived(mode !== 'month');
  /** …and on screen: the time grid. */
  const weekView = $derived(timeMode && !exportMode);
  const bands = $derived(timeMode ? rangeBands(model, weekPage, locale) : pageBands(model, page, locale));
  const title = $derived(!timeMode ? monthTitle(page, locale)
    : mode === 'day' ? dayName(anchor, locale)
    : weekTitle(weekPage, locale, weekNumbers ? rowWeekNumber(weekPage).week : null));
  const timeGrid = $derived(weekView ? layoutTimeGrid(model.grid, weekPage, { minMinutes: Math.max(MIN_TIMED_MINUTES, 20) }) : null);
  let weekGrid = $state<ReturnType<typeof CalendarWeek>>();
  /** Now, on the civil axis — the week's now-line moves each minute. */
  function nowCivil(): number {
    const d = new Date();
    return civilMs(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
  }
  let now = $state(nowCivil());
  $effect(() => {
    if (!weekView) return;
    const t = setInterval(() => { now = nowCivil(); }, 60_000);
    return () => clearInterval(t);
  });
  /** An event's type colour (#2951): its own type's (a subtype's, in a parent's view), else the view's. */
  function colorOf(key: string): string | null {
    const inst = model.byKey.get(key)?.inst as { icon?: { color?: string } } | undefined;
    return inst?.icon?.color ?? view.type.color ?? null;
  }
  /** An event's second line in Day mode (#2952): its first card field that isn't one of its dates. */
  function detailOf(key: string): string | null {
    const inst = model.byKey.get(key)?.inst as { fields?: Array<{ name: string; label: string; text: string }> } | undefined;
    const f = inst?.fields?.find((x) => x.name !== dates.dateProperty && x.name !== dates.endProperty && x.text !== '');
    return f ? `${f.label}: ${f.text}` : null;
  }
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
  let undatedOpen = $state(true);
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
    // A key acts on the cell it came from: its focus event can arrive after the
    // keydown when the frame's document is only just getting focus (#3025).
    const cellDay = Number((e.target as HTMLElement | null)?.closest<HTMLElement>('[data-day]')?.dataset.day);
    if (Number.isFinite(cellDay) && cellDay !== focusedDay) focusedDay = cellDay;
    if (e.altKey && e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !move.moving) {
      e.preventDefault();
      openDay(tabDay);
      return;
    }
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
  function openList(day: number, anchorEl: HTMLElement | null = null): void {
    const cell = anchorEl ?? grid?.querySelector<HTMLElement>(`[data-day="${day}"]`) ?? null;
    if (!cell) return;
    hover.close();
    focusedDay = day;
    listAnchor = cell;
    listDay = day;
  }
  function closeList(returnFocus: boolean): void {
    const day = listDay;
    const from = listAnchor;
    listDay = null;
    listAnchor = null;
    if (!returnFocus || day === null) return;
    if (weekView) void tick().then(() => from?.focus());
    else void tick().then(() => grid?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus());
  }
  // A page turn closes it — a turn, not a refresh re-deriving the same page.
  $effect(() => { void pageNumber; void weekStart; untrack(() => { if (listDay !== null) closeList(false); }); });

  // ── Hover preview ─────────────────────────────────────────────────────
  // The app's (`hover.svelte.ts`): the dates head it, so the Date by property
  // (and Event's `end`) aren't repeated as fields.
  function cardLines(key: string): string[] {
    const ev = model.byKey.get(key) ?? model.undated.find((u) => u.key === key) ?? null;
    if (!ev || !('dateText' in ev)) return [];
    const written = writtenAs(ev, ev.inst.values[dates.dateProperty]);
    return [`${ev.dateText}${ev.approx ? ' · approximate' : ''}`, ...(written ? [written] : []), ...(ev.endNote ? [`⚠ ${ev.endNote}`] : [])];
  }
  const hover = createPluginHover(connection, {
    enabled: () => !exportMode,
    extra: (key) => cardLines(key),
    omit: () => [dates.dateProperty, ...(dates.endProperty ? [dates.endProperty] : [])],
  });
  $effect(() => () => hover.dispose());
  /** The preview's text, mirrored here: what an item's `aria-describedby` names. */
  const cardId = 'cal-preview-description';
  const cardKey = $derived(exportMode ? null : hover.description?.path ?? null);
  function hoverIn(ev: TimelineEvent, anchor: Element): void {
    if (!exportMode) hover.pointerEnter({ key: ev.key, target: ev.key, anchor, fallbackTitle: ev.title });
  }
  const fmtTime = (ev: TimelineEvent) => timeOf(ev, locale);

  function eventFor(key: string): TimelineEvent {
    return model.byKey.get(key)!;
  }
  // An event's button is named by what it shows (its time and title), so a
  // speech user says what they see (WCAG 2.5.3, #2790); its full date and
  // time are its description, kept out of the day cell's name.
  // Only the events drawn on this page: a description of next month's events
  // would reach an export of this one.
  const drawnKeys = $derived([...new Set(drawn.flatMap((d) => d.visible.map((s) => s.key)))]);
  const eventDescIds = $derived(new Map(drawnKeys.map((k, i) => [k, `${uid}-ev-${i}`])));
  const eventDescId = (key: string) => eventDescIds.get(key) ?? '';
  /** A bar's span in columns, for its width. */
  const spanOf = (s: PlacedSegment) => s.endCol - s.startCol;

  // ── Reschedule (#2703, `calendar/reschedule-controller.svelte.ts`) ───
  const move = createReschedule({
    minerva: connection,
    model: () => model, dates: () => dates, locale: () => locale, interactive: () => interactive,
    focusDay: (day) => { if (weekView) void weekGrid?.focusCell(day); else void focusDay(day, 'other-month'); },
    closeList: () => closeList(false),
  });
  const moveBarId = `${uid}-move`;

  // ── By time (#2953): the Week and Day grids' moves ─────────────────────
  /** "10:15", or "Thu 10:15" when it lands on another day than it starts. */
  function landing(at: number, from: number): string {
    const minuteOfDay = Math.round((at - dayStart(at)) / 60_000);
    const time = clockLabel(minuteOfDay, locale);
    return dayStart(at) === dayStart(from) ? time : `${weekdayNames(new Date(dayStart(at)).getUTCDay() || 7, locale).short} ${time}`;
  }
  const timeMoves = $derived<TimeMoves | null>(interactive && weekView ? {
    refusal: (key, kind) => { const ev = model.byKey.get(key); return ev ? timeRefusalFor(ev, dates, kind) : null; },
    previewText: (key, kind, minutes) => {
      const ev = model.byKey.get(key);
      if (!ev) return null;
      const edge = kind === 'move' ? ev.start : drawnRange(ev).end;
      return landing(edge + minutes * 60_000, ev.start);
    },
    move: (key, minutes) => quietly(connection.view.retime({ path: key, minutes })),
    resize: (key, minutes) => quietly(connection.view.resize({ path: key, minutes })),
    refused: announce,
    // A new event (#2954): the stretch drawn, on the viewer's clock; Minerva asks for its title.
    create: (r) => {
      const req = 'firstDay' in r
        ? { start: eventValue(r.firstDay), end: r.lastDay > r.firstDay ? eventValue(r.lastDay) : null }
        : { start: eventValue(r.day, r.startMin), end: r.endMin >= 1440 ? eventValue(r.day + DAY_MS, 0) : eventValue(r.day, r.endMin) };
      quietly(connection.view.createEvent(req));
    },
  } : null);

  // ── The note menu (#2929): Minerva's, for one event ─────────────────────
  const noteMenu = $derived(view.rowMenu && !exportMode);
  function onNoteMenu(e: MouseEvent, key: string): void {
    if (!noteMenu) return;
    e.preventDefault();
    e.stopPropagation(); // an event in a day cell: not the cell's as well
    hover.close();
    // A selected event's menu is the selection's; any other's, its own (#2938, Kanban's rule).
    menuKey = key;
    quietly(minerva.ui.showNoteMenu({ paths: groupFor(key) ?? [key], x: e.clientX, y: e.clientY }));
  }
  let undatedList = $state<HTMLUListElement>();
  function focusUndated(key: string): void {
    [...(undatedList?.querySelectorAll<HTMLElement>('[data-note-path]') ?? [])].find((r) => r.dataset['notePath'] === key)?.focus();
  }
  /** The event the last menu was opened on: a group's *Move to date…* chooses the day for it. */
  let menuKey: string | null = null;
  /** ⌘A and Escape (#2938): the view's own selection, once nothing else wants Escape. */
  function onRootKeydown(e: KeyboardEvent): void {
    move.onKeydown(e);
    if (e.defaultPrevented || !selection.selectable) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      if ((e.target as HTMLElement | null)?.closest('input, textarea')) return;
      e.preventDefault();
      selection.selectAll();
    } else if (e.key === 'Escape' && !move.moving && listDay === null && selection.paths.length > 0) {
      e.preventDefault(); // not "give focus back" — that's for an Escape with nothing to clear
      selection.clear();
    }
  }
  function onMenuKey(e: KeyboardEvent): void {
    if (!noteMenu || !isMenuKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.currentTarget as HTMLElement);
  }
  // *Move to date…*, chosen in that menu: choose the day here.
  // For a selection (#2938, `paths`): the day is chosen for the event the menu was opened on.
  $effect(() => connection.on('moveToDate', ({ path, paths }) => move.start(menuKey && paths?.includes(menuKey) ? menuKey : path, paths)));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cal" class:cal-export={exportMode} onkeydown={onRootKeydown} onfocusout={move.onFocusout}>
  <div class="cal-toolbar">
    <h2 class="cal-title" id="{uid}-title">{title}</h2>
    {#if !exportMode}
      {#if weekView}
        {@const unit = mode === 'day' ? 'day' : 'week'}
        <div class="cal-nav">
          <button type="button" class="cal-btn" aria-label="Previous {unit}" title="Previous {unit}" onclick={() => goToWeek(stepPage(anchor, unit, -1))}>‹</button>
          <button type="button" class="cal-btn" title="This {unit}" onclick={() => goToWeek(today, { current: true })}>Today</button>
          <button type="button" class="cal-btn" aria-label="Next {unit}" title="Next {unit}" onclick={() => goToWeek(stepPage(anchor, unit, 1))}>›</button>
        </div>
      {:else}
        <div class="cal-nav">
          <button type="button" class="cal-btn" aria-label="Previous month" title="Previous month" onclick={() => goTo(addMonths(page, -1))}>‹</button>
          <button type="button" class="cal-btn" title="This month" onclick={() => goTo(monthOf(today), { current: true })}>Today</button>
          <button type="button" class="cal-btn" aria-label="Next month" title="Next month" onclick={() => goTo(addMonths(page, 1))}>›</button>
        </div>
      {/if}
      <div class="cal-modes" role="group" aria-label="Calendar view">
        {#each [['month', 'Month'], ['week', 'Week'], ['day', 'Day']] as const as [id, label] (id)}
          <button type="button" class="cal-mode" aria-pressed={mode === id} onclick={() => switchMode(id)}>{label}</button>
        {/each}
      </div>
    {/if}
  </div>

  {#if move.moving}
    <CalendarMoveBar
      title={move.moving.title}
      count={move.moving.paths?.length ?? 1}
      id={moveBarId}
      onTyped={move.confirm}
      onInvalid={(t) => announce(`${t.trim() === '' ? 'Nothing typed' : `“${t.trim()}” isn’t a day`}: type a date like 2026-10-12.`)}
      onCancel={() => move.cancel(true)}
    />
  {/if}

  <div class="cal-main">
    {#if exportMode && timeMode}
    <CalendarExportAgenda grid={model.grid} page={weekPage} {locale} />
    {:else if exportMode}
    <CalendarExportGrid grid={model.grid} {page} weekStart={firstDay} {weekNumbers} {locale} />
    {:else if weekView && timeGrid}
    <div class="cal-timerow">
    <CalendarWeek
      bind:this={weekGrid}
      page={weekPage}
      layout={timeGrid}
      {eventFor}
      {colorOf}
      {today}
      {now}
      {locale}
      labelledBy="{uid}-title"
      movingKey={move.moving?.key ?? null}
      {moveBarId}
      {hover}
      {cardId}
      {cardKey}
      onOpen={onOpenNote}
      onMenu={noteMenu ? onNoteMenu : null}
      onDayList={(day, el) => openList(day, el)}
      onChooseDay={(day) => move.confirm(day)}
      onCancelChoose={() => move.cancel(true)}
      onGoToDay={(day) => goToWeek(day)}
      onOpenDay={mode === 'week' ? openDay : null}
      detailOf={mode === 'day' ? detailOf : null}
      {timeMoves}
    />
    {#if mode === 'day'}
      <CalendarAgenda
        label={dayName(anchor, locale)}
        events={dayEvents(model.grid, anchor)}
        timeOf={fmtTime}
        {detailOf}
        {hover}
        {cardId}
        {cardKey}
        onOpen={onOpenNote}
        onMenu={noteMenu ? onNoteMenu : null}
      />
    {/if}
    </div>
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
        onDrop: (key, days) => move.move(key, days, groupFor(key)),
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
              aria-current={isToday ? 'date' : undefined}
              aria-describedby={move.moving && day.start === tabDay ? moveBarId : undefined}
              data-day={day.start}
              onclick={() => { if (move.moving) move.confirm(day.start); else { focusedDay = day.start; } }}
              onfocus={() => (focusedDay = day.start)}
            >
              <!-- Named from its content (WCAG 2.5.3, #2790): the day first, then
                   what the cell shows, so the visible text is in the name. It
                   reads no more than the cell shows: past that, "+N more". -->
              <span class="visually-hidden">{dayName(day.start, locale)}, {n === 0 ? 'no events' : n === 1 ? '1 event' : `${n} events`}{n > 0 ? ':' : ''}</span>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="cal-num" aria-hidden="true" ondblclick={(e) => { e.stopPropagation(); if (!move.moving) openDay(day.start); }}>{day.day}</span>
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
                  class:cal-selected={selection.has(s.key)}
                  aria-pressed={selection.selectable ? selection.has(s.key) : undefined}
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
                  aria-describedby={[eventDescId(s.key), cardKey === s.key ? cardId : null].filter(Boolean).join(' ')}
                  onclick={(e) => { e.stopPropagation(); onOpenNote(s.key, e); }}
                  oncontextmenu={(e) => onNoteMenu(e, s.key)}
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

    <div hidden>
      {#each weekView ? [] : drawnKeys as key (key)}
        <span id={eventDescId(key)}>{eventFor(key).label}</span>
      {/each}
    </div>

    <CalendarBands
      bands={[{ id: 'year', head: `${timeMode ? yearName(monthOf(weekPage.start).year, locale) : yearName(page.year, locale)} · no month`, entries: bands.year }, { id: 'month', head: `${timeMode ? monthTitle(monthOf(weekPage.start), locale) : title} · no day`, entries: bands.month }]}
      {hover} {cardId} {cardKey} {exportMode} {onOpenNote}
      onMenu={noteMenu ? onNoteMenu : null}
    />
  </div>

  {#if model.undated.length > 0}
    <section class="cal-undated" class:cal-undated-closed={!undatedOpen && !exportMode} aria-labelledby="{uid}-undated">
      {#if exportMode}
        <h3 id="{uid}-undated" class="cal-undated-head">Undated <span class="cal-undated-count">{model.undated.length}</span></h3>
      {:else}
        <h3 class="cal-undated-head">
          <button
            type="button"
            id="{uid}-undated"
            class="cal-undated-toggle"
            aria-expanded={undatedOpen}
            aria-controls="{uid}-undated-list"
            title={undatedOpen ? 'Hide the undated notes' : 'Show the undated notes'}
            onclick={() => (undatedOpen = !undatedOpen)}
          ><span class="cal-undated-chevron" aria-hidden="true">{undatedOpen ? '▾' : '▸'}</span> Undated <span class="cal-undated-count">{model.undated.length}</span></button>
        </h3>
      {/if}
      <ul id="{uid}-undated-list" class="cal-undated-list" bind:this={undatedList} hidden={!undatedOpen && !exportMode}>
        {#each model.undated as u (u.key)}
          <li>
            {#if exportMode}
              <!-- An export is static: no button (the sanitizer keeps none); the note path becomes the link. -->
              <div class="cal-undated-row" data-note-path={u.key}>
                <span class="cal-undated-title">{u.title}</span>
                <span class="cal-undated-reason">{u.reasonText}</span>
              </div>
            {:else}
              <button
                type="button"
                class="cal-undated-row"
                class:cal-selected={selection.has(u.key)}
                aria-pressed={selection.selectable ? selection.has(u.key) : undefined}
                data-note-path={u.key}
                data-undated-reason={u.reason}
                aria-haspopup={noteMenu ? 'menu' : undefined}
                onclick={(e) => onOpenNote(u.key, e)}
                oncontextmenu={(e) => onNoteMenu(e, u.key)}
                onkeydown={(e) => { if (!selection.key(e, u.key, model.undated.map((x) => x.key), ['ArrowUp', 'ArrowDown'], focusUndated)) onMenuKey(e); }}
              >
                <span class="cal-undated-title">{u.title}</span>
                <span class="cal-undated-reason">{u.reasonText}</span>
              </button>
            {/if}
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
      onOpen={(key, e) => { if (!selectsWith(e)) closeList(false); onOpenNote(key, e); }}
      onClose={closeList}
      onMenu={noteMenu ? onNoteMenu : null}
    />
  {/if}

  {#if !exportMode}
    <!-- The app's preview is drawn outside this frame, where a description can't point; its text is mirrored here. -->
    <p id={cardId} class="cal-description" hidden>{hover.description?.text ?? ''}</p>
  {/if}
</div>

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
  /* Month | Week | Day (#2951, #2952): pressed is bold and filled, not colour alone. */
  .cal-modes { display: inline-flex; margin-left: auto; border: 1px solid var(--border); border-radius: 5px; overflow: hidden; }
  .cal-mode { padding: 2px 10px; border: none; background: var(--bg-button); color: var(--text); font-family: inherit; font-size: 11.5px; cursor: pointer; }
  .cal-mode + .cal-mode { border-left: 1px solid var(--border); }
  .cal-mode[aria-pressed='true'] { background: color-mix(in oklch, var(--accent) 35%, var(--bg-button)); font-weight: 600; }
  .cal-mode:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  /* The grid scrolls below its 64px row floor; the bands sit above it (order), after it in tab order. */
  .cal-main { flex: 1; min-height: 0; display: flex; flex-direction: column; container-type: inline-size; }
  /* Week and Day: the time grid, and in Day the agenda beside it when there's room (#2952). */
  .cal-timerow { flex: 1; min-height: 0; display: flex; }
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


  .cal-undated { flex-shrink: 0; max-height: 25%; overflow-y: auto; border-top: 1px solid var(--border); padding: 6px 6px 8px; }
  .cal-undated-head { margin: 2px 10px 4px; font-size: 12px; font-weight: 600; color: var(--text); font-family: var(--font-sans); }
  .cal-undated-closed { padding-bottom: 2px; }
  .cal-undated-toggle {
    display: inline-flex; align-items: baseline; gap: 4px;
    padding: 1px 4px; margin-left: -4px; border: none; border-radius: 4px;
    background: none; color: inherit; font: inherit; cursor: pointer;
  }
  .cal-undated-toggle:hover { background: color-mix(in oklch, var(--text) 5%, transparent); }
  .cal-undated-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .cal-undated-chevron { width: 0.8em; color: var(--text-muted); }
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
  /* Selected (#2938): an accent ring on an event, a tint on an Undated row. */
  .cal-ev.cal-selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .cal-undated-row.cal-selected { background: color-mix(in oklch, var(--accent) 16%, transparent); }
  .cal-undated-title { font-size: 13px; font-weight: 500; }
  .cal-undated-reason { font-size: 11.5px; color: var(--text-muted); }

  /* Export (#2704): nothing scrolls on a page; the grid is `CalendarExportGrid`'s. */
  .cal-export .cal-undated { max-height: none; overflow: visible; }
  .cal-export .cal-undated-row { cursor: default; }
</style>
