<script lang="ts">
  /**
   * The Kanban layout of a type view (#2602, epic #2600): one column per
   * option of the grouping enum property, one card per note. `TypeView`
   * scopes, filters and sorts the instances and groups them into `columns`
   * (`boardColumns`, `shared/objects/kanban.ts`); this draws them.
   *
   * - **Cards** are the type's render card (`selectInstanceCardFields`,
   *   `shared/objects/card.ts`): the note's own type icon, its title, and the
   *   view's visible properties — minus the grouping property, which the
   *   column already says. A click goes through the view's selection, as a
   *   list row's does: a plain click opens the note, ⌘/⇧-click selects.
   * - **Accessibility.** Each column is a list labelled with its heading and
   *   count, and each card a list item. The board is one tab stop (a roving
   *   tabindex): ↑/↓ move between a column's cards, ←/→ to the neighbouring
   *   column that has any, Home/End to a column's first/last card, and Enter
   *   opens the focused card (it's a button).
   * - **Moving a card** (#2603): drag it onto another column (pointer events,
   *   `kanban/card-drag.ts`), or Shift+F10 / the ContextMenu key for the
   *   card's menu and its *Move to ▸*; ⌘Z on the board undoes the last move.
   *   The write is the host's (`onMove`, the `kanban-moves` store). Every
   *   column carries `data-column-value` (the option, or `""` for No value)
   *   and `data-column-kind`, its header is its own element (`.kb-col-header`,
   *   the column-drag handle), every card carries `data-note-path`,
   *   and keyboard focus is tracked by note path rather than position, so a
   *   card that changes column keeps focus.
   * - **Column order** (#2614) is wired onto the header and lives in
   *   `kanban/`: drag a header (`column-drag.ts`) or use its menu's *Move
   *   column left / right* (`KanbanColumnMenu.svelte`; ↑ from a column's first
   *   card reaches it). Both hand `onMoveColumn` a (key, target, side) triple;
   *   without `onMoveColumn` (an embed, an export) the header is inert.
   * - **Export mode** (#2604, `exportMode`): the board an export snapshots
   *   (`renderObjectViewForExport`). A page is 760px wide and a PDF can't
   *   scroll, so the columns WRAP onto further rows (a grid) instead of
   *   scrolling sideways; headers don't stick; a long column label or field
   *   value wraps rather than truncating, since nobody can hover it; cards
   *   take no tab stop and avoid splitting across a printed page. Moves and
   *   column moves are already off (no `onMove` / `onMoveColumn`); the
   *   snapshot links each card by its `data-note-path`.
   * - **Hover preview** (#2710): hovering a card, or focusing it, shows the
   *   shared `NoteHoverPreview` — the title and snippet a `[[link]]` to the
   *   note shows, with the card's fields under it. It replaced the native
   *   `title` tooltip, which showed the file path. Not in an export.
   */
  import { tick, untrack } from 'svelte';
  import TypeIcon from './TypeIcon.svelte';
  import NoteHoverPreview from './NoteHoverPreview.svelte';
  import { createNoteHover } from './note-hover/note-hover.svelte';
  import { cardDrag, cardMoveKey, openCardMenu } from './kanban/card-drag';
  import { getKanbanMoveStore } from '../stores/kanban-moves.svelte';
  import type { MoveTarget } from '../../../shared/objects/kanban-move';
  import KanbanColumnMenu from './kanban/KanbanColumnMenu.svelte';
  import { afterColumnMove, columnDrag, focusColumnHeader, type DropSide } from './kanban/column-drag';
  import { selectInstanceCardFields } from '../../../shared/objects/card';
  import { columnKey as orderKey, type KanbanColumn } from '../../../shared/objects/kanban';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../shared/objects/type-def';

  interface Props {
    /** The view's type (its card template and cover). */
    type: TypeInfo;
    /** The type's effective properties. */
    properties: PropertyDef[];
    /** The grouping enum property; null when the type has none (no board). */
    group: PropertyDef | null;
    /** The board's columns, cards in the view's sort order. */
    columns: KanbanColumn[];
    /** The view's visible properties (null = the type's card template). */
    visible: string[] | null;
    display: (prop: PropertyDef, value: string | null) => string;
    /** A card's own type — a subtype instance shows its own icon. */
    rowType: (inst: TypeInstanceRow) => TypeInfo | null;
    isSelected: (path: string) => boolean;
    /** Rows multi-select (the panel); false in an embed or export. */
    selectable: boolean;
    onCardClick: (e: MouseEvent, path: string) => void;
    onCardContextMenu: (e: MouseEvent, path: string) => void;
    /** Move a card to a column (#2603); absent → cards don't move (an embed). */
    onMove?: ((path: string, target: MoveTarget) => void) | undefined;
    onUndoMove?: (() => void) | undefined;
    /** Reorder columns (#2614): move `key` to `side` of the visible column
     *  `target`. Absent → the columns can't be moved. */
    onMoveColumn?: (key: string, target: string, side: DropSide) => void;
    /** Draw for an export snapshot (#2604): wrapped columns, nothing to focus. */
    exportMode?: boolean;
  }
  let { type, properties, group, columns, visible, display, rowType, isSelected, selectable, onCardClick, onCardContextMenu, onMove, onUndoMove, onMoveColumn, exportMode = false }: Props = $props();

  const byName = $derived(new Map(properties.map((p) => [p.name, p] as const)));
  function fieldsFor(inst: TypeInstanceRow) {
    return selectInstanceCardFields(type, properties, inst, { visible, omit: group ? [group.name] : [] });
  }
  function fieldText(name: string, value: string): string {
    const prop = byName.get(name);
    return prop ? display(prop, value) : value;
  }
  function columnKey(col: KanbanColumn): string {
    return col.kind === 'no-value' ? 'no-value' : `${col.kind}:${col.value}`;
  }
  function countLabel(n: number): string {
    return `${n} ${n === 1 ? 'card' : 'cards'}`;
  }

  const uid = $props.id();
  const hover = createNoteHover();
  const hoverId = `${uid}-preview`;
  const hoverInst = $derived.by<TypeInstanceRow | null>(() => {
    const key = hover.current?.key;
    if (!key) return null;
    for (const col of columns) {
      const hit = col.instances.find((i) => i.path === key);
      if (hit) return hit;
    }
    return null;
  });
  const subjectFor = (inst: TypeInstanceRow, anchor: Element) => ({ key: inst.path, target: inst.path, anchor, fallbackTitle: inst.title });

  let board = $state<HTMLDivElement>();
  /** The card in the tab order (roving tabindex), by note path. */
  let focusedPath = $state<string | null>(null);
  /** The tab stop: the last-focused card while it's on the board, else the first card. */
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
    // The nearest column that way with any cards, at the same row or its last.
    for (let c = ci + step; c >= 0 && c < columns.length; c += step) {
      const next = columns[c]!.instances;
      if (next.length > 0) return next[Math.min(ri, next.length - 1)]!.path;
    }
    return null;
  }

  /** Column moves (#2614): a header drag, or the menu's left/right (keyboard). */
  function moveColumn(col: KanbanColumn, target: string, side: DropSide, focus: boolean): void {
    onMoveColumn?.(orderKey(col), target, side);
    void afterColumnMove(() => board, orderKey(col), col.label, { focus });
  }
  function moveBy(i: number, dir: 'left' | 'right'): void {
    const next = columns[dir === 'left' ? i - 1 : i + 1];
    if (next) moveColumn(columns[i]!, orderKey(next), dir === 'left' ? 'before' : 'after', true);
  }

  async function focusCard(path: string): Promise<void> {
    focusedPath = path;
    await tick();
    const el = [...(board?.querySelectorAll<HTMLElement>('[data-kanban-card]') ?? [])].find((c) => c.dataset['notePath'] === path);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // A moved card is redrawn in its new column: keep focus on it (#2603).
  const moves = getKanbanMoveStore();
  let refocus: string | null = null;
  $effect(() => {
    const m = moves.lastMove;
    untrack(() => {
      if (m && focusedPath && m.paths.includes(focusedPath) && board?.contains(document.activeElement)) refocus = focusedPath;
    });
  });
  $effect(() => {
    void columns;
    if (!refocus) return;
    const active = document.activeElement;
    if (active && active !== document.body && !board?.contains(active)) { refocus = null; return; } // focus went elsewhere
    const path = refocus;
    const el = [...(board?.querySelectorAll<HTMLElement>('[data-kanban-card]') ?? [])].find((c) => c.dataset['notePath'] === path);
    if (el && el !== active) { refocus = null; void focusCard(path); }
  });

  function onKeydown(e: KeyboardEvent): void {
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-kanban-card]');
    const moveKey = onMove ? cardMoveKey(e) : null;
    if (moveKey) {
      e.preventDefault();
      if (moveKey === 'undo') onUndoMove?.();
      else if (card) openCardMenu(card);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const path = card?.dataset['notePath'];
    if (!path) return;
    const next = target(path, e.key);
    if (next === null && e.key === 'ArrowUp' && onMoveColumn && focusColumnHeader(card?.closest('.kb-column'))) {
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

{#if !group}
  <p class="kb-empty">This type has no choice property to group by.</p>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="kb-board" class:kb-export={exportMode} bind:this={board} onkeydown={onKeydown} data-group-by={group.name} use:cardDrag={{ enabled: !!onMove, onDrop: (p, t) => onMove?.(p, t) }}>
    {#each columns as col, ci (columnKey(col))}
      <section class="kb-column" data-column-value={col.value ?? ''} data-column-kind={col.kind}>
        <h2 class="kb-col-header" use:columnDrag={{ key: orderKey(col), enabled: !!onMoveColumn, onDrop: (_k, t, side) => moveColumn(col, t, side, false) }}>
          <span class="kb-col-label" class:kb-no-value={col.kind === 'no-value'}>{col.label}</span>
          <span class="kb-col-count">{col.instances.length}</span>
          {#if onMoveColumn}<KanbanColumnMenu label={col.label} canMoveLeft={ci > 0} canMoveRight={ci < columns.length - 1} onMove={(dir) => moveBy(ci, dir)} />{/if}
        </h2>
        <ul class="kb-cards" class:kb-cards-empty={col.instances.length === 0} aria-label="{col.label}, {countLabel(col.instances.length)}">
          {#each col.instances as inst (inst.path)}
            {@const rt = rowType(inst)}
            {@const fields = fieldsFor(inst)}
            <li class="kb-item">
              <button
                class="kb-card"
                class:selected={isSelected(inst.path)}
                aria-pressed={selectable ? isSelected(inst.path) : undefined}
                tabindex={exportMode ? undefined : inst.path === tabStop ? 0 : -1}
                data-kanban-card
                data-note-path={inst.path}
                aria-describedby={!exportMode && hover.current?.key === inst.path ? hoverId : undefined}
                onclick={(e) => onCardClick(e, inst.path)}
                oncontextmenu={(e) => onCardContextMenu(e, inst.path)}
                onfocus={(e) => { focusedPath = inst.path; if (!exportMode) hover.focus(subjectFor(inst, e.currentTarget)); }}
                onblur={() => hover.blur(inst.path)}
                onpointerenter={(e) => { if (!exportMode) hover.pointerEnter(subjectFor(inst, e.currentTarget)); }}
                onpointerleave={() => hover.pointerLeave(inst.path)}
              >
                <span class="kb-card-title">
                  {#if rt}<TypeIcon type={rt} size={13} />{/if}
                  <span class="kb-card-name">{inst.title}</span>
                </span>
                {#if fields.length > 0}
                  <span class="kb-fields">
                    {#each fields as f (f.name)}
                      <span class="kb-field"><span class="kb-flabel">{f.label}</span> <span class="kb-fval">{fieldText(f.name, f.value ?? '')}</span></span>
                    {/each}
                  </span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if col.instances.length === 0}<p class="kb-none">No cards</p>{/if}
      </section>
    {/each}
  </div>
  {#if !exportMode}
    <NoteHoverPreview
      id={hoverId}
      {hover}
      instance={hoverInst ? { type, properties, inst: hoverInst, display, rowType: rowType(hoverInst), visible, omit: group ? [group.name] : [] } : null}
    />
  {/if}
{/if}

<style>
  .kb-empty { padding: 24px 16px; color: var(--text-muted); font-size: 13px; }
  /* The board scrolls both ways as one region (it always holds the tab stop,
     so keyboard users can reach everything in it); columns take their
     content's height, and their headers stick while the cards scroll. */
  .kb-board {
    flex: 1;
    min-height: 0;
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
    /* Explicit, so a note's preview heading styles don't reach an embedded board. */
    font-family: var(--font-sans);
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.4;
  }
  /* Column drag (#2614, kanban/column-drag.ts): the dragged column dims, and
     an accent bar in the gap marks where it will land. */
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
  .kb-fields { display: flex; flex-direction: column; gap: 2px; }
  .kb-field { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kb-flabel { font-weight: 600; }

  /* Export mode (#2604): the columns wrap within the page — equal widths on
     every row, as many as fit (three across the 760px export block or a
     72ch export page, reflowing to a printed page) — and everything shows in full. */
  .kb-board.kb-export {
    flex: none;
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
  /* A card the export's link policy left unlinked is plain text: no hover. */
  .kb-export .kb-card:not([href]):hover { border-color: var(--border); }
</style>
