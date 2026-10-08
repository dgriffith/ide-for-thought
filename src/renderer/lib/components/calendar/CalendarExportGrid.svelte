<script lang="ts">
  /**
   * An exported Calendar month (#2704, epic #2699): the grid `TypeViewCalendar`
   * draws in export mode, in place of its interactive one. The toolbar's
   * title, the bands and the Undated tray around it are the live view's own.
   *
   * - **Every event is in its day's cell** (decision 9; `calendar-export.ts`
   *   says how bars and single days share a cell). Rows are as tall as their
   *   busiest day and never split across a printed page.
   * - **Static.** No tab stops, roles that promise keys (`table`, not
   *   `grid`), hover or popover; today isn't ringed, because a printed or
   *   published page outlives the day it was made on.
   * - **Links.** Every event carries `data-note-path`, which the export
   *   snapshot turns into a link under the export's link policy (plain text
   *   under `inline-title`).
   * - **A legend** says what the hatch means when anything hatched is drawn:
   *   print has no hover card to say it.
   * - **A fallback.** When the grid can't be planned, the month's events are
   *   listed instead, in time order — never the raw spec.
   */
  import type { CalendarMonth, PlacedSegment, Weekday } from '../../../../shared/objects/calendar-grid';
  import { monthBounds, rangeMeets, rowWeekNumber, formatMonthAnchor } from '../../../../shared/objects/calendar-grid';
  import { logger } from '../../../../shared/logger';
  import type { TimelineEvent } from '../timeline/timeline-events';
  import { dayName, monthTitle, timeOf, weekdayNames } from './calendar-model';
  import { planCalendarExport, singleIsApprox, type CalendarExportPlan } from './calendar-export';

  interface Props {
    /** The model's day and clock starts (`CalendarModel.grid`). */
    grid: TimelineEvent[];
    page: CalendarMonth;
    weekStart: Weekday;
    weekNumbers: boolean;
    locale?: string | undefined;
  }
  let { grid, page, weekStart, weekNumbers, locale }: Props = $props();

  /** Line metrics, px — the live grid's: the day number and one bar slot. */
  const DAY_PX = 22;
  const SLOT_PX = 20;

  const plan = $derived.by<{ ok: true; plan: CalendarExportPlan } | { ok: false }>(() => {
    try {
      return { ok: true, plan: planCalendarExport(grid, page, weekStart) };
    } catch (err) {
      logger('objects').warn('calendar export: the grid failed, listing the month instead', err);
      return { ok: false };
    }
  });
  const title = $derived(monthTitle(page, locale));
  const byKey = $derived(new Map(grid.map((ev) => [ev.key, ev] as const)));
  const columns = $derived(plan.ok ? plan.plan.weeks[0]!.days.map((d) => weekdayNames(d.weekday, locale)) : []);
  /** The fallback's list: grid events meeting the month, in time order. */
  const fallback = $derived.by<TimelineEvent[]>(() => {
    if (plan.ok) return [];
    const { start, end } = monthBounds(page);
    return grid.filter((ev) => rangeMeets(ev, start, end)).sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  });

  const startingAt = (bars: PlacedSegment[], c: number) => bars.filter((s) => s.startCol === c);
  const countText = (n: number) => (n === 0 ? 'no events' : n === 1 ? '1 event' : `${n} events`);
</script>

{#if plan.ok}
  {@const p = plan.plan}
  <div class="calx" class:calx-wk-on={weekNumbers} role="table" aria-label={title} data-month={formatMonthAnchor(page)} data-week-start={weekStart}>
    <div class="calx-row calx-head" role="row">
      {#if weekNumbers}<div class="calx-wk" role="columnheader"><span class="visually-hidden">Week</span><span aria-hidden="true">Wk</span></div>{/if}
      {#each columns as col, c (c)}
        <div class="calx-colhead" role="columnheader"><span class="visually-hidden">{col.long}</span><span aria-hidden="true">{col.short}</span></div>
      {/each}
    </div>
    {#each p.rows as row (row.week.start)}
      <div class="calx-row calx-week" role="row" style:--bar-slots={row.barSlots}>
        {#if weekNumbers}<div class="calx-wk" role="rowheader">{rowWeekNumber(row.week).week}</div>{/if}
        {#each row.week.days as day, c (day.start)}
          <div class="calx-day" class:calx-out={!day.inMonth} role="cell" data-day={day.start}>
            <span class="calx-num"><span class="visually-hidden">{dayName(day.start, locale)}, {countText(row.counts[c] ?? 0)}</span><span aria-hidden="true">{day.day}</span></span>
            {#each startingAt(row.bars, c) as s (s.key)}
              {@const ev = byKey.get(s.key)!}
              {@const span = s.endCol - s.startCol}
              {@const time = s.continuesBefore ? null : timeOf(ev, locale)}
              <span
                class="calx-bar"
                class:calx-cont-before={s.continuesBefore}
                class:calx-cont-after={s.continuesAfter}
                class:calx-approx={s.uncertainFromCol !== null}
                style:top="{DAY_PX + s.slot * SLOT_PX}px"
                style:--span={span}
                style:--solid="{s.uncertainFromCol === null ? 100 : ((s.uncertainFromCol - s.startCol) / span) * 100}%"
                data-calendar-event
                data-note-path={s.key}
              >
                {#if s.uncertainFromCol !== null}<span class="calx-hatch" aria-hidden="true"></span>{/if}
                {#if s.continuesBefore}<span class="calx-mark" aria-hidden="true">‹</span>{/if}
                {#if time}<span class="calx-time">{time}</span>{/if}
                <span class="calx-title">{ev.title}</span>
                {#if s.continuesAfter}<span class="calx-mark calx-mark-after" aria-hidden="true">›</span>{/if}
              </span>
            {/each}
            {#if (row.singles[c]?.length ?? 0) > 0}
              <ul class="calx-list">
                {#each row.singles[c]! as ev (ev.key)}
                  {@const time = timeOf(ev, locale)}
                  <li><span class="calx-ev" class:calx-approx={singleIsApprox(ev)} data-calendar-event data-note-path={ev.key}>{#if time}<span class="calx-time">{time}</span>{' '}{/if}<span class="calx-title">{ev.title}</span></span></li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
  {#if p.hatched}
    <p class="calx-note calx-legend"><span class="calx-swatch" aria-hidden="true"></span>Hatched, dashed edge: approximate — the end is known only to the month or year.</p>
  {/if}
{:else}
  <p class="calx-note calx-fallback">The calendar couldn't be drawn, so this month's events are listed below.</p>
  {#if fallback.length > 0}
    <ol class="calx-fallback-list">
      {#each fallback as ev (ev.key)}
        <li><span class="calx-fallback-title" data-note-path={ev.key}>{ev.title}</span> <span class="calx-fallback-date">{ev.dateText}{ev.approx ? ' (approximate)' : ''}</span></li>
      {/each}
    </ol>
  {/if}
{/if}

<style>
  /* Borders are longhands: a snapshot reads rules back through the CSSOM, which
     serialises a `border` shorthand holding var() as empty longhands. */
  .calx { border-top: 1px solid var(--border); background: var(--bg); font-family: var(--font-sans); }
  .calx-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .calx-wk-on .calx-row { grid-template-columns: 2.6em repeat(7, minmax(0, 1fr)); }
  .calx-head { border-bottom: 1px solid var(--border); }
  .calx-colhead, .calx-head .calx-wk { padding: 4px 6px; font-size: 11px; font-weight: 600; color: var(--text-muted); text-align: left; }
  /* A row is as tall as its busiest day, and never split across a printed page. */
  .calx-week { min-height: 66px; border-bottom: 1px solid var(--border); break-inside: avoid; page-break-inside: avoid; }
  .calx-week .calx-wk { padding: 4px 4px 0; font-size: 10.5px; font-variant-numeric: tabular-nums; color: var(--text-muted); border-right: 1px solid var(--border); }
  .calx-day {
    position: relative;
    min-width: 0;
    /* The row's bars sit above the day's single-day list. */
    padding: calc(22px + var(--bar-slots, 0) * 20px) 4px 4px;
    border-right: 1px solid var(--border);
    box-sizing: border-box;
  }
  .calx-day:last-child { border-right: none; }
  .calx-num {
    position: absolute;
    top: 2px;
    left: 4px;
    min-width: 18px;
    height: 18px;
    font-size: 11.5px;
    line-height: 18px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .calx-out { background: color-mix(in oklch, var(--text) 4%, var(--bg)); }
  .calx-out .calx-num { color: var(--text-muted); }

  /* A bar: one 18px line across its columns, from the cell it starts in. */
  .calx-bar {
    position: absolute;
    z-index: 1;
    left: 2px;
    width: calc(var(--span) * 100% + (var(--span) - 1) * 1px - 4px);
    height: 18px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 5px;
    overflow: hidden;
    border-width: 1px 1px 1px 3px;
    border-style: solid;
    border-color: var(--accent);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
  }
  .calx-cont-before { left: 0; border-left-width: 1px; border-top-left-radius: 0; border-bottom-left-radius: 0; width: calc(var(--span) * 100% + (var(--span) - 1) * 1px - 2px); }
  .calx-cont-after { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .calx-cont-before.calx-cont-after { width: calc(var(--span) * 100% + (var(--span) - 1) * 1px); }
  .calx-bar .calx-title { overflow: hidden; text-overflow: ellipsis; }
  .calx-bar .calx-title, .calx-bar .calx-time, .calx-mark { position: relative; background: var(--bg-button); padding: 0 2px; border-radius: 2px; }
  .calx-mark { font-weight: 700; }
  .calx-mark-after { margin-left: auto; }
  /* The approximate style (the live grid's and the Timeline's): hatched, dashed edge. */
  .calx-hatch, .calx-swatch {
    background: repeating-linear-gradient(45deg, color-mix(in oklch, var(--accent) 45%, var(--bg-button)) 0 2px, var(--bg-button) 2px 5px);
    border-width: 1px;
    border-style: dashed;
    border-color: var(--accent);
  }
  .calx-hatch { position: absolute; top: -1px; bottom: -1px; left: var(--solid); right: -1px; }
  .calx-bar.calx-approx { border-right-style: dashed; }

  /* A single day's events: one per line, wrapping, so a long title prints whole. */
  .calx-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .calx-ev {
    display: block;
    padding: 1px 4px;
    border-width: 0 0 0 3px;
    border-style: solid;
    border-color: var(--accent);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    line-height: 14px;
    overflow-wrap: anywhere;
  }
  .calx-ev.calx-approx {
    border-width: 1px 1px 1px 3px;
    border-style: dashed dashed dashed solid;
    background: repeating-linear-gradient(45deg, color-mix(in oklch, var(--accent) 45%, var(--bg-button)) 0 2px, var(--bg-button) 2px 5px);
  }
  .calx-ev.calx-approx .calx-title, .calx-ev.calx-approx .calx-time { background: var(--bg-button); }
  .calx-time { font-variant-numeric: tabular-nums; font-weight: 600; }

  .calx-note { margin: 6px 12px 0; font-size: 11.5px; color: var(--text-muted); line-height: 1.4; }
  .calx-legend { display: flex; align-items: center; gap: 8px; }
  .calx-swatch { display: inline-block; width: 24px; height: 10px; flex-shrink: 0; }
  .calx-fallback-list { margin: 6px 12px; padding-left: 1.4em; font-size: 12.5px; color: var(--text); }
  .calx-fallback-date { color: var(--text-muted); font-size: 11.5px; }
</style>
