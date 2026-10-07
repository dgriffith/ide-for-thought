<script lang="ts">
  /**
   * A Kanban column header's menu (#2614): **Move column left / right**, the
   * keyboard equivalent of dragging the header (`column-drag.ts`).
   *
   * - The `⋯` button opens it, and so does a right-click anywhere on the
   *   header. ↑/↓ move between the items, Enter/Space activates, and Escape
   *   (or Tab, or a click elsewhere) closes it with focus back on the button.
   * - The button is the header's focus target. It isn't its own tab stop —
   *   the board is one, like its cards — but ↑ from a column's first card
   *   reaches it, and ←/→/Home/End walk the header row (`headerKeydown`), so
   *   an empty column's header is reachable too.
   * - A move at the board's edge is offered but disabled (`aria-disabled`,
   *   still focusable), so the menu keeps its shape.
   */
  import { tick } from 'svelte';
  import { headerKeydown } from './column-drag';

  interface Props {
    /** The column's heading, for the button's accessible name. */
    label: string;
    canMoveLeft: boolean;
    canMoveRight: boolean;
    onMove: (direction: 'left' | 'right') => void;
  }
  let { label, canMoveLeft, canMoveRight, onMove }: Props = $props();

  let open = $state(false);
  let pos = $state({ top: 0, right: 0 });
  let button = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();

  const items = $derived([
    { id: 'left' as const, label: 'Move column left', enabled: canMoveLeft },
    { id: 'right' as const, label: 'Move column right', enabled: canMoveRight },
  ]);

  function menuItems(): HTMLElement[] {
    return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  }

  async function show(at?: { x: number; y: number }): Promise<void> {
    const r = button?.getBoundingClientRect();
    pos = at
      ? { top: at.y, right: Math.max(0, window.innerWidth - at.x) }
      : { top: (r?.bottom ?? 0) + 4, right: Math.max(0, window.innerWidth - (r?.right ?? 0)) };
    open = true;
    await tick();
    (menuItems().find((el) => el.getAttribute('aria-disabled') !== 'true') ?? menuItems()[0])?.focus();
  }
  function close(refocus: boolean): void {
    open = false;
    if (refocus) button?.focus();
  }
  function choose(id: 'left' | 'right', enabled: boolean): void {
    if (!enabled) return;
    close(true);
    onMove(id);
  }

  function onMenuKeydown(e: KeyboardEvent): void {
    const els = menuItems();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
  }

  // A right-click anywhere on the header opens the same menu, at the pointer.
  $effect(() => {
    const header = button?.closest<HTMLElement>('.kb-col-header');
    if (!header) return;
    const onContext = (e: MouseEvent): void => { e.preventDefault(); void show({ x: e.clientX, y: e.clientY }); };
    header.addEventListener('contextmenu', onContext);
    return () => header.removeEventListener('contextmenu', onContext);
  });
  // A press outside the menu closes it, leaving focus where the press put it.
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t && (menu?.contains(t) || button?.contains(t))) return;
      close(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
</script>

<button
  bind:this={button}
  type="button"
  class="kb-col-menu-btn"
  tabindex="-1"
  aria-label="{label} column actions"
  aria-haspopup="menu"
  aria-expanded={open}
  onclick={() => (open ? close(true) : void show())}
  onkeydown={(e) => {
    if (open) return;
    headerKeydown(e);
  }}
>⋯</button>
{#if open}
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="kb-col-menu" role="menu" tabindex="-1" aria-label="{label} column" bind:this={menu} style="top:{pos.top}px; right:{pos.right}px" onkeydown={onMenuKeydown}>
    {#each items as item (item.id)}
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        aria-disabled={!item.enabled}
        onclick={() => choose(item.id, item.enabled)}
      >{item.label}</button>
    {/each}
  </div>
{/if}

<style>
  .kb-col-menu-btn {
    flex: none;
    padding: 0 5px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 13px;
    font-weight: 400;
    line-height: 1.3;
    cursor: pointer;
  }
  .kb-col-menu-btn:hover, .kb-col-menu-btn[aria-expanded='true'] { color: var(--text); border-color: var(--border); }
  .kb-col-menu-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .kb-col-menu {
    position: fixed;
    z-index: 41;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    padding: 4px;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    font-family: var(--font-sans);
    font-weight: 400;
  }
  .kb-col-menu button {
    padding: 5px 8px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }
  .kb-col-menu button:hover, .kb-col-menu button:focus-visible { background: color-mix(in oklch, var(--accent) 14%, transparent); outline: none; }
  .kb-col-menu button[aria-disabled='true'] { color: var(--text-muted); cursor: default; }
  .kb-col-menu button[aria-disabled='true']:hover { background: none; }
</style>
