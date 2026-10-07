<script lang="ts">
  /**
   * The Timeline layout of a type view (#2608, epic #2606): Event notes (and
   * any subtype — Meeting, a user's Conference) on a horizontal time axis.
   * `TypeView` scopes and filters the instances; this draws them. The design
   * is the spike's (`docs/vision/objects-expansion.md`, "Timeline").
   *
   * - **Our own SVG.** One `<g>` per event; the axis is `timeline-scale.ts`'s
   *   one-line linear map over civil-axis ms, ticked by `d3-time` and
   *   labelled by `Intl` (`timeline-format.ts`), so `-0043` reads "44 BC".
   * - **Events.** `timeline-events.ts` reads each `date` / `end` once per data
   *   revision: with an `end` a bar, without one a point; a partial date is its
   *   whole precision span, hatched with a dashed outline (it prints) — never
   *   `--accent-dim`. A backwards or unreadable `end` leaves the event at its
   *   start and the hover card says so. Undated events go to the **Undated**
   *   tray with a reason; clicking one opens it.
   * - **Lanes** are `packLanes` in px at the current zoom
   *   (`timeline-layout.ts`): recomputed on zoom, never on pan.
   * - **Zoom and pan.** Wheel/pinch zooms about the pointer, drag pans
   *   (`timeline-gestures.ts`, pointer events), the toolbar has −/+/**Fit**.
   *   Fit shows every dated event, bounded by a date range filter on `date`.
   *   The visible range goes back through `onStateChange` as `from` / `to`
   *   (`timelineRangeFromDomain`) once a gesture settles, not per frame, and
   *   Fit writes fit-all (no range). Our own write echoing back as props is
   *   recognised, so a stored range rounded to whole days doesn't snap the view.
   * - **Keyboard** (the epic's decision 1): the drawing is one tab stop with a
   *   roving tabindex, as the Kanban board. ←/→ step between events in time
   *   order, panning to keep the focused one in view; Shift+←/→ pan;
   *   Home/End go to the first and last event; Enter opens; +/− zoom about the
   *   focused event. Each event is `role="link"` named like "Moon landing,
   *   20 July 1969"; a bar's name includes its end.
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
   *   through the events. **Export** (`exportMode`) is #2609's hook: today it
   *   only draws without controls, tab stops or hover, at the export width.
   */
  import { tick, untrack } from 'svelte';
  import { dateSpan } from '../../../shared/objects/date-precision';
  import { timelineDomain, timelineRangeFromDomain } from '../../../shared/objects/timeline';
  import { isValuesFilter, type ViewFilter } from '../../../shared/objects/view-spec';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../shared/objects/type-def';
  import TimelineHoverCard from './timeline/TimelineHoverCard.svelte';
  import { buildTimelineModel, DATE_PROPERTY, type TimelineEvent } from './timeline/timeline-events';
  import { axisTicks, clampDomain, fitDomain, panDomain, panToShow, PAN_STEP, resolveDomain, xOf, zoomDomain, ZOOM_STEP, type Domain } from './timeline/timeline-scale';
  import { BAR_PX, cullToView, LANE_PX, labelWidth, layoutTimeline, timeOrder, trailingLabelRoom, VIRTUALIZE_ABOVE } from './timeline/timeline-layout';
  import { timelineGestures } from './timeline/timeline-gestures';

  interface Props {
    type: TypeInfo;
    properties: PropertyDef[];
    /** The view's instances, scoped and filtered. */
    instances: TypeInstanceRow[];
    /** The view's filters — a range filter on `date` bounds Fit. */
    filters: ViewFilter[];
    from: string | null;
    to: string | null;
    display: (prop: PropertyDef, value: string | null) => string;
    rowType: (inst: TypeInstanceRow) => TypeInfo | null;
    onOpenNote: (path: string) => void;
    onStateChange: (patch: { from: string | null; to: string | null }) => void;
    /** An embed: no zoom/pan, nothing written back. */
    readOnly?: boolean;
    /** Draw for an export (#2609 fills this in). */
    exportMode?: boolean;
    /** Formatting locale; the viewer's when absent. */
    locale?: string;
  }
  let { type, properties, instances, filters, from, to, display, rowType, onOpenNote, onStateChange, readOnly = false, exportMode = false, locale }: Props = $props();

  const uid = $props.id();
  const AXIS_PX = 28;
  const TOP_PX = 8;
  /** The width an unmeasured drawing assumes: an export block's (`render-object-view.ts`). */
  const FALLBACK_WIDTH = 760;
  const interactive = $derived(!readOnly && !exportMode);

  const model = $derived(buildTimelineModel(instances, locale ? { locale } : {}));
  const byKey = $derived(new Map(model.dated.map((ev) => [ev.key, ev] as const)));
  const order = $derived(timeOrder(model.dated));

  /** A range filter on `date` (#2533, span comparison): its window bounds Fit. */
  const bound = $derived.by(() => {
    const f = filters.find((x) => !isValuesFilter(x) && x.property === DATE_PROPERTY);
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
  const layout = $derived(layoutTimeline(model.dated, pxPerMs));
  const plotHeight = $derived(TOP_PX + Math.max(1, layout.laneCount) * LANE_PX + 8);
  const ticks = $derived(domain ? axisTicks(domain, width, locale ? { locale } : {}) : { unit: 'year' as const, ticks: [] });

  let focusedKey = $state<string | null>(null);
  let hoveredKey = $state<string | null>(null);
  let plotFocused = $state(false);
  /** The roving tab stop: the last-focused event, else the first in view, else the first. */
  const tabStop = $derived.by<string | null>(() => {
    if (focusedKey && byKey.has(focusedKey)) return focusedKey;
    const d = domain;
    const inView = d ? order.find((k) => { const ev = byKey.get(k)!; return ev.end > d.start && ev.start < d.end; }) : undefined;
    return inView ?? order[0] ?? null;
  });

  const drawn = $derived.by<TimelineEvent[]>(() => {
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

  const cardKey = $derived(exportMode ? null : hoveredKey ?? (plotFocused ? focusedKey : null));
  const cardEvent = $derived(cardKey ? byKey.get(cardKey) ?? null : null);
  const cardId = `${uid}-card`;
  const cardPos = $derived.by(() => {
    if (!cardEvent || !domain) return null;
    const x = Math.min(Math.max(xOf(cardEvent.start, domain, width), 0), width);
    return { x, y: AXIS_PX + laneY(cardEvent.key) + BAR_PX + 12 - scrollTop, flip: x > width - 290 };
  });

  let listMode = $state(false);
  const rangeLabel = $derived(`${type.label} timeline, ${order.length} dated ${order.length === 1 ? 'event' : 'events'}`);
</script>

<div class="tl" class:tl-export={exportMode}>
  {#if !exportMode}
    <div class="tl-toolbar">
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
        <svg class="tl-axis" width={width} height={AXIS_PX} aria-hidden="true">
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
          role="group"
          aria-label={rangeLabel}
          data-tick-unit={ticks.unit}
          data-domain-start={domain.start}
          data-domain-end={domain.end}
          data-lanes={layout.laneCount}
          onkeydown={onKeydown}
          onfocusin={() => (plotFocused = true)}
          onfocusout={() => (plotFocused = false)}
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
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <g
              class="tl-event"
              class:approx={ev.approx}
              transform="translate(0 {y})"
              role="link"
              tabindex={exportMode ? undefined : ev.key === tabStop ? 0 : -1}
              aria-label={ev.label}
              aria-describedby={cardKey === ev.key ? cardId : undefined}
              data-timeline-event
              data-note-path={ev.key}
              data-kind={p.point ? 'point' : 'bar'}
              data-lane={p.lane}
              data-end-issue={ev.endNote ? '' : undefined}
              onclick={() => onOpenNote(ev.key)}
              onfocus={() => (focusedKey = ev.key)}
              onpointerenter={() => (hoveredKey = ev.key)}
              onpointerleave={() => { if (hoveredKey === ev.key) hoveredKey = null; }}
            >
              {#if p.point}
                <circle class="tl-ring" cx={clampX(x0)} cy={BAR_PX / 2} r="9" />
                <circle class="tl-point" class:tl-approx-point={ev.approx} cx={clampX(x0)} cy={BAR_PX / 2} r="5" />
                <text class="tl-label" x={clampX(x0) + 10} y={BAR_PX / 2 + 4}>{p.labelText}</text>
              {:else}
                <rect class="tl-ring" x={clampX(x0) - 3} y="-3" width={Math.max(0, clampX(x1) - clampX(x0)) + 6} height={BAR_PX + 6} rx="4" />
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
      {#if cardEvent && cardPos}
        <TimelineHoverCard id={cardId} event={cardEvent} {type} {properties} {display} {rowType} x={cardPos.x} y={cardPos.y} flip={cardPos.flip} />
      {/if}
    </div>
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
  .tl-event { cursor: pointer; outline: none; }
  .tl-ring { fill: none; stroke: var(--text); stroke-width: 2; visibility: hidden; }
  .tl-event:focus-visible .tl-ring, .tl-event:hover .tl-ring { visibility: visible; }
  .tl-bar { fill: var(--accent); }
  .tl-bar-approx { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 3 2; }
  .tl-hatch-bg { fill: var(--bg); }
  .tl-hatch-line { stroke: var(--accent); stroke-width: 2; }
  .tl-point { fill: var(--accent); }
  .tl-point.tl-approx-point { fill: var(--bg); stroke: var(--accent); stroke-width: 2; stroke-dasharray: 3 2; }
  .tl-label { fill: var(--text); font-size: 11px; pointer-events: none; }
  .tl-label-inside { fill: var(--accent-ink); }
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

  /* Export (#2609's hook): a page doesn't scroll, so the drawing takes its full height. */
  .tl-export .tl-stage { position: static; }
  .tl-export .tl-viewport { position: static; overflow: visible; cursor: auto; }
  .tl-export .tl-undated { max-height: none; overflow: visible; }
</style>
