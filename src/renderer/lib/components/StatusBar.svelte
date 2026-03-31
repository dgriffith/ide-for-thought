<script lang="ts">
  import type { CursorInfo } from './Editor.svelte';

  interface Props {
    cursor: CursorInfo;
    fontSize: number;
    onGotoLine: () => void;
  }

  let { cursor, fontSize, onGotoLine }: Props = $props();
</script>

<div class="status-bar">
  <div class="status-left">
    <button class="status-item clickable" onclick={onGotoLine} title="Go to Line (Cmd+G)">
      Ln {cursor.line}, Col {cursor.column}
    </button>
    {#if cursor.selectionLength > 0}
      <span class="status-item">{cursor.selectionLength} selected</span>
    {/if}
  </div>
  <div class="status-right">
    <span class="status-item">{cursor.wordCount} words</span>
    <span class="status-item">{fontSize}px</span>
    <span class="status-item">Markdown</span>
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 8px;
    height: 22px;
    background: var(--bg-titlebar);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-item {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .status-item.clickable {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
  }

  .status-item.clickable:hover {
    color: var(--text);
  }
</style>
