<script lang="ts">
  /**
   * A mindmap of any tree (#2964): laid out by `shared/mindmap/mindmap-layout.ts`
   * (d3-hierarchy's tidy tree, loaded on first use) left to right or radial,
   * and drawn as SVG in the app's theme.
   *
   * - **Folding** a node hides its subtree and shows how many it hides. The
   *   fold state is the host's (`folded` / `onFold`), so each map keeps its own.
   * - **Zoom, pan, Fit**: the wheel zooms at the pointer, dragging the
   *   background pans, Fit shows it all. The map fits itself when first drawn.
   * - **A tree to assistive tech** (`role="tree"`): each node a `treeitem` with
   *   `aria-level`, `aria-setsize` / `aria-posinset`, `aria-expanded` where it
   *   has children and `aria-selected`; one tab stop, focus roving inside.
   *   ↑ / ↓ move between siblings, ← to the parent, → to the first child
   *   (unfolding it first), Space folds or unfolds, Home / End to the root and
   *   the last node, Enter opens (`onActivate`).
   * - **Pointer**: a click selects (`onSelect`), a double-click opens, the
   *   button on a node's edge folds it.
   */
  import { onMount, tick, untrack } from 'svelte';
  import type { MindmapLayout, MindmapLayoutNode, MindmapOrientation, MindmapTree } from '../../../../shared/mindmap/mindmap-layout';

  interface Props {
    tree: MindmapTree;
    orientation?: MindmapOrientation;
    /** Nodes whose subtrees are hidden. */
    folded?: readonly string[];
    onFold?: (id: string, folded: boolean) => void;
    selected?: string | null;
    onSelect?: (id: string) => void;
    onActivate?: (id: string) => void;
    /** What the tree is, for a screen reader. */
    label?: string;
  }
  let { tree, orientation = 'ltr', folded = [], onFold, selected = null, onSelect, onActivate, label = 'Mindmap' }: Props = $props();

  type LayoutFn = (root: MindmapTree, opts: { orientation: MindmapOrientation; folded?: ReadonlySet<string>; measure?: (t: string) => number }) => MindmapLayout;
  let layoutFn = $state<LayoutFn | null>(null);
  let svg = $state<SVGSVGElement>();
  let width = $state(0);
  let height = $state(0);
  let view = $state({ x: 0, y: 0, k: 1 });
  let focusedId = $state<string | null>(null);
  let fittedFor = '';

  onMount(() => {
    void import('../../../../shared/mindmap/mindmap-layout').then((m) => { layoutFn = m.layoutMindmap; });
  });

  // Labels measured as drawn (13px of the app's font); an estimate where nothing can measure.
  let ctx: CanvasRenderingContext2D | null | undefined;
  function measure(text: string): number {
    if (ctx === undefined) {
      ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
      if (ctx) ctx.font = `13px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'system-ui'}`;
    }
    return ctx ? ctx.measureText(text).width : text.length * 7;
  }

  const foldedSet = $derived(new Set(folded));
  const layout = $derived(layoutFn ? layoutFn(tree, { orientation, folded: foldedSet, measure }) : null);
  const byId = $derived(new Map((layout?.nodes ?? []).map((n) => [n.id, n] as const)));
  /** Each node's siblings, for posinset / setsize and ↑ ↓. */
  const siblingsOf = (n: MindmapLayoutNode): string[] => (n.parent ? byId.get(n.parent)!.children : [n.id]);
  const rootId = $derived(layout?.nodes[0]?.id ?? null);

  /** Show the whole map, no closer than 1:1. */
  function fit(): void {
    if (!layout || width === 0 || height === 0) return;
    const b = layout.bounds;
    const pad = 24;
    const k = Math.min(1, (width - pad * 2) / Math.max(1, b.x2 - b.x1), (height - pad * 2) / Math.max(1, b.y2 - b.y1));
    view = { k, x: width / 2 - ((b.x1 + b.x2) / 2) * k, y: height / 2 - ((b.y1 + b.y2) / 2) * k };
  }
  // Fit once per tree and orientation, when there's somewhere to draw.
  $effect(() => {
    const key = `${rootId}|${orientation}|${width > 0 && height > 0}`;
    if (!layout || width === 0 || key === fittedFor) return;
    fittedFor = key;
    untrack(fit);
  });

  function zoomAt(factor: number, cx: number, cy: number): void {
    const k = Math.min(4, Math.max(0.1, view.k * factor));
    const f = k / view.k;
    view = { k, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f };
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = svg!.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }
  let drag = $state<{ x: number; y: number; vx: number; vy: number } | null>(null);
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('[role="treeitem"]')) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    view = { ...view, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y };
  }
  const onPointerUp = () => { drag = null; };

  function toggle(n: MindmapLayoutNode): void {
    if (n.hasChildren) onFold?.(n.id, !n.folded);
  }

  /** Move focus to a node, bringing it into view. */
  async function focusNode(id: string | null | undefined): Promise<void> {
    if (!id || !byId.has(id)) return;
    focusedId = id;
    await tick();
    const n = byId.get(id)!;
    const sx = view.x + n.x * view.k;
    const sy = view.y + n.y * view.k;
    const m = 40;
    if (sx < m || sx > width - m || sy < m || sy > height - m) view = { ...view, x: width / 2 - n.x * view.k, y: height / 2 - n.y * view.k };
    svg?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus();
  }

  function onKeydown(e: KeyboardEvent, n: MindmapLayoutNode): void {
    const sibs = siblingsOf(n);
    const i = sibs.indexOf(n.id);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); void focusNode(sibs[i + 1]); return;
      case 'ArrowUp': e.preventDefault(); void focusNode(sibs[i - 1]); return;
      case 'ArrowLeft': e.preventDefault(); void focusNode(n.parent); return;
      case 'ArrowRight':
        e.preventDefault();
        if (n.folded) { toggle(n); void tick().then(() => focusNode(byId.get(n.id)?.children[0])); } else void focusNode(n.children[0]);
        return;
      case ' ': e.preventDefault(); toggle(n); return;
      case 'Home': e.preventDefault(); void focusNode(rootId); return;
      case 'End': e.preventDefault(); void focusNode(layout?.nodes[layout.nodes.length - 1]?.id); return;
      case 'Enter': e.preventDefault(); onActivate?.(n.id); return;
    }
  }

  /** The node that takes Tab: the focused one, the selected one, or the root. */
  const tabStop = $derived(focusedId && byId.has(focusedId) ? focusedId : selected && byId.has(selected) ? selected : rootId);
</script>

<div class="mm" bind:clientWidth={width} bind:clientHeight={height}>
  <div class="mm-tools">
    <button type="button" class="mm-btn" onclick={fit}>Fit</button>
    <button type="button" class="mm-btn" aria-label="Zoom in" onclick={() => zoomAt(1.25, width / 2, height / 2)}>+</button>
    <button type="button" class="mm-btn" aria-label="Zoom out" onclick={() => zoomAt(0.8, width / 2, height / 2)}>−</button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg} class="mm-svg" class:panning={!!drag} role="tree" aria-label={label} tabindex="-1"
    onwheel={onWheel} onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerUp}
  >
    {#if layout}
      <g transform="translate({view.x} {view.y}) scale({view.k})">
        {#each layout.links as l (l.target)}
          <path class="mm-link" d={l.path} />
        {/each}
        {#each layout.nodes as n (n.id)}
          {@const sibs = siblingsOf(n)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <g
            class="mm-node" class:selected={n.id === selected} class:root={n.depth === 0}
            data-node-id={n.id} role="treeitem" tabindex={n.id === tabStop ? 0 : -1}
            aria-level={n.depth + 1} aria-setsize={sibs.length} aria-posinset={sibs.indexOf(n.id) + 1}
            aria-expanded={n.hasChildren ? !n.folded : undefined} aria-selected={n.id === selected}
            aria-label={n.folded ? `${n.label}, ${n.hiddenCount} hidden` : n.label}
            transform="translate({n.x - n.width / 2} {n.y - n.height / 2})"
            onclick={() => { focusedId = n.id; onSelect?.(n.id); }}
            ondblclick={() => onActivate?.(n.id)}
            onkeydown={(e) => onKeydown(e, n)}
            onfocus={() => (focusedId = n.id)}
          >
            <rect class="mm-box" width={n.width} height={n.height} rx="7" />
            <text class="mm-label" x="10" y="6">
              {#each n.lines as line, li (li)}<tspan x="10" dy={li === 0 ? 13 : 18}>{line}</tspan>{/each}
            </text>
            {#if n.hasChildren}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <g class="mm-fold" transform="translate({orientation === 'ltr' ? n.width : n.width / 2} {orientation === 'ltr' ? n.height / 2 : n.height})" onclick={(e) => { e.stopPropagation(); toggle(n); }} aria-hidden="true">
                <circle r={n.folded ? 10 : 6} />
                <text text-anchor="middle" dominant-baseline="central">{n.folded ? n.hiddenCount : '−'}</text>
              </g>
            {/if}
          </g>
        {/each}
      </g>
    {/if}
  </svg>
</div>

<style>
  .mm { position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: var(--bg); }
  .mm-tools { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; z-index: 1; }
  .mm-btn { font: inherit; font-size: 12px; color: var(--text); background: var(--bg-button); border: 1px solid var(--border); border-radius: 4px; padding: 1px 8px; cursor: pointer; }
  .mm-svg { width: 100%; height: 100%; display: block; cursor: grab; user-select: none; }
  .mm-svg.panning { cursor: grabbing; }
  .mm-svg:focus { outline: none; }
  .mm-link { fill: none; stroke: var(--border-strong); stroke-width: 1.5; }
  .mm-box { fill: var(--bg-elev-2); stroke: var(--border-strong); stroke-width: 1.2; }
  .mm-node.root .mm-box { fill: var(--bg-button); stroke: var(--accent); stroke-width: 2; }
  .mm-node.selected .mm-box { stroke: var(--accent); stroke-width: 2.5; }
  .mm-node { cursor: pointer; outline: none; }
  .mm-node:focus-visible .mm-box { stroke: var(--accent); stroke-width: 3; stroke-dasharray: 4 2; }
  .mm-label { fill: var(--text); font-size: 13px; }
  .mm-fold circle { fill: var(--bg-button); stroke: var(--border-strong); }
  .mm-fold text { fill: var(--text-muted); font-size: 10px; }
  .mm-fold { cursor: pointer; }
</style>
