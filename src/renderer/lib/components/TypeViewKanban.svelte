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
   * - **Read-only.** The board writes nothing yet. Moving a card (#2603) and
   *   reordering columns (#2614) attach to the hooks below rather than
   *   restructuring it: every column carries `data-column-value` (the option,
   *   or `""` for No value) and `data-column-kind`, its header is its own
   *   element (`.kb-col-header`, the column-drag handle), every card carries
   *   `data-note-path`, and keyboard focus is tracked by note path rather than
   *   position, so a card that changes column keeps focus.
   */
  import { tick } from 'svelte';
  import TypeIcon from './TypeIcon.svelte';
  import { selectInstanceCardFields } from '../../../shared/objects/card';
  import type { KanbanColumn } from '../../../shared/objects/kanban';
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
  }
  let { type, properties, group, columns, visible, display, rowType, isSelected, selectable, onCardClick, onCardContextMenu }: Props = $props();

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

  async function focusCard(path: string): Promise<void> {
    focusedPath = path;
    await tick();
    const el = [...(board?.querySelectorAll<HTMLElement>('[data-kanban-card]') ?? [])].find((c) => c.dataset['notePath'] === path);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-kanban-card]');
    const path = card?.dataset['notePath'];
    if (!path) return;
    const next = target(path, e.key);
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
  <div class="kb-board" bind:this={board} onkeydown={onKeydown} data-group-by={group.name}>
    {#each columns as col (columnKey(col))}
      <section class="kb-column" data-column-value={col.value ?? ''} data-column-kind={col.kind}>
        <h2 class="kb-col-header">
          <span class="kb-col-label" class:kb-no-value={col.kind === 'no-value'}>{col.label}</span>
          <span class="kb-col-count">{col.instances.length}</span>
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
                tabindex={inst.path === tabStop ? 0 : -1}
                data-kanban-card
                data-note-path={inst.path}
                title={inst.path}
                onclick={(e) => onCardClick(e, inst.path)}
                oncontextmenu={(e) => onCardContextMenu(e, inst.path)}
                onfocus={() => (focusedPath = inst.path)}
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
  .kb-card.selected { background: color-mix(in oklch, var(--accent) 16%, var(--bg-button)); border-color: var(--accent); }
  .kb-card-title { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
  .kb-fields { display: flex; flex-direction: column; gap: 2px; }
  .kb-field { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kb-flabel { font-weight: 600; }
</style>
