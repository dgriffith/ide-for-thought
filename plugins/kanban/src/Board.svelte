<script lang="ts">
  /**
   * The Kanban board (#2602, epic #2600), drawn by the built-in Kanban plugin
   * in a plugin frame since #2828 — on the plugin API like any plugin. The
   * host (`TypeView`) scopes, filters, sorts and groups the view's notes, and
   * prepares each card (#2828 decision a); this draws them.
   *
   * - **Cards** are the type's render card, as the app would draw it: the
   *   note's own type icon, its title, and the view's visible properties —
   *   minus the grouping property, which the column already says. A click is
   *   the view's own (`view.click`): a plain click opens the note, ⌘/⇧-click
   *   selects (#2828 decision b).
   * - **Accessibility.** Each column is a list labelled with its heading and
   *   count, and each card a list item. The board is one tab stop (a roving
   *   tabindex): ↑/↓ move between a column's cards, ←/→ to the neighbouring
   *   column that has any, Home/End to a column's first/last card, and Enter
   *   opens the focused card (it's a button). ⌘A selects every card, Escape
   *   clears the selection — and, with nothing selected, gives focus back to
   *   Minerva.
   * - **Moving a card** (#2603): drag it onto another column (pointer events,
   *   `card-drag.ts`), or Shift+F10 / the ContextMenu key for the card's menu
   *   (Minerva's own, `ui.showNoteMenu`) and its *Move to ▸*; ⌘Z on the board
   *   undoes the last move. The host makes the move, with its undo
   *   (`view.moveCard`, `view.undoMove` — #2828 decision 2). Every column
   *   carries `data-column-value` and `data-column-kind`, its header is its own
   *   element (`.kb-col-header`, the column-drag handle), every card carries
   *   `data-note-path`, and keyboard focus is tracked by note path, so a card
   *   that changes column keeps focus.
   * - **Column order** (#2614): drag a header (`column-drag.ts`) or use its
   *   menu's *Move column left / right* (`ColumnMenu.svelte`; ↑ from a
   *   column's first card reaches it). Both end in `view.moveColumn`; in an
   *   embed or export the header is inert.
   * - **Export mode** (#2604): the columns WRAP onto further rows (a grid)
   *   instead of scrolling sideways; headers don't stick; long text wraps;
   *   cards are plain elements, not buttons. `App.svelte` inlines the styles
   *   and hands the markup to Minerva (`view.provideExport`, #2828 decision c).
   * - **Hover preview** (#2710): hovering a card, or focusing it, shows
   *   Minerva's own preview beside it (`ui.previewNote`). Not in an export.
   */
  import { tick, untrack } from 'svelte';
  import type { MinervaPlugin, PluginViewInstance, PluginViewState } from '/@minerva/plugin-api.js';
  import ColumnMenu from './ColumnMenu.svelte';
  import { cardDrag, cardMoveKey, openCardMenu } from './card-drag';
  import { afterColumnMove, columnDrag, focusColumnHeader, type DropSide } from './column-drag';
  import { isMenuKey, openMenuAt } from './keys';

  interface Props {
    minerva: MinervaPlugin;
    view: PluginViewState;
  }
  let { minerva, view }: Props = $props();
  // The board's own element: its keyboard, focus and column moves use it.
  let el = $state<HTMLDivElement | undefined>();

  const exportMode = $derived(view.exportMode);
  const byPath = $derived(new Map(view.instances.map((i) => [i.path, i] as const)));
  /** The board's columns, cards in the view's order. */
  const columns = $derived(view.groups.map((g) => ({ ...g, instances: g.paths.map((p) => byPath.get(p)).filter((i): i is PluginViewInstance => !!i) })));
  type Column = (typeof columns)[number];
  const selected = $derived(new Set(view.selected));
  const quietly = (p: Promise<unknown>) => { p.catch(() => undefined); };

  function countLabel(n: number): string {
    return `${n} ${n === 1 ? 'card' : 'cards'}`;
  }

  // ── Talking to Minerva ──
  function onCardClick(e: MouseEvent, path: string): void {
    quietly(minerva.view.click({ path, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey }));
  }
  function onCardContextMenu(e: MouseEvent, path: string): void {
    if (!view.rowMenu) return;
    e.preventDefault();
    // A selected card's menu is the selection's; any other card's, its own.
    const paths = view.selectable && selected.has(path) ? view.selected : [path];
    quietly(minerva.ui.showNoteMenu({ paths, x: e.clientX, y: e.clientY }));
  }
  function onRefContextMenu(e: MouseEvent, ref: string, label: string): void {
    e.preventDefault();
    e.stopPropagation(); // not the card's own menu as well
    quietly(minerva.ui.showNoteMenu({ paths: [ref], x: e.clientX, y: e.clientY, target: true, label }));
  }
  /** A focused note name on a card (#2775): Enter, Space or the menu key open ITS menu (#2776). */
  function refKey(e: KeyboardEvent): void {
    if (!isMenuKey(e) && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.currentTarget as HTMLElement);
  }
  const announce = (text: string) => quietly(minerva.ui.announce({ text }));

  // The card's accessible description: what Minerva's preview of it says
  // (`preview` event, #2828) — `aria-describedby` can't reach that tooltip,
  // outside the frame, so its text is mirrored here.
  let description = $state<{ path: string; text: string } | null>(null);
  $effect(() => minerva.on('preview', ({ path, description: text }) => {
    description = text ? { path, text } : description?.path === path ? null : description;
  }));

  function preview(path: string, el: HTMLElement, via: 'pointer' | 'focus'): void {
    if (exportMode) return;
    const r = el.getBoundingClientRect();
    quietly(minerva.ui.previewNote({ path, x: r.left, y: r.top, width: r.width, height: r.height, via }));
  }
  function unpreview(path: string, via: 'pointer' | 'focus'): void {
    if (!exportMode) quietly(minerva.ui.hidePreview({ path, via }));
  }

  /** The card in the tab order (roving tabindex), by note path. */
  let focusedPath = $state<string | null>(null);
  const tabStop = $derived.by<string | null>(() => {
    const all = columns.flatMap((c) => c.instances.map((i) => i.path));
    return focusedPath && all.includes(focusedPath) ? focusedPath : all[0] ?? null;
  });

  /** Where an arrow key from `path` goes, or null to stay put. */
  function target(path: string, key: string): string | null {
    const ci = columns.findIndex((c) => c.instances.some((i) => i.path === path));
    if (ci === -1) return null;
    const cards = columns[ci]!.instances;
    const ri = cards.findIndex((i) => i.path === path);
    if (key === 'ArrowUp') return cards[ri - 1]?.path ?? null;
    if (key === 'ArrowDown') return cards[ri + 1]?.path ?? null;
    if (key === 'Home') return cards[0]?.path ?? null;
    if (key === 'End') return cards[cards.length - 1]?.path ?? null;
    const step = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
    if (step === 0) return null;
    for (let c = ci + step; c >= 0 && c < columns.length; c += step) {
      const next = columns[c]!.instances;
      if (next.length > 0) return next[Math.min(ri, next.length - 1)]!.path;
    }
    return null;
  }

  /** Column moves (#2614): a header drag, or the menu's left/right (keyboard).
   *  The new order comes back in a later view event, so the announcement and
   *  the focus wait for the board to be redrawn with it. */
  let pendingColumnMove: { key: string; label: string; focus: boolean } | null = null;
  function moveColumn(col: Column, targetKey: string, side: DropSide, focus: boolean): void {
    if (view.readOnly) return;
    pendingColumnMove = { key: col.key, label: col.label, focus };
    quietly(minerva.view.moveColumn({ key: col.key, target: targetKey, side }));
  }
  $effect(() => {
    void columns;
    const moved = pendingColumnMove;
    if (!moved) return;
    pendingColumnMove = null;
    void afterColumnMove(() => el, moved.key, moved.label, { focus: moved.focus, announce });
  });
  function moveBy(i: number, dir: 'left' | 'right'): void {
    const next = columns[dir === 'left' ? i - 1 : i + 1];
    if (next) moveColumn(columns[i]!, next.key, dir === 'left' ? 'before' : 'after', true);
  }

  async function focusCard(path: string): Promise<void> {
    focusedPath = path;
    await tick();
    const card = [...(el?.querySelectorAll<HTMLElement>('[data-kanban-card]') ?? [])].find((c) => c.dataset['notePath'] === path);
    card?.focus();
    card?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // A moved card is redrawn in its new column: keep focus on it (#2603). The
  // new columns and `lastMove` arrive in ONE view event, so this is one effect
  // over both, once per move: the card's old element may already be gone and
  // the frame's focus fallen to <body> (or left on the detached element) —
  // that counts as still on the board; focus moved anywhere else doesn't.
  //
  // A move can also be followed by more redraws (the view refetching its
  // notes) that replace the card's element, and a move picked from the app's
  // menu lands while the frame isn't focused at all. So the moved card is
  // HELD: each redraw puts focus back on it if focus has fallen off the board,
  // until the user puts focus somewhere else themselves.
  let refocusedSeq = -1;
  let heldPath: string | null = null;
  const fellOff = () => {
    const active = document.activeElement;
    return !active || active === document.body || !active.isConnected;
  };
  $effect(() => {
    const m = view.lastMove;
    void columns;
    untrack(() => {
      if (m && m.seq !== refocusedSeq) {
        refocusedSeq = m.seq;
        if (!focusedPath || !m.paths.includes(focusedPath)) return;
        const active = document.activeElement;
        if (fellOff() || !!(active && el?.contains(active))) {
          heldPath = focusedPath;
          void focusCard(focusedPath);
        }
        return;
      }
      if (heldPath && fellOff()) void focusCard(heldPath);
    });
  });
  // The frame getting focus back (the app's menu closing) lands on <body> if
  // the held card was redrawn meanwhile.
  $effect(() => {
    const regain = () => { if (heldPath && fellOff()) void focusCard(heldPath); };
    window.addEventListener('focus', regain);
    return () => window.removeEventListener('focus', regain);
  });
  /** Focus the user moved themselves ends the hold. */
  function releaseHold(e: FocusEvent): void {
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-kanban-card]');
    if (heldPath && card?.dataset['notePath'] !== heldPath) heldPath = null;
  }

  function onKeydown(e: KeyboardEvent): void {
    // The view's own selection (#2828 b): ⌘A, and Escape while anything is selected.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a' && view.selectable) {
      e.preventDefault();
      quietly(minerva.view.selectAll());
      return;
    }
    if (e.key === 'Escape' && view.selected.length > 0) {
      e.preventDefault(); // not "give focus back" — that's for an Escape with nothing to clear
      quietly(minerva.view.clearSelection());
      return;
    }
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-kanban-card]');
    // The menu key works on any card with a menu (#2776); Undo only where cards move.
    const key = cardMoveKey(e);
    const moveKey = key === 'menu' || (key === 'undo' && view.movable) ? key : null;
    if (moveKey) {
      e.preventDefault();
      if (moveKey === 'undo') quietly(minerva.view.undoMove());
      else if (card) openCardMenu(card);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const path = card?.dataset['notePath'];
    if (!path) return;
    const next = target(path, e.key);
    if (next === null && e.key === 'ArrowUp' && !view.readOnly && focusColumnHeader(card?.closest('.kb-column'))) {
      e.preventDefault();
      return;
    }
    if (next === null) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) e.preventDefault();
      return;
    }
    e.preventDefault();
    void focusCard(next);
  }
</script>

{#if view.groupProperty === null}
  <p class="kb-empty">This type has no choice property to group by.</p>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="kb-board"
    class:kb-export={exportMode}
    bind:this={el}
    onkeydown={onKeydown}
    onfocusin={releaseHold}
    onpointerdown={() => { heldPath = null; }}
    data-group-by={view.groupProperty}
    use:cardDrag={{ enabled: view.movable, onDrop: (p, t) => quietly(minerva.view.moveCard({ path: p, target: t })) }}
  >
    {#each columns as col, ci (col.key + col.kind)}
      <section class="kb-column" data-column-value={col.value ?? ''} data-column-kind={col.kind}>
        <h2 class="kb-col-header" use:columnDrag={{ key: col.key, enabled: !view.readOnly, onDrop: (_k, t, side) => moveColumn(col, t, side, false) }}>
          <span class="kb-col-label" class:kb-no-value={col.kind === 'no-value'}>{col.label}</span>
          <span class="kb-col-count">{col.instances.length}</span>
          {#if !view.readOnly}<ColumnMenu label={col.label} canMoveLeft={ci > 0} canMoveRight={ci < columns.length - 1} onMove={(dir) => moveBy(ci, dir)} />{/if}
        </h2>
        <ul class="kb-cards" class:kb-cards-empty={col.instances.length === 0} aria-label="{col.label}, {countLabel(col.instances.length)}">
          {#each col.instances as inst (inst.path)}
            <li class="kb-item">
              {#if exportMode}
                <div class="kb-card" data-kanban-card data-note-path={inst.path}>
                  {@render cardBody(inst)}
                </div>
              {:else}
                <button
                  class="kb-card"
                  class:selected={selected.has(inst.path)}
                  aria-pressed={view.selectable ? selected.has(inst.path) : undefined}
                  tabindex={inst.path === tabStop ? 0 : -1}
                  data-kanban-card
                  data-note-path={inst.path}
                  aria-describedby={description?.path === inst.path ? 'kb-card-description' : undefined}
                  onclick={(e) => onCardClick(e, inst.path)}
                  oncontextmenu={(e) => onCardContextMenu(e, inst.path)}
                  onfocus={(e) => { focusedPath = inst.path; preview(inst.path, e.currentTarget, 'focus'); }}
                  onblur={() => unpreview(inst.path, 'focus')}
                  onpointerenter={(e) => preview(inst.path, e.currentTarget, 'pointer')}
                  onpointerleave={() => unpreview(inst.path, 'pointer')}
                >
                  {@render cardBody(inst)}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if col.instances.length === 0}<p class="kb-none">No cards</p>{/if}
      </section>
    {/each}
  </div>
{/if}

{#if description}<div id="kb-card-description" class="kb-visually-hidden">{description.text}</div>{/if}

{#snippet cardBody(inst: PluginViewInstance)}
  <span class="kb-card-title">
    {#if inst.icon}<span class="type-icon" role="img" aria-label={inst.icon.label} title={inst.icon.label} style:color={inst.icon.color ?? null}>{inst.icon.glyph}</span>{/if}
    <span class="kb-card-name">{inst.title}</span>
  </span>
  {#if inst.fields.length > 0}
    <span class="kb-fields">
      {#each inst.fields as f (f.name)}
        <span class="kb-field"><span class="kb-flabel">{f.label}</span> {#if f.ref && !exportMode && view.rowMenu}<span class="kb-fval tv-ref" role="button" tabindex="0" aria-haspopup="menu" onkeydown={refKey} data-ref-path={f.ref} oncontextmenu={(e) => onRefContextMenu(e, f.ref!, f.text)}>{f.text}</span>{:else}<span class="kb-fval">{f.text}</span>{/if}</span>
      {/each}
    </span>
  {/if}
{/snippet}

<style>
  .kb-empty { padding: 24px 16px; color: var(--text-muted); font-size: 13px; }
  .kb-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  /* The board scrolls both ways as one region (it always holds the tab stop,
     so keyboard users can reach everything in it); columns take their
     content's height, and their headers stick while the cards scroll. */
  .kb-board {
    height: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    overflow: auto;
  }
  .kb-column {
    position: relative;
    flex: 0 0 248px;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in oklch, var(--text) 3%, var(--bg));
  }
  .kb-col-header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    border-radius: 8px 8px 0 0;
    background: var(--bg-button);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.4;
  }
  /* Column drag (#2614, column-drag.ts): the dragged column dims, and an
     accent bar in the gap marks where it will land. */
  .kb-col-header:global([data-draggable]) { cursor: grab; user-select: none; }
  .kb-board:global([data-column-dragging]) .kb-col-header { cursor: grabbing; }
  .kb-column:global([data-dragging]) { opacity: 0.55; outline: 2px dashed var(--accent); outline-offset: -2px; }
  .kb-column:global([data-drop-side])::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .kb-column:global([data-drop-side='before'])::before { left: -8px; }
  .kb-column:global([data-drop-side='after'])::before { right: -8px; }
  .kb-col-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kb-no-value { font-style: italic; }
  .kb-col-count {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .kb-cards { list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .kb-cards-empty { padding: 0; }
  .kb-none { margin: 0; padding: 10px; font-size: 11.5px; color: var(--text-muted); text-align: center; }
  .kb-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }
  .kb-card:hover { border-color: var(--accent); }
  .kb-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  /* Moving a card (#2603): the card being dragged, and the column it'd land in. */
  .kb-column:global([data-drop-target]) { border-color: var(--accent); background: color-mix(in oklch, var(--accent) 10%, var(--bg)); outline: 1px solid var(--accent); }
  .kb-card:global([data-dragging]) { opacity: 0.45; border-style: dashed; }
  .kb-card.selected { background: color-mix(in oklch, var(--accent) 16%, var(--bg-button)); border-color: var(--accent); }
  .kb-card-title { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
  .type-icon { display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; font-size: 12px; line-height: 1; flex: none; }
  .kb-fields { display: flex; flex-direction: column; gap: 2px; }
  .tv-ref { text-decoration: underline dotted color-mix(in oklch, var(--text) 35%, transparent); text-underline-offset: 2px; }
  .kb-field { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kb-flabel { font-weight: 600; }

  /* Export mode (#2604): the columns wrap within the page — equal widths on
     every row, as many as fit — and everything shows in full. */
  .kb-board.kb-export {
    height: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    align-items: start;
    overflow: visible;
  }
  .kb-export .kb-column { min-width: 0; }
  .kb-export .kb-col-header { position: static; break-after: avoid; }
  .kb-export .kb-col-label { white-space: normal; overflow-wrap: anywhere; }
  .kb-export .kb-field { white-space: normal; overflow-wrap: anywhere; }
  .kb-export .kb-card { cursor: auto; break-inside: avoid; }
</style>
