<script lang="ts">
  import type { AutoLinkInboundSuggestion } from '../../../shared/refactor/auto-link-inbound';

  interface Props {
    suggestions: AutoLinkInboundSuggestion[];
    /** Stem (no .md) of the active note, for the link-target label. */
    activeStem: string;
    onApply: (accepted: AutoLinkInboundSuggestion[]) => void;
    onCancel: () => void;
  }

  let { suggestions, activeStem, onApply, onCancel }: Props = $props();

  let selected = $state<boolean[]>(suggestions.map(() => true));

  const selectedCount = $derived(selected.filter(Boolean).length);

  // Group suggestions by source note for display (keeps each source's
  // anchors clustered visually). Preserves the original array indices so
  // we can map checkbox state back.
  const groups = $derived.by(() => {
    const bySource = new Map<string, { i: number; s: AutoLinkInboundSuggestion }[]>();
    suggestions.forEach((s, i) => {
      if (!bySource.has(s.source)) bySource.set(s.source, []);
      bySource.get(s.source)!.push({ i, s });
    });
    return [...bySource.entries()].map(([source, items]) => ({ source, items }));
  });

  function toggleAll(value: boolean) {
    selected = suggestions.map(() => value);
  }

  function apply() {
    onApply(suggestions.filter((_, i) => selected[i]));
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }

  function stemOf(p: string): string {
    return p.replace(/\.md$/i, '');
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay"
  onkeydown={handleKeydown}
  onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
>
  <div class="dialog">
    <header>
      <h2>Auto-link inbound suggestions</h2>
      <span class="count">{selectedCount} of {suggestions.length} selected</span>
    </header>
    <div class="subtitle">
      Places in other notes where a link to <code>[[{activeStem}]]</code> would fit.
    </div>

    {#if suggestions.length === 0}
      <div class="empty">
        The LLM didn\u2019t find any inbound link candidates across the scanned source notes.
      </div>
    {:else}
      <div class="bulk">
        <button class="link-btn" onclick={() => toggleAll(true)}>Select all</button>
        <button class="link-btn" onclick={() => toggleAll(false)}>Select none</button>
      </div>
      <div class="list">
        {#each groups as g (g.source)}
          <div class="group">
            <div class="source"><code>{g.source}</code></div>
            {#each g.items as { i, s } (i)}
              <label class="row">
                <input type="checkbox" bind:checked={selected[i]} />
                <div class="details">
                  <div class="headline">
                    <span class="anchor">{s.anchorText}</span>
                    <span class="arrow">&rarr;</span>
                    <code class="target">[[{activeStem}]]</code>
                  </div>
                  {#if s.rationale}
                    <div class="rationale">{s.rationale}</div>
                  {/if}
                  {#if s.contextSnippet}
                    <div class="context">{s.contextSnippet}</div>
                  {/if}
                </div>
              </label>
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    <div class="actions">
      <button class="btn" onclick={onCancel}>Cancel</button>
      <button class="btn primary" disabled={selectedCount === 0} onclick={apply}>
        Apply {selectedCount}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dialog {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    width: 680px;
    max-width: 92vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
    color: var(--text);
    font-weight: 600;
  }

  .count {
    font-size: 11px;
    color: var(--text-muted);
  }

  .subtitle {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .subtitle code {
    color: var(--accent);
    font-size: 11px;
  }

  .empty {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    padding: 16px 0;
  }

  .bulk {
    display: flex;
    gap: 8px;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    padding: 0;
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
  }

  .link-btn:hover { opacity: 0.8; }

  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .source {
    font-size: 11px;
    color: var(--text-muted);
    padding-bottom: 2px;
    border-bottom: 1px solid var(--border);
  }

  .source code {
    color: var(--text);
    font-size: 11px;
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    cursor: pointer;
  }

  .row:hover { border-color: var(--accent); }

  .row input[type='checkbox'] {
    margin-top: 2px;
    flex-shrink: 0;
  }

  .details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .headline {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    flex-wrap: wrap;
  }

  .anchor {
    color: var(--text);
    font-weight: 600;
  }

  .arrow {
    color: var(--text-muted);
  }

  .target {
    color: var(--accent);
    font-size: 11px;
  }

  .rationale {
    font-size: 12px;
    color: var(--text);
    line-height: 1.4;
  }

  .context {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.5;
    font-family: var(--font-mono, ui-monospace, monospace);
    padding: 4px 8px;
    background: var(--bg-button);
    border-radius: 4px;
    word-break: break-word;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }

  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) { background: var(--bg-button-hover); }

  .btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .btn.primary:hover:not(:disabled) { opacity: 0.9; }

  .btn:disabled { opacity: 0.4; cursor: default; }
</style>
