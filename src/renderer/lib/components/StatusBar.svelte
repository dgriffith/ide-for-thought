<script lang="ts">
  import type { CursorInfo } from './Editor.svelte';

  interface Props {
    cursor: CursorInfo;
    fontSize: number;
    theme: string;
    inspectionCount?: number;
    /** Number of incoming wiki-links to the active note (#472). 0
     *  hides the item entirely — keeps the bar tidy for unlinked
     *  notes; we'll revisit if anyone wants the affirmative signal. */
    backlinkCount?: number;
    onGotoLine: () => void;
    onCycleTheme: () => void;
    onShowInspections?: () => void;
    /** Click handler for the backlink-count item — App reveals + focuses
     *  the right-sidebar Backlinks panel. */
    onShowBacklinks?: () => void;
  }

  let {
    cursor, fontSize, theme,
    inspectionCount = 0, backlinkCount = 0,
    onGotoLine, onCycleTheme, onShowInspections, onShowBacklinks,
  }: Props = $props();
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
    {#if backlinkCount > 0}
      <button
        class="status-item clickable backlink-count"
        onclick={onShowBacklinks}
        title="Show backlinks ({backlinkCount} note{backlinkCount === 1 ? '' : 's'} link here)"
      >
        &#x2190; {backlinkCount}
      </button>
    {/if}
    {#if inspectionCount > 0}
      <button class="status-item clickable inspection-count" onclick={onShowInspections} title="Show inspections">
        &#x26A0; {inspectionCount}
      </button>
    {/if}
    <span class="status-item">{cursor.wordCount} words</span>
    <span class="status-item">{fontSize}px</span>
    <button class="status-item clickable" onclick={onCycleTheme} title="Cycle Theme (Cmd+Shift+T)">{theme}</button>
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
    background: var(--bg-toolbar);
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

  .inspection-count {
    color: #f9e2af;
  }
</style>
