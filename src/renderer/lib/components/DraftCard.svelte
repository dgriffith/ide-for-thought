<script lang="ts">
  /**
   * Shared chrome for a conversation draft-approval card (#672, extracted from
   * ConversationsPanel). The five simple draft cards (note / source / property /
   * source-property / claims) all share this shell — a summary headline + note,
   * a card-specific body, and an Approve / Discard action row. Each call site
   * passes its own body as children and wires the two callbacks; the panel
   * keeps owning the drafts and the approval orchestration.
   *
   * (The richer compute card has mid-card actions + output and stays inline in
   * ConversationsPanel for now, so the `.draft-*` chrome is briefly defined in
   * both places — consolidated once the compute card is extracted too.)
   */
  import type { Snippet } from 'svelte';

  interface Props {
    /** Bold summary headline, e.g. "📚 2 sources" (emoji included by caller). */
    headline: string;
    /** The draft's one-line rationale/note. */
    note: string;
    /** Primary button label, e.g. "Approve & file" / "Approve & ingest". */
    approveLabel: string;
    onApprove: () => void;
    onDiscard: () => void;
    /** Grey out Approve — for cards where the user can deselect every item and
     *  there is then nothing to approve. Discard stays live. */
    approveDisabled?: boolean;
    /** Card-specific body (the payload list / diff / claims, etc.). */
    children: Snippet;
  }

  let { headline, note, approveLabel, onApprove, onDiscard, approveDisabled = false, children }: Props = $props();
</script>

<div class="draft-card">
  <div class="draft-summary">
    <strong>{headline}</strong>
    <span class="draft-note">{note}</span>
  </div>
  {@render children()}
  <div class="draft-actions">
    <button type="button" class="draft-btn primary" disabled={approveDisabled} onclick={onApprove}>{approveLabel}</button>
    <button type="button" class="draft-btn" onclick={onDiscard}>Discard</button>
  </div>
</div>

<style>
  .draft-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .draft-card {
    border: 1px solid color-mix(in oklch, var(--accent) 28%, transparent);
    border-radius: 8px;
    padding: 10px 12px;
    background: color-mix(in oklch, var(--accent) 5%, var(--bg));
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .draft-summary { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .draft-note { color: var(--text-muted); font-size: 12px; }
  .draft-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .draft-btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }
  .draft-btn:hover:not(:disabled) { background: var(--bg, var(--bg-sidebar)); }
  .draft-btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  /* Primary buttons set `color: var(--bg)` for dark-text-on-accent. The shared
     `.draft-btn:hover` rule sets background to var(--bg), which on a primary
     button would collapse text and background to the same color — keep the
     accent background on hover and just dim. */
  .draft-btn.primary:hover:not(:disabled) {
    background: var(--accent);
    opacity: 0.9;
  }
  .draft-btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
