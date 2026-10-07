<script lang="ts">
  /**
   * Right-click menu for a type view's selected rows (#2431). On a Kanban
   * board it also offers **Move to ▸** (#2603), a submenu listing every column
   * (`moveTargets`); the column the selection is already in is disabled.
   *
   * Keyboard: the menu takes focus when it opens (so Shift+F10 on a card lands
   * in it), ↑/↓ move between items, → or Enter opens Move to, ← closes it, and
   * Escape closes the menu. Focus goes back to whatever had it before.
   */
  import { onMount, tick } from 'svelte';
  import type { MoveTarget } from '../../../shared/objects/kanban-move';

  interface Props {
    x: number;
    y: number;
    count: number;
    onEdit: () => void;
    onClose: () => void;
    /** Kanban only: the columns a card can move to. Absent → no Move to. */
    moveTargets?: MoveTarget[] | undefined;
    /** The value the whole selection already has (undefined = mixed). */
    moveFrom?: string | null | undefined;
    onMove?: ((target: MoveTarget) => void) | undefined;
  }
  let { x, y, count, onEdit, onClose, moveTargets, moveFrom, onMove }: Props = $props();

  let menuEl = $state<HTMLDivElement>();
  let subEl = $state<HTMLDivElement>();
  let subOpen = $state(false);
  let returnFocus: HTMLElement | null = null;

  const items = (root: HTMLElement | undefined) =>
    [...(root?.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]:not(:disabled)') ?? [])];

  onMount(() => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    items(menuEl)[0]?.focus();
    return () => {
      // Give focus back unless the user has already put it somewhere else.
      const active = document.activeElement;
      if (returnFocus?.isConnected && (!active || active === document.body || menuEl?.contains(active) || subEl?.contains(active))) returnFocus.focus();
    };
  });

  async function openSub(): Promise<void> {
    subOpen = true;
    await tick();
    items(subEl)[0]?.focus();
  }
  function closeSub(): void {
    subOpen = false;
    menuEl?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
  }

  function onKeydown(e: KeyboardEvent): void {
    const inSub = !!subEl?.contains(e.target as Node);
    const list = items(inSub ? subEl : menuEl);
    const i = list.indexOf(e.target as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + step + list.length) % list.length]?.focus();
    } else if (e.key === 'ArrowRight' && !inSub && (e.target as HTMLElement).getAttribute('aria-haspopup') === 'menu') {
      e.preventDefault();
      void openSub();
    } else if (e.key === 'ArrowLeft' && inSub) {
      e.preventDefault();
      closeSub();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  }
</script>

<button class="tv-menu-backdrop" aria-label="Close menu" tabindex="-1" onclick={onClose} oncontextmenu={(e) => { e.preventDefault(); onClose(); }}></button>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tv-menu" role="menu" tabindex="-1" style="left:{x}px; top:{y}px" bind:this={menuEl} onkeydown={onKeydown}>
  {#if moveTargets && onMove}
    <button role="menuitem" aria-haspopup="menu" aria-expanded={subOpen} onclick={() => (subOpen ? closeSub() : void openSub())}>
      <span>{count > 1 ? `Move to (${count} cards)` : 'Move to'}</span><span class="tv-menu-arrow" aria-hidden="true">▸</span>
    </button>
    {#if subOpen}
      <div class="tv-menu tv-submenu" role="menu" aria-label="Move to" tabindex="-1" bind:this={subEl}>
        {#each moveTargets as t (t.kind + ':' + (t.value ?? ''))}
          <button role="menuitem" class:tv-menu-novalue={t.kind === 'no-value'} disabled={moveFrom !== undefined && moveFrom === t.value} onclick={() => onMove(t)}>{t.label}</button>
        {/each}
      </div>
    {/if}
  {/if}
  <button role="menuitem" onclick={onEdit}>
    Edit Properties…{#if count > 1} ({count} notes){/if}
  </button>
</div>

<style>
  .tv-menu-backdrop { position: fixed; inset: 0; z-index: 40; background: none; border: none; cursor: default; }
  .tv-menu {
    position: fixed;
    z-index: 41;
    display: flex;
    flex-direction: column;
    min-width: 180px;
    padding: 4px;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  .tv-submenu { position: absolute; left: 100%; top: 0; margin-left: 2px; }
  .tv-menu button {
    display: flex;
    align-items: center;
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
  .tv-menu button:hover:not(:disabled), .tv-menu button:focus-visible { background: color-mix(in oklch, var(--accent) 14%, transparent); outline: none; }
  .tv-menu button:disabled { color: var(--text-muted); cursor: default; }
  .tv-menu-arrow { margin-left: auto; padding-left: 12px; color: var(--text-muted); }
  .tv-menu-novalue { font-style: italic; }
</style>
