<script lang="ts">
  /**
   * Density heatmap gutter for the source viewer (#102).
   *
   * Sits absolute on the right edge of a body container, painting a
   * tick per excerpt at its proportional vertical position. Hover
   * surfaces a preview of the citedText; click scrolls the parent
   * scroller to that excerpt. Excerpts whose citedText isn't found
   * in the rendered body (user-edited body, OCR mismatch) are
   * silently skipped.
   *
   * `host` is the rendered content element whose excerpts we're
   * indexing. `scroller` is the actual scrollable ancestor — passing
   * it explicitly lets the gutter dispatch a scroll on the right
   * element without having to climb the DOM.
   */
  import type { SourceExcerpt } from '../../../shared/types';
  import { findExcerptRange } from './find-excerpt-range';

  interface Props {
    host: HTMLElement | null;
    scroller: HTMLElement | null;
    excerpts: SourceExcerpt[];
    /** Bumped by the host whenever the body re-renders so the gutter
     *  recomputes positions. */
    revision?: number;
  }

  let { host, scroller, excerpts, revision = 0 }: Props = $props();

  interface Tick {
    excerptId: string;
    topPct: number; // 0..1 within host
    yPx: number;    // absolute top within host
    preview: string;
  }

  let ticks = $state<Tick[]>([]);
  let hovered = $state<Tick | null>(null);
  let hoverY = $state(0);

  $effect(() => {
    // Recompute whenever any input changes. The host's layout may
    // shift between content load and first paint, so a requestAnimationFrame
    // gives Preview one tick to settle.
    revision; host; excerpts;
    if (!host) { ticks = []; return; }
    requestAnimationFrame(() => recompute());
  });

  function recompute(): void {
    if (!host) return;
    const total = host.scrollHeight || host.getBoundingClientRect().height;
    if (total <= 0) { ticks = []; return; }
    const next: Tick[] = [];
    const hostRect = host.getBoundingClientRect();
    for (const e of excerpts) {
      if (!e.citedText) continue;
      const range = findExcerptRange(host, e.citedText);
      if (!range) continue;
      const r = range.getBoundingClientRect();
      const y = r.top - hostRect.top + host.scrollTop;
      next.push({
        excerptId: e.excerptId,
        yPx: y,
        topPct: Math.max(0, Math.min(1, y / total)),
        preview: previewOf(e.citedText),
      });
    }
    ticks = next;
  }

  function previewOf(s: string): string {
    const clean = s.replace(/\s+/g, ' ').trim();
    return clean.length > 120 ? clean.slice(0, 117) + '…' : clean;
  }

  function jumpTo(tick: Tick): void {
    if (!scroller || !host) return;
    // Scroll the scroller so the excerpt sits roughly a third of the
    // viewport down — comfortable reading position, leaves context
    // above visible.
    const containerRect = scroller.getBoundingClientRect();
    const targetWithinScroller = tick.yPx + (host.offsetTop - scroller.scrollTop);
    const desiredTop = scroller.scrollTop + targetWithinScroller - containerRect.height / 3;
    scroller.scrollTo({ top: Math.max(0, desiredTop), behavior: 'smooth' });
  }

  function onTickEnter(tick: Tick, e: MouseEvent): void {
    hovered = tick;
    hoverY = e.clientY;
  }

  function onTickLeave(): void { hovered = null; }
</script>

{#if ticks.length > 0}
  <div class="excerpt-density-gutter" aria-hidden="true">
    {#each ticks as t (t.excerptId)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tick"
        style:top="{t.topPct * 100}%"
        onmouseenter={(e) => onTickEnter(t, e)}
        onmouseleave={onTickLeave}
        onclick={() => jumpTo(t)}
      ></div>
    {/each}
  </div>
{/if}

{#if hovered}
  <div class="excerpt-tip" style:top="{hoverY}px">
    {hovered.preview}
  </div>
{/if}

<style>
  .excerpt-density-gutter {
    position: absolute;
    top: 0;
    right: 0;
    width: 14px;
    height: 100%;
    pointer-events: none;
  }

  .tick {
    position: absolute;
    right: 4px;
    left: 4px;
    height: 6px;
    margin-top: -3px;
    border-radius: 2px;
    background: color-mix(in oklch, var(--accent) 55%, transparent);
    pointer-events: auto;
    cursor: pointer;
    transition: background 0.1s ease, transform 0.1s ease;
  }
  .tick:hover {
    background: var(--accent);
    transform: scaleX(1.4);
  }

  /* Tooltip floats next to the cursor — `position: fixed` so it
     escapes the body-view's clipping context. */
  .excerpt-tip {
    position: fixed;
    right: 18px;
    transform: translateY(-50%);
    max-width: 280px;
    padding: 6px 10px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    color: var(--text);
    font-size: 12px;
    line-height: 1.4;
    pointer-events: none;
    z-index: var(--z-popover);
    font-family: var(--font-sans);
  }
</style>
