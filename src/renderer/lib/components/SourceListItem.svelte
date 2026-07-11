<script lang="ts">
  /**
   * A single row in the sources list (#672, extracted from SourcesPanel).
   * Presentational: it renders one source's title, read-status dot, and
   * author/year/due byline, and reports click / right-click back to the
   * panel, which owns selection, the context menu, and all IPC.
   */
  import type { SourceMetadata } from '../../../shared/types';
  import { displaySourceTitle } from '../../../shared/source-display';
  import {
    formatCreators,
    formatDueStamp,
    isOverdue,
    statusGlyph,
    statusTitle,
  } from '../sources/source-display';
  import { getLinkDrag } from '../stores/link-drag.svelte';

  interface Props {
    source: SourceMetadata;
    onSelect: (sourceId: string) => void;
    onContextMenu: (e: MouseEvent, source: SourceMetadata) => void;
  }

  let { source, onSelect, onContextMenu }: Props = $props();

  const linkDrag = getLinkDrag();
</script>

<button
  class="source-item"
  onclick={() => onSelect(source.sourceId)}
  oncontextmenu={(e) => onContextMenu(e, source)}
  onpointerdown={(e) => linkDrag.start({ kind: 'source', sourceId: source.sourceId, label: displaySourceTitle(source) }, e)}
  title={source.sourceId}
>
  <div class="source-title">
    {#if source.readStatus}
      <span
        class="status-dot status-{source.readStatus}"
        title={statusTitle(source.readStatus)}
        aria-label={statusTitle(source.readStatus)}
      >{statusGlyph(source.readStatus)}</span>
    {/if}
    {displaySourceTitle(source)}
  </div>
  {#if source.creators.length > 0 || source.year || source.readDueBy}
    {@const who = formatCreators(source.creators)}
    <div class="source-byline">
      {#if who}{who}{/if}{#if who && source.year} · {/if}{#if source.year}<span class="year">{source.year}</span>{/if}
      {#if source.readDueBy}
        {#if who || source.year} · {/if}
        <span class="due-stamp" class:overdue={isOverdue(source.readDueBy)} title="Reading due {source.readDueBy}">
          due {formatDueStamp(source.readDueBy)}
        </span>
      {/if}
    </div>
  {/if}
</button>

<style>
  .source-item {
    display: flex;
    flex-direction: column;
    width: 100%;
    text-align: left;
    padding: 10px 16px;
    background: none;
    border: none;
    border-top: 1px solid var(--border);
    border-left: 2px solid transparent;
    color: var(--text);
    cursor: pointer;
  }
  .source-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }

  .source-title {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-byline {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 2px;
  }
  /* The year (and any other mono fragment in the byline) reads as a
     citation locator — switch to the mono face for tabular feel. */
  .source-byline :global(.year) {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .status-dot {
    display: inline-block;
    width: 1em;
    text-align: center;
    margin-right: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    vertical-align: baseline;
  }
  .status-dot.status-reading { color: var(--accent); }
  .status-dot.status-read { color: color-mix(in oklch, var(--text-muted) 90%, transparent); }
  .status-dot.status-unread { color: var(--text-faint); }
  .status-dot.status-skipped { color: var(--text-faint); }

  .due-stamp {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
  }
  .due-stamp.overdue {
    color: var(--rust);
  }
</style>
