<script lang="ts">
  /**
   * Duplicate-source merge picker (#1446). Several sources share a DOI/URL; the
   * user chooses which one to KEEP and the rest are merged into it. Modeled on
   * TypePickerDialog. Merging isn't a silent deterministic fix — which source is
   * canonical is a judgment call, so we ask.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and backdrop-click
   * are Dialog's job. Arrow-key nav and Enter-to-merge stay on the list
   * container directly (via bind:this + a local keydown), since — unlike
   * TypePickerDialog's text input — there's nothing else to focus here.
   */
  import type { SourceMetadata } from '../../../shared/types';
  import { displaySourceTitle } from '../../../shared/source-display';
  import Dialog from './ui/Dialog.svelte';

  interface Props {
    sources: SourceMetadata[];
    /** The kept source's id; the caller merges the others into it. */
    onPick: (keepId: string) => void;
    onCancel: () => void;
  }

  let { sources, onPick, onCancel }: Props = $props();

  let selectedIndex = $state(0);
  let listEl = $state<HTMLDivElement>();

  $effect(() => { listEl?.focus(); });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % sources.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + sources.length) % sources.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = sources[selectedIndex];
      if (pick) onPick(pick.sourceId);
    }
  }
</script>

<Dialog width={460} zIndex="var(--z-spawned)" onClose={onCancel} titleId="merge-sources-title">
  {#snippet eyebrow()}Merge duplicates{/snippet}
  {#snippet title()}Which source should be kept?{/snippet}
  {#snippet subtitle()}The other {sources.length - 1} will be merged into it — their excerpts and citations move over, then they're removed.{/snippet}
  {#snippet body()}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="ms-results" role="listbox" aria-label="Duplicate sources" tabindex="-1" bind:this={listEl} onkeydown={handleKeydown}>
      {#each sources as s, i (s.sourceId)}
        {@const selected = i === selectedIndex}
        <button
          type="button"
          class="ms-row"
          class:selected
          role="option"
          aria-selected={selected}
          onmousemove={() => { selectedIndex = i; }}
          onclick={() => onPick(s.sourceId)}
        >
          <span class="ms-dot" aria-hidden="true">{selected ? '●' : '○'}</span>
          <span class="ms-body">
            <span class="ms-name">{displaySourceTitle(s)}</span>
            <span class="ms-id">{s.sourceId}</span>
          </span>
          {#if selected}<span class="ms-keep">keep</span>{/if}
        </button>
      {/each}
    </div>
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ↑↓ · ↵ merge others in</span>{/snippet}
</Dialog>

<style>
  .ms-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
    outline: none;
  }
  .ms-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .ms-row.selected { background: color-mix(in oklch, var(--accent) 14%, transparent); color: var(--accent); }
  .ms-dot { width: 14px; font-size: 12px; line-height: 1; text-align: center; flex-shrink: 0; }
  .ms-body { display: flex; flex-direction: column; gap: 1px; overflow: hidden; flex: 1; }
  .ms-name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ms-id { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ms-keep {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .kbd-hint { font-size: 10.5px; color: var(--text-faint); font-family: var(--font-mono); }
</style>
