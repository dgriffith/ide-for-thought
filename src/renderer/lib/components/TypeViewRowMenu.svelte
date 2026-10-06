<script lang="ts">
  /** Right-click menu for a type view's selected rows (#2431). */
  interface Props {
    x: number;
    y: number;
    count: number;
    onEdit: () => void;
    onClose: () => void;
  }
  let { x, y, count, onEdit, onClose }: Props = $props();
</script>

<button class="tv-menu-backdrop" aria-label="Close menu" onclick={onClose} oncontextmenu={(e) => { e.preventDefault(); onClose(); }}></button>
<div class="tv-menu" role="menu" style="left:{x}px; top:{y}px">
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
  .tv-menu button {
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
  .tv-menu button:hover { background: color-mix(in oklch, var(--accent) 14%, transparent); }
</style>
