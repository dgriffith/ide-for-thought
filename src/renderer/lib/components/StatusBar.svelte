<script lang="ts">
  import type { CursorInfo } from './Editor.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    cursor: CursorInfo;
    fontSize: number;
    theme: string;
    inspectionCount?: number;
    /** Number of incoming wiki-links to the active note (#472). 0
     *  hides the item entirely — keeps the bar tidy for unlinked
     *  notes; we'll revisit if anyone wants the affirmative signal. */
    backlinkCount?: number;
    /** Whether the active note has unsaved changes. Drives the
     *  saved-state cue on the left (§7.3). When unset the cue is
     *  hidden (e.g. on a query tab with no save concept). */
    isDirty?: boolean;
    /** True when an active note tab exists. Lets us hide the saved
     *  cue entirely when no editable file is open. */
    hasActiveNote?: boolean;
    onGotoLine: () => void;
    onCycleTheme: () => void;
    onShowInspections?: () => void;
    /** Click handler for the backlink-count item — App reveals + focuses
     *  the right-sidebar Backlinks panel. */
    onShowBacklinks?: () => void;
    /** Semantic-index backfill progress (#836); null hides the indicator. */
    backfill?: { done: number; total: number } | null;
  }

  let {
    cursor, fontSize, theme,
    inspectionCount = 0, backlinkCount = 0,
    isDirty = false, hasActiveNote = false,
    onGotoLine, onCycleTheme, onShowInspections, onShowBacklinks,
    backfill = null,
  }: Props = $props();
</script>

<div class="status-bar">
  <div class="status-left">
    <button class="status-item nums clickable" onclick={onGotoLine} title="Go to Line (Cmd+G)">
      L{cursor.line} · C{cursor.column}
    </button>
    {#if cursor.selectionLength > 0}
      <span class="rule" aria-hidden="true"></span>
      <span class="status-item faint">{cursor.selectionLength} selected</span>
    {/if}
    {#if hasActiveNote}
      <span class="rule" aria-hidden="true"></span>
      <span class="status-item" class:faint={!isDirty}>
        {#if isDirty}
          <Icon name="dot" size={11} color="var(--accent)" />
          unsaved
        {:else}
          <Icon name="check" size={11} color="var(--sage)" />
          saved
        {/if}
      </span>
    {/if}
  </div>
  <div class="status-right">
    {#if backfill}
      <span class="status-item faint" title="Building semantic search index in the background">
        <Icon name="sparkle" size={12} />
        <span class="nums">Embedding {backfill.done}/{backfill.total}…</span>
      </span>
      <span class="rule" aria-hidden="true"></span>
    {/if}
    {#if backlinkCount > 0}
      <button
        class="status-item clickable"
        onclick={onShowBacklinks}
        title="Show backlinks ({backlinkCount} note{backlinkCount === 1 ? '' : 's'} link here)"
      >
        <Icon name="backlinks" size={12} />
        <span class="nums">{backlinkCount}</span>
      </button>
    {/if}
    {#if inspectionCount > 0}
      <button class="status-item clickable inspection-count" onclick={onShowInspections} title="Show inspections">
        <Icon name="warn" size={12} />
        <span class="nums">{inspectionCount}</span>
      </button>
    {/if}
    <span class="rule" aria-hidden="true"></span>
    <span class="status-item faint nums">{cursor.wordCount} words</span>
    <span class="status-item faint">·</span>
    <span class="status-item faint nums">{fontSize}px</span>
    <span class="status-item faint">·</span>
    <button class="status-item faint clickable" onclick={onCycleTheme} title="Cycle Theme (Cmd+Shift+T)">{theme}</button>
    <span class="status-item faint">·</span>
    <span class="status-item faint">Markdown</span>
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px;
    height: 28px;
    background: var(--bg-toolbar);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    font-family: var(--font-sans);
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .status-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .status-item.faint {
    color: var(--text-faint);
  }

  .status-item.clickable {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }
  .status-item.clickable:hover {
    color: var(--text);
  }

  /* Mono cells get tabular-nums so digit columns line up — L47 · C23,
     word counts, font sizes. */
  .nums {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* 1px hairline rule between item groups (§7.3). */
  .rule {
    display: inline-block;
    width: 1px;
    height: 11px;
    background: var(--border);
    flex-shrink: 0;
  }

  /* Inspections badge uses --rust (no hardcoded peach). */
  .inspection-count {
    color: var(--rust);
  }
  .inspection-count:hover {
    color: var(--rust);
    opacity: 0.85;
  }
</style>
