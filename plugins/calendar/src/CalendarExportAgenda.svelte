<script lang="ts">
  /**
   * An exported Calendar week or day (#2955, epic #2949): an agenda, in
   * place of the live hour grid (the decision is `calendar-export.ts`'s).
   * Each day is headed with its name and lists its events, all-day first,
   * then by time on that day; a day with none says so, so the week's shape
   * survives on paper. The toolbar's title, the bands and the Undated tray
   * around it are the live view's own, as for the month.
   *
   * Static, like the month export: no tab stops, no hover, today not marked.
   * Every event carries `data-note-path`, which the export snapshot turns
   * into a link under the export's link policy.
   */
  import type { GridWeek } from '../../../src/shared/objects/calendar-grid';
  import type { TimelineEvent } from '../../../src/shared/timeline/timeline-events';
  import { dayName } from '../../../src/shared/calendar/calendar-model';
  import { planAgendaExport, type AgendaEntry } from './calendar-export';
  import { clockLabel, clockRange } from './week-nav';

  interface Props {
    /** The model's day and clock starts (`CalendarModel.grid`). */
    grid: TimelineEvent[];
    page: GridWeek;
    locale?: string | undefined;
  }
  let { grid, page, locale }: Props = $props();

  const plan = $derived(planAgendaExport(grid, page));

  /** What an entry says of its time on this day. */
  function timeText(e: AgendaEntry): string {
    if (e.fromMin === null) return e.continuesBefore || e.continuesAfter ? 'All day, continued' : 'All day';
    const from = clockLabel(e.fromMin, locale);
    if (e.continuesBefore && e.continuesAfter) return 'All day, continued';
    if (e.continuesBefore) return `until ${clockLabel(e.toMin!, locale)}`;
    if (e.continuesAfter) return `from ${from}`;
    return e.endKnown ? clockRange(e.fromMin, e.toMin!, locale) : from;
  }
</script>

<div class="cala" data-week-start={page.start}>
  {#each plan.days as d (d.day)}
    {@const entries = [...d.allDay, ...d.timed]}
    <section class="cala-day" aria-label={dayName(d.day, locale)}>
      <h3 class="cala-head">{dayName(d.day, locale)}</h3>
      {#if entries.length === 0}
        <p class="cala-none">No events.</p>
      {:else}
        <ul class="cala-list">
          {#each entries as e, i (`${e.ev.key}-${i}`)}
            <li class="cala-entry">
              <span class="cala-time">{timeText(e)}</span>
              <span><span class="cala-title" data-calendar-event data-note-path={e.ev.key}>{e.ev.title}</span>{#if e.ev.approx}<span class="cala-approx"> (approximate)</span>{/if}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</div>

<style>
  .cala { display: flex; flex-direction: column; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--border); background: var(--bg); color: var(--text); }
  /* A day is never split across a printed page. */
  .cala-day { break-inside: avoid; page-break-inside: avoid; }
  .cala-head { margin: 0 0 4px; padding-bottom: 2px; border-bottom: 1px solid var(--border); font-size: 12.5px; font-weight: 600; }
  .cala-none { margin: 2px 0; font-size: 11.5px; color: var(--text-muted); }
  .cala-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .cala-entry { display: grid; grid-template-columns: 9em minmax(0, 1fr); /* inline-styles.ts writes the same into an export */ gap: 0 10px; font-size: 12px; line-height: 1.4; }
  .cala-time { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  .cala-title { overflow-wrap: anywhere; }
  .cala-approx { color: var(--text-muted); }
</style>
