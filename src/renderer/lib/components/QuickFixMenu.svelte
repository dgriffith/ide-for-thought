<script lang="ts">
  // Alt-Enter quick-fix popup for the editor (#1446 Phase 2). A minimal
  // keyboard-driven menu of applicable fixes for the token under the cursor —
  // currently "Create Note From Reference" for a broken wiki-link. Deliberately
  // NOT the big EditorContextMenu (that's right-click-only and coupled to a
  // large op set); this is a focused, extensible list.
  import { installDismissOnClickOutside } from '../dismiss-menu';

  export interface QuickFix {
    label: string;
    apply: () => void;
  }

  interface Props {
    /** Viewport coordinates to anchor the menu at (the cursor, via coordsAtPos). */
    x: number;
    y: number;
    fixes: QuickFix[];
    /** Close without applying — the parent nulls its state and refocuses the editor. */
    onClose: () => void;
  }

  let { x, y, fixes, onClose }: Props = $props();

  let selected = $state(0);
  let menuEl = $state<HTMLDivElement | undefined>();

  // Focus the menu so it owns the keyboard while open; dismiss on outside click
  // (deferred one tick so the opening interaction doesn't self-close).
  $effect(() => {
    menuEl?.focus();
    installDismissOnClickOutside(onClose, '.quick-fix-menu');
  });

  function run(i: number) {
    const fix = fixes[i];
    onClose();
    fix?.apply();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      selected = (selected + 1) % fixes.length;
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selected = (selected - 1 + fixes.length) % fixes.length;
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="quick-fix-menu"
  bind:this={menuEl}
  tabindex="-1"
  role="menu"
  style:left="{x}px"
  style:top="{y}px"
  onkeydown={onKeydown}
>
  {#each fixes as fix, i}
    <button
      class="quick-fix-item"
      class:active={i === selected}
      role="menuitem"
      onmousemove={() => { selected = i; }}
      onclick={() => run(i)}
    >{fix.label}</button>
  {/each}
</div>

<style>
  .quick-fix-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 180px;
    outline: none;
  }

  .quick-fix-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .quick-fix-item.active,
  .quick-fix-item:hover {
    background: var(--bg-button);
  }
</style>
