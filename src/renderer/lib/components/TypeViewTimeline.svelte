<script lang="ts">
  /**
   * The Timeline layout of a type view (#2608, epic #2606): the notes of any
   * type with a date property (#2715) on a horizontal time axis, placed by the
   * view's *Date by* (`dateBy`; Event's `date` by default).
   * `TypeView` scopes and filters the instances; this draws them. The design
   * is the spike's (`docs/vision/objects-expansion.md`, "Timeline").
   *
   * - **Our own SVG.** One `<g>` per event; the axis is `timeline-scale.ts`'s
   *   one-line linear map over civil-axis ms, ticked by `d3-time` and
   *   labelled by `Intl` (`timeline-format.ts`), so `-0043` reads "44 BC".
   * - **Events.** `timeline-events.ts` reads each start / end once per data
   *   revision (`timelineProperties`: the *Date by* property, and Event's `end`
   *   only when dated by `date`): with an `end` a bar, without one a point; a partial date is its
   *   whole precision span, hatched with a dashed outline (it prints) — never
   *   `--accent-dim`. A backwards or unreadable `end` leaves the event at its
   *   start and the hover preview says so. Undated events go to the **Undated**
   *   tray with a reason; clicking one opens it.
   * - **Lanes** are `packLanes` in px at the current zoom
   *   (`timeline-layout.ts`): recomputed on zoom, never on pan.
   * - **Zoom and pan.** Wheel/pinch zooms about the pointer, drag pans
   *   (`timeline-gestures.ts`, pointer events), the toolbar has −/+/**Fit**.
   *   Fit shows every dated event, bounded by a date range filter on the
   *   *Date by* property.
   *   The visible range goes back through `onStateChange` as `from` / `to`
   *   (`timelineRangeFromDomain`) once a gesture settles, not per frame, and
   *   Fit writes fit-all (no range). Our own write echoing back as props is
   *   recognised, so a stored range rounded to whole days doesn't snap the view.
   * - **Keyboard** (the epic's decision 1): the drawing is one tab stop with a
   *   roving tabindex, as the Kanban board. ←/→ step between events in time
   *   order, panning to keep the focused one in view; Shift+←/→ pan;
   *   Home/End go to the first and last event; Enter opens; +/− zoom about the
   *   focused event. Each event is `role="link"` named like "Moon landing,
   *   Jul 20, 1969" (`formatDateValue`, the app's one date formatter); a bar's
   *   name includes its end.
   * - **Hover preview** (#2710): hovering or focusing an event shows the
   *   shared `NoteHoverPreview` — the title and snippet a `[[link]]` to its
   *   note shows — with the event's dates, "approximate" and a set-aside
   *   `end` as extra lines, and the type's card fields under the snippet. It
   *   replaced #2608's own `TimelineHoverCard`, so the app has one hover.
   * - **The list alternative is a toggle**, not a visually hidden copy: the
   *   **List** button swaps the drawing for an ordered list of the same events
   *   in the same order with the same names and dates (the Undated tray is
   *   under both). A hidden duplicate would make a screen reader read every
   *   event twice and either add a tab stop per event or hide its links from
   *   the keyboard; a visible toggle serves a sighted keyboard or magnifier
   *   user as well, and stays whole when the drawing is virtualised.
   * - **Scale.** Above `VIRTUALIZE_ABOVE` dated events only those in view
   *   (half a screen of overscan each side, and the visible lanes) are drawn;
   *   the tab stop is always kept, so the keyboard order stays whole.
   * - **Read-only** (an ```object-view embed, `readOnly`): no zoom/pan
   *   controls or gestures, and nothing written back — the arrows still step
   *   through the events.
   * - **Export** (`exportMode`, #2609): one static picture of the spec's range
   *   (`from` / `to`, or fit-all) at the export block's width, for
   *   `snapshotLiveBlock` — no toolbar, gestures, tab stops or hover card, and
   *   the SVG scales down to a narrower page instead of overflowing it. Each
   *   event's `<g data-note-path>` becomes a link under the export's link
   *   policy (a real `/URI` annotation in a PDF; plain text under
   *   `inline-title`). `timeline-export.ts` picks what is drawn: only events
   *   meeting the range, in at most `EXPORT_MAX_LANES` lanes, the rest named
   *   in a "+N more" note. A legend says what the hatch means, because print
   *   has no hover card.
   *   **A dated list follows the drawing**, every event in range in time order
   *   with its dates (and "approximate", and a flagged `end`). The links
   *   survive, so it isn't needed to *reach* a note — it is there because the
   *   drawing alone can't be *read* on paper: an event's dates live in the
   *   hover card, a label is shortened past 40 characters, the axis only
   *   places an event to within a tick, and lanes past the cap aren't drawn.
   *   It is also the live view's List alternative, which a page can't toggle.
   *   **Fallback:** when the drawing can't be made (no dated events, or the
   *   layout throws), the export is that list (and the Undated tray) with a
   *   line saying so — never the raw spec.
   */
  import { tick, untrack } from 'svelte';
  import { dateSpan } from '../../../shared/objects/date-precision';
  import { timelineDomain, timelineRangeFromDomain } from '../../../shared/objects/timeline';
  import { isValuesFilter, type ViewFilter } from '../../../shared/objects/view-spec';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../shared/objects/type-def';
  import NoteHoverPreview from './NoteHoverPreview.svelte';
  import { createNoteHover } from './note-hover/note-hover.svelte';
  import { buildTimelineModel, timelineProperties, type TimelineEvent } from './timeline/timeline-events';
  import { axisTicks, clampDomain, fitDomain, panDomain, panToShow, PAN_STEP, resolveDomain, xOf, zoomDomain, ZOOM_STEP, type Domain } from './timeline/timeline-scale';
  import { BAR_PX, cullToView, LANE_PX, labelWidth, layoutTimeline, timeOrder, trailingLabelRoom, VIRTUALIZE_ABOVE } from './timeline/timeline-layout';
  import { timelineGestures } from './timeline/timeline-gestures';
  import { EXPORT_MAX_LANES, planTimelineExport, type TimelineExportPlan } from './timeline/timeline-export';
  import { logger } from '../../../shared/logger';

  interface Props {
    type: TypeInfo;
    properties: PropertyDef[];
    /** The view's instances, scoped and filtered. */
    instances: TypeInstanceRow[];
    /** The view's filters — a range filter on the Date by property bounds Fit. */
    filters: ViewFilter[];
    from: string | null;
    to: string | null;
    /** The view's Date by (#2715; null = the default, `date-by.ts`). */
    dateBy?: string | null;
    display: (prop: PropertyDef, value: string | null) => string;
    rowType: (inst: TypeInstanceRow) => TypeInfo | null;
    onOpenNote: (path: string) => void;
    onStateChange: (patch: { from: string | null; to: string | null }) => void;
    /** An embed: no zoom/pan, nothing written back. */
    readOnly?: boolean;
    /** Draw one static picture for an export (#2609; see the header). */
    exportMode?: boolean;
    /** Formatting locale; the viewer's when absent. */
    locale?: string;
  }
  let { type, properties, instances, filters, from, to, dateBy = null, display, rowType, onOpenNote, onStateChange, readOnly = false, exportMode = false, locale }: Props = $props();

  const uid = $props.id();
  const AXIS_PX = 28;
  const TOP_PX = 8;
  /** The width an unmeasured drawing assumes: an export block's (`render-object-view.ts`). */
  const FALLBACK_WIDTH = 760;
  const interactive = $derived(!readOnly && !exportMode);

  const dates = $derived(timelineProperties(dateBy, properties));
  const model = $derived(buildTimelineModel(instances, locale ? { ...dates, locale } : dates));
  const byKey = $derived(new Map(model.dated.map((ev) => [ev.key, ev] as const)));
  const order = $derived(timeOrder(model.dated));

  /** A range filter on the Date by property (#2533, span comparison): its window bounds Fit. */
  const bound = $derived.by(() => {
    const f = filters.find((x) => !isValuesFilter(x) && x.property === dates.dateProperty);
    if (!f || isValuesFilter(f)) return { start: null, end: null };
    return { start: dateSpan(f.min ?? null)?.start ?? null, end: dateSpan(f.max ?? null)?.end ?? null };
  });
  let measuredWidth = $state(0);
  let viewportHeight = $state(0);
  let scrollTop = $state(0);
  const width = $derived(exportMode || measuredWidth <= 0 ? FALLBACK_WIDTH : measuredWidth);

  /** Fit, widened on the right so the latest events' labels aren't cut off by the edge. */
  const fit = $derived.by<Domain | null>(() => {
    const f = fitDomain(model.extent, bound);
    if (!f || !model.extent) return f;
    const room = Math.min(trailingLabelRoom(model.dated, model.extent.end, model.extent.end - model.extent.start), width / 2);
    if (room <= 0 || bound.end !== null) return f;
    return clampDomain({ start: f.start, end: f.start + ((f.end - f.start) * width) / (width - room) });
  });

  /** The visible domain — local while a gesture runs, written back when it settles. */
  let domain = $state<Domain | null>(null);
  /** The from/to we last wrote, so its echo back as props doesn't reset the view. */
  let written: string | null = null;
  let seenKey: string | null = null;
  let seenFit = '';
  const rangeKey = (f: string | null, t: string | null) => `${f ?? ''}|${t ?? ''}`;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  // The view follows a range that arrives as props (a restored tab, an embed's
  // spec, Back), and Fit follows the data while a side is left to it — but not
  // our own write echoing back, and not under a gesture still settling.
  $effect(() => {
    const key = rangeKey(from, to);
    const fitKey = fit ? `${fit.start}|${fit.end}` : '';
    const next = resolveDomain(timelineDomain({ from, to }), fit);
    untrack(() => {
      const keyChanged = key !== seenKey;
      const fitChanged = fitKey !== seenFit;
      seenKey = key;
      seenFit = fitKey;
      if (domain) {
        if (keyChanged && key === written) return;
        if (!keyChanged && (!fitChanged || commitTimer !== undefined || (from !== null && to !== null))) return;
      }
      written = null;
      domain = next;
    });
  });

  function commitNow(): void {
    commitTimer = undefined;
    if (!domain || !interactive) return;
    const r = timelineRangeFromDomain(domain.start, domain.end);
    written = rangeKey(r.from, r.to);
    onStateChange({ from: r.from, to: r.to });
  }
  function scheduleCommit(ms = 350): void {
    if (!interactive) return;
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitNow, ms);
  }
  // A layout switch right after a zoom still keeps it.
  $effect(() => () => { if (commitTimer !== undefined) { clearTimeout(commitTimer); commitNow(); } });

  function setDomain(d: Domain): void { domain = d; }
  function zoomBy(factor: number, anchor = 0.5): void {
    if (!domain) return;
    domain = zoomDomain(domain, factor, anchor);
    scheduleCommit();
  }
  function fitAll(): void {
    clearTimeout(commitTimer);
    commitTimer = undefined;
    if (fit) domain = fit;
    written = rangeKey(null, null);
    onStateChange({ from: null, to: null });
  }

  // Lanes depend on the scale alone — a pan keeps them (`timeline-layout.ts`).
  const pxPerMs = $derived(domain ? Number((width / (domain.end - domain.start)).toPrecision(12)) : 0);
  /** An export's drawing (`timeline-export.ts`); `ok: false` = it couldn't be drawn, so list instead. */
  const exportPlan = $derived.by<{ ok: true; plan: TimelineExportPlan } | { ok: false } | null>(() => {
    if (!exportMode || model.dated.length === 0) return null;
    try {
      // The range straight from the spec (the `domain` effect lands on the same one, a tick later).
      return { ok: true, plan: planTimelineExport(model.dated, resolveDomain(timelineDomain({ from, to }), fit), width) };
    } catch (err) {
      logger('objects').warn('timeline export: the drawing failed, listing its events instead', err);
      return { ok: false };
    }
  });
  const layout = $derived(exportMode ? (exportPlan?.ok ? exportPlan.plan.layout : { placements: new Map(), laneCount: 0 }) : layoutTimeline(model.dated, pxPerMs));
  const laneCount = $derived(exportPlan?.ok ? exportPlan.plan.laneCount : layout.laneCount);
  const plotHeight = $derived(TOP_PX + Math.max(1, laneCount) * LANE_PX + 8);
  /** An export's dated list: what's in range, or every dated event when the drawing failed. */
  const exportList = $derived<TimelineEvent[]>(!exportPlan ? [] : exportPlan.ok ? exportPlan.plan.listed : order.map((k) => byKey.get(k)!));
  const ticks = $derived(domain ? axisTicks(domain, width, locale ? { locale } : {}) : { unit: 'year' as const, ticks: [] });

  let focusedKey = $state<string | null>(null);
  /** The roving tab stop: the last-focused event, else the first in view, else the first. */
  const tabStop = $derived.by<string | null>(() => {
    if (focusedKey && byKey.has(focusedKey)) return focusedKey;
    const d = domain;
    const inView = d ? order.find((k) => { const ev = byKey.get(k)!; return ev.end > d.start && ev.start < d.end; }) : undefined;
    return inView ?? order[0] ?? null;
  });

  const drawn = $derived.by<TimelineEvent[]>(() => {
    if (exportMode) return exportPlan?.ok ? exportPlan.plan.drawn : [];
    if (!domain || model.dated.length <= VIRTUALIZE_ABOVE) return model.dated;
    const firstLane = Math.floor((scrollTop - TOP_PX) / LANE_PX) - 10;
    const lastLane = viewportHeight > 0 ? Math.ceil((scrollTop + viewportHeight) / LANE_PX) + 10 : Infinity;
    return cullToView(model.dated, layout, domain, { first: firstLane, last: lastLane }, tabStop);
  });

  /** Keep px within reach of the drawing, so far-off events don't draw at ±1e12. */
  const clampX = (x: number) => Math.min(Math.max(x, -2000), width + 2000);
  const laneY = (key: string) => TOP_PX + (layout.placements.get(key)?.lane ?? 0) * LANE_PX;

  let viewport = $state<HTMLDivElement>();

  async function focusEvent(key: string, opts: { reveal: boolean } = { reveal: true }): Promise<void> {
    const ev = byKey.get(key);
    if (!ev) return;
    focusedKey = key;
    if (opts.reveal && domain) {
      const next = panToShow(domain, ev.start, Math.max(ev.end, ev.start + 1));
      if (next !== domain) { domain = next; scheduleCommit(); }
    }
    await tick();
    if (viewport) {
      const y = laneY(key);
      const top = viewport.scrollTop;
      const visible = viewport.clientHeight - AXIS_PX;
      if (y < top) viewport.scrollTop = y;
      else if (visible > 0 && y + LANE_PX > top + visible) viewport.scrollTop = y + LANE_PX - visible;
    }
    const el = [...(viewport?.querySelectorAll<SVGGElement>('[data-timeline-event]') ?? [])].find((g) => g.dataset['notePath'] === key);
    el?.focus();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = (e.target as Element | null)?.closest<SVGGElement>('[data-timeline-event]')?.dataset['notePath'] ?? tabStop;
    if (!key) return;
    const i = order.indexOf(key);
    const step = (k: string | undefined) => { e.preventDefault(); if (k) void focusEvent(k); };
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (e.shiftKey) {
        e.preventDefault();
        if (!interactive || !domain) return;
        domain = panDomain(domain, (e.key === 'ArrowLeft' ? -1 : 1) * PAN_STEP * (domain.end - domain.start));
        scheduleCommit();
        return;
      }
      step(order[i + (e.key === 'ArrowLeft' ? -1 : 1)]);
    } else if (e.key === 'Home') step(order[0]);
    else if (e.key === 'End') step(order[order.length - 1]);
    else if (e.key === 'Enter') { e.preventDefault(); onOpenNote(key); }
    else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault();
      if (!interactive || !domain) return;
      // About the focused event, brought to the middle — zooming about an event
      // at the edge would keep it pinned there, its label cut off.
      const ev = byKey.get(key);
      if (ev) domain = panDomain(domain, ev.start - (domain.start + domain.end) / 2);
      zoomBy(e.key === '+' || e.key === '=' ? ZOOM_STEP : 1 / ZOOM_STEP);
    }
  }

  // The hover preview (#2710): the shared `NoteHoverPreview`, the same one a
  // `[[link]]` to the event's note shows, on hover or keyboard focus, with the
  // event's dates, "approximate" and a set-aside `end` as its extra lines and
  // the type's card fields as its properties strip. Never in an export.
  const hover = createNoteHover();
  const cardId = `${uid}-card`;
  const cardKey = $derived(exportMode ? null : hover.current?.key ?? null);
  const cardEvent = $derived(cardKey ? byKey.get(cardKey) ?? null : null);
  const subjectFor = (ev: TimelineEvent, anchor: Element) => ({ key: ev.key, target: ev.key, anchor, fallbackTitle: ev.title });

  let listMode = $state(false);
  const rangeLabel = $derived(`${type.label} timeline, ${order.length} dated ${order.length === 1 ? 'event' : 'events'}`);
</script>

<div class="tl" class:tl-export={exportMode}>
  {#if !exportMode}
    <div class="tl-toolbar" data-export-omit>
      {#if interactive && !listMode}
        <button type="button" class="tl-btn" aria-label="Zoom out" title="Zoom out (−)" onclick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
        <button type="button" class="tl-btn" aria-label="Zoom in" title="Zoom in (+)" onclick={() => zoomBy(ZOOM_STEP)}>+</button>
        <button type="button" class="tl-btn" title="Show every dated event" onclick={fitAll}>Fit</button>
      {/if}
      <button type="button" class="tl-btn" aria-pressed={listMode} title="Show the events as a list" onclick={() => (listMode = !listMode)}>List</button>
    </div>
  {/if}

  {#if listMode}
    <ol class="tl-list" aria-label="{type.label} in time order">
      {#each order as key (key)}
        {@const ev = byKey.get(key)!}
        <li>
          <button type="button" class="tl-list-row" data-note-path={ev.key} onclick={() => onOpenNote(ev.key)}>
            <span class="tl-list-title">{ev.title}</span>
            <span class="tl-list-date">{ev.dateText}{ev.approx ? ' (approximate)' : ''}</span>
            {#if ev.endNote}<span class="tl-list-flag">{ev.endNote}</span>{/if}
          </button>
        </li>
      {/each}
    </ol>
  {:else if model.dated.length === 0}
    <p class="tl-empty">No {type.label.toLowerCase()} here has a date yet.</p>
  {:else if exportPlan && !exportPlan.ok}
    <p class="tl-export-note tl-fallback">The timeline couldn't be drawn, so its events are listed below.</p>
  {:else if domain}
    <div class="tl-stage">
      <div
        class="tl-viewport"
        class:tl-pannable={interactive}
        bind:this={viewport}
        bind:clientWidth={measuredWidth}
        bind:clientHeight={viewportHeight}
        onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
        use:timelineGestures={{ enabled: interactive, view: () => (domain ? { domain, width } : null), onDomain: setDomain, onSettle: () => scheduleCommit(0) }}
      >
        <svg class="tl-axis" width={width} height={AXIS_PX} viewBox={exportMode ? `0 0 ${width} ${AXIS_PX}` : undefined} aria-hidden="true">
          {#each ticks.ticks as t (t.t)}
            {@const x = xOf(t.t, domain, width)}
            <line class="tl-tick" x1={x} x2={x} y1={AXIS_PX - 7} y2={AXIS_PX} />
            <text class="tl-tick-label" x={x + 3} y={AXIS_PX - 11}>{t.label}</text>
          {/each}
          <line class="tl-axis-line" x1="0" x2={width} y1={AXIS_PX - 0.5} y2={AXIS_PX - 0.5} />
        </svg>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <svg
          class="tl-plot"
          width={width}
          height={plotHeight}
          viewBox={exportMode ? `0 0 ${width} ${plotHeight}` : undefined}
          role="group"
          aria-label={rangeLabel}
          data-tick-unit={ticks.unit}
          data-domain-start={domain.start}
          data-domain-end={domain.end}
          data-lanes={laneCount}
          onkeydown={onKeydown}
        >
          <defs>
            <pattern id="{uid}-hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
              <rect class="tl-hatch-bg" width="5" height="5" />
              <line class="tl-hatch-line" x1="0" y1="0" x2="0" y2="5" />
            </pattern>
          </defs>
          <g aria-hidden="true">
            {#each ticks.ticks as t (t.t)}
              {@const x = xOf(t.t, domain, width)}
              <line class="tl-grid" x1={x} x2={x} y1="0" y2={plotHeight} />
            {/each}
          </g>
          {#each drawn as ev (ev.key)}
            {@const p = layout.placements.get(ev.key)!}
            {@const x0 = xOf(ev.start, domain, width)}
            {@const x1 = xOf(ev.end, domain, width)}
            {@const y = laneY(ev.key)}
            <!-- The role is `link` except in an export, where only main knows whether it becomes one (inline-title leaves text); an export takes no tab stop either. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_tabindex -->
            <g
              class="tl-event"
              class:approx={ev.approx}
              transform="translate(0 {y})"
              role={exportMode ? undefined : 'link'}
              tabindex={exportMode ? undefined : ev.key === tabStop ? 0 : -1}
              aria-label={ev.label}
              aria-describedby={cardKey === ev.key ? cardId : undefined}
              data-timeline-event
              data-note-path={ev.key}
              data-kind={p.point ? 'point' : 'bar'}
              data-lane={p.lane}
              data-end-issue={ev.endNote ? '' : undefined}
              onclick={() => onOpenNote(ev.key)}
              onfocus={(e) => { focusedKey = ev.key; if (!exportMode) hover.focus(subjectFor(ev, e.currentTarget)); }}
              onblur={() => hover.blur(ev.key)}
              onpointerenter={(e) => { if (!exportMode) hover.pointerEnter(subjectFor(ev, e.currentTarget)); }}
              onpointerleave={() => hover.pointerLeave(ev.key)}
            >
              {#if p.point}
                {#if !exportMode}<circle class="tl-ring" cx={clampX(x0)} cy={BAR_PX / 2} r="9" />{/if}
                <circle class="tl-point" class:tl-approx-point={ev.approx} cx={clampX(x0)} cy={BAR_PX / 2} r="5" />
                <text class="tl-label" x={clampX(x0) + 10} y={BAR_PX / 2 + 4}>{p.labelText}</text>
              {:else}
                {#if !exportMode}<rect class="tl-ring" x={clampX(x0) - 3} y="-3" width={Math.max(0, clampX(x1) - clampX(x0)) + 6} height={BAR_PX + 6} rx="4" />{/if}
                {#each ev.segments as s, si (si)}
                  {@const sx0 = clampX(xOf(s.start, domain, width))}
                  {@const sx1 = clampX(xOf(s.end, domain, width))}
                  {#if s.approx}
                    <rect class="tl-bar tl-bar-approx" x={sx0 + 0.5} y="0.5" width={Math.max(0, sx1 - sx0 - 1)} height={BAR_PX - 1} fill="url(#{uid}-hatch)" />
                  {:else}
                    <rect class="tl-bar" x={sx0} y="0" width={Math.max(0, sx1 - sx0)} height={BAR_PX} />
                  {/if}
                {/each}
                {@const inX = Math.max(clampX(xOf(p.labelIn?.start ?? 0, domain, width)), 0) + 4}
                {#if p.labelIn && inX + labelWidth(p.labelText) + 4 <= clampX(xOf(p.labelIn.end, domain, width))}
                  <!-- Inside the solid stretch, held at the left edge while it scrolls off, as long as it still fits. -->
                  <text class="tl-label tl-label-inside" x={inX} y={BAR_PX / 2 + 4}>{p.labelText}</text>
                {:else if !p.labelIn}
                  <!-- (A label packed inside a bar that has scrolled almost out of view is left out, not moved where it could overlap.) -->
                  <text class="tl-label" x={clampX(x1) + 4} y={BAR_PX / 2 + 4}>{p.labelText}</text>
                {/if}
              {/if}
            </g>
          {/each}
        </svg>
      </div>
    </div>
    {#if exportPlan?.ok}
      {@const plan = exportPlan.plan}
      {#if plan.drawn.some((ev) => ev.approx)}
        <p class="tl-export-note tl-legend">
          <svg width="26" height="12" aria-hidden="true"><rect class="tl-bar-approx" x="0.5" y="0.5" width="25" height="11" fill="url(#{uid}-hatch)" /></svg>
          Hatched, dashed edge: approximate — only the year or month is known.
        </p>
      {/if}
      {#if plan.overflow.length > 0}
        <p class="tl-export-note tl-more">+{plan.overflow.length} more not drawn (past {EXPORT_MAX_LANES} lanes): {plan.overflow.map((ev) => ev.title).join(', ')}.</p>
      {/if}
      {#if plan.outside > 0}
        <p class="tl-export-note tl-outside">{plan.outside} more {plan.outside === 1 ? 'falls' : 'fall'} outside this range.</p>
      {/if}
    {/if}
  {/if}

  {#if exportList.length > 0}
    <section class="tl-export-events" aria-labelledby="{uid}-dated">
      <h3 id="{uid}-dated" class="tl-undated-head">Dated <span class="tl-undated-count">{exportList.length}</span></h3>
      <ol class="tl-export-list">
        {#each exportList as ev (ev.key)}
          <li class="tl-export-row">
            <span class="tl-list-title" data-note-path={ev.key}>{ev.title}</span>
            <span class="tl-list-date">{ev.dateText}{ev.approx ? ' (approximate)' : ''}</span>
            {#if ev.endNote}<span class="tl-list-flag">{ev.endNote}</span>{/if}
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if !exportMode}
    <NoteHoverPreview
      id={cardId}
      {hover}
      instance={cardEvent ? { type, properties, inst: cardEvent.inst, display, rowType: rowType(cardEvent.inst), omit: [dates.dateProperty, ...(dates.endProperty ? [dates.endProperty] : [])] } : null}
      extra={cardEvent ? cardLines : undefined}
    />
  {/if}

  {#if model.undated.length > 0}
    <section class="tl-undated" aria-labelledby="{uid}-undated">
      <h3 id="{uid}-undated" class="tl-undated-head">Undated <span class="tl-undated-count">{model.undated.length}</span></h3>
      <ul class="tl-undated-list">
        {#each model.undated as u (u.key)}
          <li>
            <button type="button" class="tl-undated-row" data-note-path={u.key} data-undated-reason={u.reason} onclick={() => onOpenNote(u.key)}>
              <span class="tl-list-title">{u.title}</span>
              <span class="tl-list-date">{u.reasonText}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

{#snippet cardLines()}
  {#if cardEvent}
    <!-- The dates head the preview, so the Date by property (and Event's `end`) aren't repeated as fields (#2715). -->
    <span class="tl-card-date">{cardEvent.dateText}{#if cardEvent.approx}<span class="tl-card-approx"> · approximate</span>{/if}</span>
    {#if cardEvent.endNote}<span class="tl-card-flag" data-end-issue>⚠ {cardEvent.endNote}</span>{/if}
  {/if}
{/snippet}

<style>
  .tl { flex: 1; min-height: 0; display: flex; flex-direction: column; font-family: var(--font-sans); }
  .tl-toolbar { display: flex; gap: 6px; padding: 8px 12px 4px; flex-shrink: 0; }
  .tl-btn {
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
  .tl-btn:hover { border-color: var(--accent); }
  .tl-btn[aria-pressed='true'] { border-color: var(--accent); background: color-mix(in oklch, var(--accent) 18%, var(--bg-button)); }
  .tl-stage { position: relative; flex: 1; min-height: 120px; }
  .tl-viewport { position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; background: var(--bg); }
  .tl-pannable { touch-action: none; cursor: grab; }
  .tl-viewport:global([data-panning]) { cursor: grabbing; user-select: none; }
  svg { display: block; }
  .tl-axis { position: sticky; top: 0; z-index: 1; background: var(--bg); }
  .tl-tick, .tl-axis-line { stroke: var(--text-muted); stroke-width: 1; }
  .tl-tick-label { fill: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .tl-grid { stroke: var(--border); stroke-width: 1; }
  .tl-event { outline: none; }
  .tl:not(.tl-export) .tl-event { cursor: pointer; }
  .tl-ring { fill: none; stroke: var(--text); stroke-width: 2; visibility: hidden; }
  .tl-event:focus-visible .tl-ring, .tl-event:hover .tl-ring { visibility: visible; }
  /* Not on the hatched stretches: a class rule beats the `fill` attribute that points at the pattern. */
  .tl-bar:not(.tl-bar-approx) { fill: var(--accent); }
  .tl-bar-approx { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 3 2; }
  .tl-hatch-bg { fill: var(--bg); }
  .tl-hatch-line { stroke: var(--accent); stroke-width: 2; }
  .tl-point { fill: var(--accent); }
  .tl-point.tl-approx-point { fill: var(--bg); stroke: var(--accent); stroke-width: 2; stroke-dasharray: 3 2; }
  .tl-label { fill: var(--text); font-size: 11px; pointer-events: none; }
  .tl-label-inside { fill: var(--accent-ink); }
  .tl-card-approx { font-style: italic; }
  .tl-card-flag { color: var(--text); font-weight: 600; }
  .tl-empty { padding: 24px 16px; color: var(--text-muted); font-size: 13px; }

  .tl-list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; min-height: 0; }
  .tl-list-row, .tl-undated-row {
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
  .tl-list-row:hover, .tl-undated-row:hover { background: color-mix(in oklch, var(--text) 5%, transparent); }
  .tl-list-title { font-size: 13px; font-weight: 500; }
  .tl-list-date { font-size: 11.5px; color: var(--text-muted); }
  .tl-list-flag { font-size: 11.5px; color: var(--text); font-weight: 600; }

  .tl-undated { flex-shrink: 0; max-height: 30%; overflow-y: auto; border-top: 1px solid var(--border); padding: 6px 6px 8px; }
  .tl-undated-head { margin: 2px 10px 4px; font-size: 12px; font-weight: 600; color: var(--text); font-family: var(--font-sans); }
  .tl-undated-count { font-family: var(--font-mono); font-weight: 400; color: var(--text-muted); }
  .tl-undated-list { list-style: none; margin: 0; padding: 0; }

  /* Export (#2609): a page doesn't scroll, so the drawing takes its full
     height, and it scales down (viewBox) on a page narrower than the block. */
  .tl-export .tl-stage { position: static; }
  .tl-export .tl-viewport { position: static; overflow: visible; }
  .tl-export .tl-axis { position: static; }
  .tl-export svg { max-width: 100%; height: auto; }
  .tl-export .tl-plot { break-inside: avoid; }
  .tl-export .tl-undated { max-height: none; overflow: visible; }
  .tl-export-note { margin: 6px 12px 0; font-size: 11.5px; color: var(--text-muted); line-height: 1.4; }
  .tl-legend { display: flex; align-items: center; gap: 8px; }
  .tl-legend svg { flex-shrink: 0; }
  .tl-fallback { padding-top: 8px; }
  .tl-export-events { border-top: 1px solid var(--border); margin-top: 8px; padding: 6px 6px 8px; }
  .tl-export-list { margin: 0; padding: 0 10px 0 32px; }
  .tl-export-row { padding: 2px 0; font-size: 13px; break-inside: avoid; }
  .tl-export-row::marker { color: var(--text-muted); font-size: 11.5px; }
  .tl-export-row > span + span { margin-left: 8px; }
</style>
