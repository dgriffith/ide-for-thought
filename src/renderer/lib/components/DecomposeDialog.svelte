<script lang="ts">
  import type { DecomposeProposal, DecomposeChildProposal } from '../../../shared/refactor/decompose';

  interface Props {
    proposal: DecomposeProposal;
    /** Callback invoked with the edited proposal + include mask on Apply. */
    onApply: (edited: DecomposeProposal, include: boolean[]) => void;
    /** Callback to request a fresh decomposition from the LLM. */
    onRegenerate: () => void;
    onCancel: () => void;
  }

  let { proposal, onApply, onRegenerate, onCancel }: Props = $props();

  // Editable mirror of the proposal. Rebuilt whenever the incoming proposal
  // changes (regenerate replaces the whole thing).
  let parentContent = $state(proposal.parent.content);
  let editableChildren = $state<DecomposeChildProposal[]>(
    proposal.children.map((c) => ({ ...c })),
  );
  let include = $state<boolean[]>(proposal.children.map(() => true));
  let expanded = $state<boolean[]>(proposal.children.map((_, i) => i === 0));

  // Rehydrate on regenerate: detect identity change of the proposal prop.
  let lastSeenProposal = proposal;
  $effect(() => {
    if (proposal !== lastSeenProposal) {
      parentContent = proposal.parent.content;
      editableChildren = proposal.children.map((c) => ({ ...c }));
      include = proposal.children.map(() => true);
      expanded = proposal.children.map((_, i) => i === 0);
      lastSeenProposal = proposal;
    }
  });

  const includedCount = $derived(include.filter(Boolean).length);
  const canApply = $derived(includedCount >= 2);

  function apply() {
    if (!canApply) return;
    const edited: DecomposeProposal = {
      parent: { content: parentContent },
      children: editableChildren.map((c) => ({ ...c })),
    };
    onApply(edited, [...include]);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
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
      <h2>Decompose Note</h2>
      <span class="count">{includedCount} of {proposal.children.length} children selected</span>
    </header>
    <div class="subtitle">
      Preview the proposed restructure. Edit any content inline, drop children you don\u2019t want,
      or regenerate for a different cut. Apply writes the parent back to the source and each
      included child as a new note under a subfolder.
    </div>

    <div class="scroll">
      <section class="parent">
        <div class="section-label">Parent (replaces source body)</div>
        <textarea
          class="body"
          bind:value={parentContent}
          rows="5"
          placeholder="Index narrative \u2014 how the children relate"
        ></textarea>
        <div class="hint">A <code>## Contents</code> block with links to each included child is appended automatically.</div>
      </section>

      <div class="children">
        <div class="section-label">Children ({proposal.children.length} proposed)</div>
        {#each editableChildren as child, i (i)}
          <div class="child" class:excluded={!include[i]}>
            <div class="child-header">
              <label class="include-toggle">
                <input type="checkbox" bind:checked={include[i]} />
                <span class="label-text">Include</span>
              </label>
              <input
                class="title"
                type="text"
                bind:value={child.title}
                placeholder="Child title"
                disabled={!include[i]}
              />
              <button
                class="expand-btn"
                onclick={() => { expanded[i] = !expanded[i]; }}
                disabled={!include[i]}
                title={expanded[i] ? 'Collapse' : 'Expand'}
              >{expanded[i] ? '\u25BE' : '\u25B8'}</button>
            </div>
            {#if child.rationale}
              <div class="rationale">{child.rationale}</div>
            {/if}
            {#if expanded[i] && include[i]}
              <textarea
                class="body"
                bind:value={child.content}
                rows="8"
                placeholder="Child body"
              ></textarea>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <div class="actions">
      <button class="btn" onclick={onCancel}>Cancel</button>
      <button class="btn" onclick={onRegenerate} title="Ask the LLM for a fresh decomposition">
        Regenerate
      </button>
      <button class="btn primary" disabled={!canApply} onclick={apply} title={canApply ? '' : 'Include at least 2 children'}>
        Apply
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
    width: 780px;
    max-width: 94vw;
    max-height: 88vh;
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

  .scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-right: 4px;
  }

  .section-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .parent {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .hint code {
    font-size: 11px;
    color: var(--accent);
  }

  .children {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .child {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }

  .child.excluded {
    opacity: 0.5;
  }

  .child-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .include-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
  }

  .include-toggle input {
    cursor: pointer;
  }

  .label-text {
    user-select: none;
  }

  .title {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    outline: none;
  }

  .title:focus {
    border-color: var(--accent);
  }

  .title:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .expand-btn {
    width: 28px;
    padding: 4px 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    cursor: pointer;
    font-size: 11px;
  }

  .expand-btn:hover:not(:disabled) {
    background: var(--bg-button-hover);
  }

  .expand-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .rationale {
    font-size: 11px;
    color: var(--text-muted);
    padding-left: 4px;
    font-style: italic;
  }

  .body {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }

  .body:focus {
    border-color: var(--accent);
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
