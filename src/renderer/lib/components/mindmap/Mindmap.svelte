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
   * - **Editing** (#2965), when the host passes `edit`: Tab adds a child and
   *   Enter a sibling, each then named in place; F2 or a double-click renames
   *   in place; Delete removes; ⌘[ / ⌘] promote and demote; ⌘Z / ⇧⌘Z undo and
   *   redo; dragging a node drops it before, after or into another (by where
   *   on the target it's let go: its top, bottom, or middle). Shift+Tab still
   *   leaves the map. The host makes each edit; the map only asks.
   */
  import { onMount, tick, untrack } from 'svelte';
  import type { MindmapLayout, MindmapLayoutNode, MindmapOrientation, MindmapTree } from '../../../../shared/mindmap/mindmap-layout';
  import type { MindmapEdits } from './mindmap-edits';

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
    /** Editing (#2965): absent, the map is read-only. */
    edit?: MindmapEdits | undefined;
  }
  let { tree, orientation = 'ltr', folded = [], onFold, selected = null, onSelect, onActivate, label = 'Mindmap', edit }: Props = $props();

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
    moved = false;
    untrack(fit);
  });

  /** The map was panned or zoomed by hand: a resize keeps its centre rather than fitting again. */
  let moved = false;
  let lastSize = { w: 0, h: 0 };
  // The panel changing size (the editor shown beside it, a window resize): fit again, unless
  // the map has been moved by hand, in which case the point at its centre stays at its centre.
  $effect(() => {
    const w = width;
    const h = height;
    const was = lastSize;
    lastSize = { w, h };
    if (was.w === 0 || (was.w === w && was.h === h)) return;
    untrack(() => {
      if (!moved) fit();
      else view = { ...view, x: view.x + (w - was.w) / 2, y: view.y + (h - was.h) / 2 };
    });
  });

  function zoomAt(factor: number, cx: number, cy: number): void {
    moved = true;
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
    moved = true;
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
    if (!id) return;
    // After an edit the node arrives with the host's next update, which can take a frame or two: wait for it.
    for (let i = 0; i < 30 && !byId.has(id); i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (!byId.has(id)) return;
    focusedId = id;
    await tick();
    const n = byId.get(id);
    if (!n) return; // gone again meanwhile (deleted, or the map closed)
    const sx = view.x + n.x * view.k;
    const sy = view.y + n.y * view.k;
    const m = 40;
    if (sx < m || sx > width - m || sy < m || sy > height - m) view = { ...view, x: width / 2 - n.x * view.k, y: height / 2 - n.y * view.k };
    svg?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus();
  }

  function onKeydown(e: KeyboardEvent, n: MindmapLayoutNode): void {
    if (edit && editKey(e, n, edit)) return;
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

  // ── Editing (#2965) ────────────────────────────────────────────────────────

  /** The node being named in place, and the text so far. */
  let renaming = $state<{ id: string; text: string; fresh: boolean } | null>(null);
  let renameInput = $state<HTMLInputElement>();

  function editKey(e: KeyboardEvent, n: MindmapLayoutNode, ed: MindmapEdits): boolean {
    const mod = e.metaKey || e.ctrlKey;
    const isRoot = n.depth === 0;
    if (e.key === 'Tab' && !e.shiftKey && !mod && !e.altKey) { e.preventDefault(); void added(ed.addChild(n.id)); return true; }
    if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey) { e.preventDefault(); void added(isRoot ? ed.addChild(n.id) : ed.addSibling(n.id)); return true; }
    if (e.key === 'F2' && !isRoot) { e.preventDefault(); startRename(n.id, n.label, false); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isRoot && !mod) { e.preventDefault(); void removed(n, ed); return true; }
    if (mod && !e.altKey && e.key === '[') { e.preventDefault(); void Promise.resolve(ed.promote(n.id)).then(keepFocus); return true; }
    if (mod && !e.altKey && e.key === ']') { e.preventDefault(); void Promise.resolve(ed.demote(n.id)).then(keepFocus); return true; }
    if (mod && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) ed.redo(); else ed.undo(); return true; }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'y') { e.preventDefault(); ed.redo(); return true; }
    return false;
  }

  /** After an edit the host may give the node a new id (its path): follow it by the id the host returns. */
  function keepFocus(id: string | null | undefined): void {
    void tick().then(() => focusNode(id ?? focusedId));
  }

  async function added(created: Promise<string | null> | string | null): Promise<void> {
    const id = await created;
    if (!id) return;
    await tick();
    await focusNode(id);
    startRename(id, byId.get(id)?.label ?? '', true);
  }

  async function removed(n: MindmapLayoutNode, ed: MindmapEdits): Promise<void> {
    const sibs = siblingsOf(n);
    const i = sibs.indexOf(n.id);
    // Focus goes to the sibling before (its id doesn't change), else the parent.
    const next = sibs[i - 1] ?? n.parent;
    if (await ed.remove(n.id)) keepFocus(next);
  }

  function startRename(id: string, text: string, fresh: boolean): void {
    renaming = { id, text, fresh };
    void tick().then(() => { renameInput?.focus(); renameInput?.select(); });
  }

  async function finishRename(commit: boolean): Promise<void> {
    const r = renaming;
    if (!r || !edit) return;
    renaming = null;
    const before = byId.get(r.id)?.label ?? '';
    let id: string | null = r.id;
    // A node just added and left empty goes again, as if it had never been added.
    if (r.fresh && (!commit || r.text.trim() === '')) { await edit.remove(r.id, { confirmed: true }); id = null; }
    else if (commit && r.text !== before) id = (await edit.rename(r.id, r.text)) ?? r.id;
    keepFocus(id ?? focusedId);
  }

  /** Where the rename field sits: over the node's box, in the map's own coordinates. */
  const renameBox = $derived.by(() => {
    const n = renaming ? byId.get(renaming.id) : null;
    if (!n) return null;
    return { left: view.x + (n.x - n.width / 2) * view.k, top: view.y + (n.y - n.height / 2) * view.k, width: Math.max(120, n.width * view.k), height: n.height * view.k };
  });

  // Dragging a node onto another: before it, after it, or into it.
  let dragging = $state<{ id: string; x: number; y: number; moved: boolean; over: { id: string; where: 'before' | 'after' | 'child' } | null } | null>(null);
  function onNodePointerDown(e: PointerEvent, n: MindmapLayoutNode): void {
    if (!edit || e.button !== 0 || n.depth === 0 || renaming) return;
    dragging = { id: n.id, x: e.clientX, y: e.clientY, moved: false, over: null };
  }
  function onDragMove(e: PointerEvent): void {
    const d = dragging;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGGElement>('[data-node-id]');
    const id = hit?.dataset['nodeId'];
    let over: { id: string; where: 'before' | 'after' | 'child' } | null = null;
    if (hit && id && id !== d.id) {
      const r = hit.getBoundingClientRect();
      const at = (e.clientY - r.top) / Math.max(1, r.height);
      over = { id, where: byId.get(id)?.depth === 0 ? 'child' : at < 0.3 ? 'before' : at > 0.7 ? 'after' : 'child' };
    }
    dragging = { ...d, moved: true, over };
  }
  function onDragEnd(): void {
    const d = dragging;
    dragging = null;
    if (!d?.moved || !d.over || !edit) return;
    void Promise.resolve(edit.drop(d.id, d.over.id, d.over.where)).then((id) => keepFocus(id ?? d.id));
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
    onwheel={onWheel} onpointerdown={onPointerDown}
    onpointermove={(e) => { onPointerMove(e); onDragMove(e); }}
    onpointerup={() => { onPointerUp(); onDragEnd(); }}
    onpointercancel={() => { onPointerUp(); dragging = null; }}
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
            class:drop-before={dragging?.over?.id === n.id && dragging.over.where === 'before'}
            class:drop-after={dragging?.over?.id === n.id && dragging.over.where === 'after'}
            class:drop-child={dragging?.over?.id === n.id && dragging.over.where === 'child'}
            class:dragged={dragging?.moved && dragging.id === n.id}
            onpointerdown={(e) => onNodePointerDown(e, n)}
            onclick={() => { if (dragging?.moved) return; focusedId = n.id; onSelect?.(n.id); }}
            ondblclick={() => { if (edit && n.depth > 0) startRename(n.id, n.label, false); else onActivate?.(n.id); }}
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
  {#if renaming && renameBox}
    <input
      bind:this={renameInput} class="mm-rename" aria-label="Name"
      style="left: {renameBox.left}px; top: {renameBox.top}px; width: {renameBox.width}px; height: {renameBox.height}px"
      bind:value={renaming.text}
      onkeydown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); void finishRename(true); }
        else if (e.key === 'Escape') { e.preventDefault(); void finishRename(false); }
        else if (e.key === 'Tab') { e.preventDefault(); void finishRename(true); }
        e.stopPropagation();
      }}
      onblur={() => { if (renaming) void finishRename(true); }}
    />
  {/if}
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
  .mm-node.dragged { opacity: 0.4; }
  .mm-node.drop-child .mm-box { stroke: var(--accent); stroke-width: 3; }
  .mm-node.drop-before .mm-box, .mm-node.drop-after .mm-box { stroke: var(--accent); stroke-dasharray: 6 3; stroke-width: 2.5; }
  .mm-rename { position: absolute; z-index: 2; box-sizing: border-box; font: inherit; font-size: 13px; padding: 2px 9px; color: var(--text); background: var(--bg); border: 2px solid var(--accent); border-radius: 7px; outline: none; }
</style>
