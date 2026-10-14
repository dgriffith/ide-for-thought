<script lang="ts">
  /**
   * Right-click menu for a type view's selected rows (#2431). It offers:
   * - **Move to ▸** (#2603), on a Kanban board only: every column, with the
   *   one the selection is already in disabled;
   * - **Add Tag…**, **Remove Tag ▸** (the selection's tags, with counts),
   *   **Set Property ▸** (the type's properties, each opening its own value
   *   widget) and **Clear Property ▸** (the properties the selection has set)
   *   (#2773) — when the host supplies them;
   * - **Edit Properties…**, the whole bulk panel.
   *
   * Keyboard: the menu takes focus when it opens (so Shift+F10 on a card lands
   * in it), ↑/↓ move between items, → or Enter opens a submenu, ← closes it,
   * and Escape closes the menu. Focus goes back to whatever had it before.
   */
  import { onMount, tick } from 'svelte';
  import type { MoveTarget } from '../../../shared/objects/kanban-move';
  import type { MenuChoice } from './type-view/note-actions';

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
    /** Note actions (#2773). Absent → the items aren't offered. */
    onAddTag?: (() => void) | undefined;
    removeTags?: MenuChoice[] | undefined;
    onRemoveTag?: ((tag: string) => void) | undefined;
    setProperties?: MenuChoice[] | undefined;
    onSetProperty?: ((name: string) => void) | undefined;
    clearProperties?: MenuChoice[] | undefined;
    onClearProperty?: ((name: string) => void) | undefined;
  }
  let {
    x, y, count, onEdit, onClose, moveTargets, moveFrom, onMove,
    onAddTag, removeTags = [], onRemoveTag, setProperties = [], onSetProperty, clearProperties = [], onClearProperty,
  }: Props = $props();

  type Sub = 'move' | 'removeTag' | 'setProperty' | 'clearProperty';
  let menuEl = $state<HTMLDivElement>();
  let subEl = $state<HTMLDivElement>();
  let openSubName = $state<Sub | null>(null);
  let returnFocus: HTMLElement | null = null;

  const items = (root: HTMLElement | undefined) =>
    [...(root?.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]:not(:disabled)') ?? [])];
  const notes = $derived(count > 1 ? ` (${count} notes)` : '');

  onMount(() => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    items(menuEl)[0]?.focus();
    return () => {
      // Give focus back unless the user has already put it somewhere else.
      const active = document.activeElement;
      if (returnFocus?.isConnected && (!active || active === document.body || menuEl?.contains(active) || subEl?.contains(active))) returnFocus.focus();
    };
  });

  async function openSub(name: Sub): Promise<void> {
    openSubName = name;
    await tick();
    items(subEl)[0]?.focus();
  }
  function closeSub(): void {
    const name = openSubName;
    openSubName = null;
    menuEl?.querySelector<HTMLButtonElement>(`[data-sub="${name}"]`)?.focus();
  }
  const toggleSub = (name: Sub) => (openSubName === name ? closeSub() : void openSub(name));

  function onKeydown(e: KeyboardEvent): void {
    const inSub = !!subEl?.contains(e.target as Node);
    const list = items(inSub ? subEl : menuEl);
    const i = list.indexOf(e.target as HTMLButtonElement);
    const sub = (e.target as HTMLElement).dataset.sub as Sub | undefined;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + step + list.length) % list.length]?.focus();
    } else if (e.key === 'ArrowRight' && !inSub && sub) {
      e.preventDefault();
      void openSub(sub);
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

{#snippet subTrigger(name: Sub, label: string, disabled: boolean)}
  <button role="menuitem" data-sub={name} aria-haspopup="menu" aria-expanded={openSubName === name} {disabled} onclick={() => toggleSub(name)}>
    <span>{label}</span><span class="tv-menu-arrow" aria-hidden="true">▸</span>
  </button>
{/snippet}

{#snippet choices(name: Sub, label: string, list: MenuChoice[], pickOne: (key: string) => void, showCount: boolean)}
  {#if openSubName === name}
    <div class="tv-menu tv-submenu" role="menu" aria-label={label} tabindex="-1" bind:this={subEl}>
      {#each list as c (c.key)}
        <button role="menuitem" onclick={() => pickOne(c.key)}>
          <span>{c.label}</span>{#if showCount && count > 1}<span class="tv-menu-count">{c.count}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<button class="tv-menu-backdrop" aria-label="Close menu" tabindex="-1" onclick={onClose} oncontextmenu={(e) => { e.preventDefault(); onClose(); }}></button>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tv-menu" role="menu" tabindex="-1" style="left:{x}px; top:{y}px" bind:this={menuEl} onkeydown={onKeydown}>
  {#if moveTargets && onMove}
    {@render subTrigger('move', count > 1 ? `Move to (${count} cards)` : 'Move to', false)}
    {#if openSubName === 'move'}
      <div class="tv-menu tv-submenu" role="menu" aria-label="Move to" tabindex="-1" bind:this={subEl}>
        {#each moveTargets as t (t.kind + ':' + (t.value ?? ''))}
          <button role="menuitem" class:tv-menu-novalue={t.kind === 'no-value'} disabled={moveFrom !== undefined && moveFrom === t.value} onclick={() => onMove(t)}>{t.label}</button>
        {/each}
      </div>
    {/if}
    <div class="tv-menu-sep" role="separator"></div>
  {/if}
  {#if onAddTag}
    <button role="menuitem" onclick={onAddTag}>Add Tag…{notes}</button>
  {/if}
  {#if onRemoveTag}
    {@render subTrigger('removeTag', 'Remove Tag', removeTags.length === 0)}
    {@render choices('removeTag', 'Remove Tag', removeTags, onRemoveTag, true)}
  {/if}
  {#if onSetProperty}
    {@render subTrigger('setProperty', 'Set Property', setProperties.length === 0)}
    {@render choices('setProperty', 'Set Property', setProperties, onSetProperty, false)}
  {/if}
  {#if onClearProperty}
    {@render subTrigger('clearProperty', 'Clear Property', clearProperties.length === 0)}
    {@render choices('clearProperty', 'Clear Property', clearProperties, onClearProperty, true)}
  {/if}
  <button role="menuitem" onclick={onEdit}>
    Edit Properties…{notes}
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
  .tv-menu-count { margin-left: auto; padding-left: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .tv-menu-sep { height: 1px; margin: 4px 2px; background: var(--border); }
</style>
