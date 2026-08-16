<script lang="ts">
  /**
   * Duplicate-source merge picker (#1446). Several sources share a DOI/URL; the
   * user chooses which one to KEEP and the rest are merged into it. Modeled on
   * TypePickerDialog. Merging isn't a silent deterministic fix — which source is
   * canonical is a judgment call, so we ask.
   */
  import type { SourceMetadata } from '../../../shared/types';
  import { displaySourceTitle } from '../../../shared/source-display';

  interface Props {
    sources: SourceMetadata[];
    /** The kept source's id; the caller merges the others into it. */
    onPick: (keepId: string) => void;
    onCancel: () => void;
  }

  let { sources, onPick, onCancel }: Props = $props();

  let selectedIndex = $state(0);
  let dialogEl = $state<HTMLDivElement>();

  $effect(() => { dialogEl?.focus(); });

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
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="dialog" role="dialog" aria-modal="true" tabindex="-1" bind:this={dialogEl} onkeydown={handleKeydown}>
    <header class="card-header">
      <div class="eyebrow">Merge duplicates</div>
      <h2 class="title">Which source should be kept?</h2>
      <p class="subtitle">The other {sources.length - 1} will be merged into it — their excerpts and citations move over, then they're removed.</p>
    </header>

    <div class="body">
      <div class="ms-results" role="listbox" aria-label="Duplicate sources">
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
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↑↓ · ↵ merge others in</span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-spawned);
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
    width: 460px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
    outline: none;
  }
  .card-header { padding: 18px 22px 0; }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 5px;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 500;
    color: var(--text);
  }
  .subtitle { margin: 6px 0 0; font-size: 12px; color: var(--text-muted); line-height: 1.4; }
  .body { padding: 14px 22px 16px; }
  .ms-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
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
  .card-footer {
    display: flex;
    align-items: center;
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .kbd-hint { font-size: 10.5px; color: var(--text-faint); font-family: var(--font-mono); }
</style>
