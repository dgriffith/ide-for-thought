<script lang="ts">
  /**
   * Disambiguation picker for stub resolution (#107). The CrossRef
   * search returned >1 plausible candidate (or the top one's
   * confidence didn't clear the auto-apply threshold). User picks
   * which DOI to apply.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and
   * backdrop-click are Dialog's job. ⌘/Ctrl+Enter-to-apply keeps a
   * dialog-wide handler (wrapping <Dialog>) since it must fire
   * regardless of which candidate radio has focus. The accessible name
   * moves from a static `aria-label="Resolve stub"` to the actual h2
   * title text via `titleId` — more specific (names the stub), and
   * nothing in tests/ asserts the old static string.
   */
  import type { ResolveCandidate } from '../../../shared/resolve-stub';
  import Dialog from './ui/Dialog.svelte';

  interface Props {
    stubTitle: string;
    candidates: ResolveCandidate[];
    onApply: (doi: string) => Promise<void>;
    onCancel: () => void;
  }

  let { stubTitle, candidates, onApply, onCancel }: Props = $props();

  // Intentional one-time seed from `candidates`; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
  let selectedDoi = $state<string | null>(candidates[0]?.doi ?? null);
  let applying = $state(false);

  async function apply() {
    if (!selectedDoi || applying) return;
    applying = true;
    try {
      await onApply(selectedDoi);
    } finally {
      applying = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void apply();
  }

  function bylineOf(c: ResolveCandidate): string {
    const who = c.authors.length === 0 ? ''
      : c.authors.length === 1 ? c.authors[0]
      : c.authors.length === 2 ? `${c.authors[0]} and ${c.authors[1]}`
      : `${c.authors[0]} et al.`;
    if (who && c.year) return `${who} (${c.year})`;
    return who || (c.year ?? '');
  }

  function pct(c: number): string {
    return `${Math.round(c * 100)}%`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onkeydown={handleKeydown}>
  <Dialog width={640} onClose={onCancel} titleId="resolve-stub-title">
    {#snippet eyebrow()}Resolve stub · {candidates.length} {candidates.length === 1 ? 'candidate' : 'candidates'}{/snippet}
    {#snippet title()}Match "{stubTitle}" to a DOI{/snippet}
    {#snippet subtitle()}
      Pick the candidate that best matches your stub. The chosen
      DOI's full metadata replaces the stub's; the source id
      stays the same.
    {/snippet}
    {#snippet body()}
      {#if candidates.length === 0}
        <div class="empty">
          CrossRef returned no matches. Try refining the stub's
          title or authors and rerun Resolve, or paste the DOI
          directly via Ingest identifier.
        </div>
      {:else}
        <div class="list">
          {#each candidates as c (c.doi)}
            <label class="row" class:selected={selectedDoi === c.doi}>
              <input
                type="radio"
                name="resolve-candidate"
                value={c.doi}
                bind:group={selectedDoi}
              />
              <div class="details">
                <div class="title-line">
                  <span class="rtitle">{c.title}</span>
                  <span class="confidence" title={c.reasoning}>
                    <span class="bar" style:--pct="{Math.round(c.confidence * 100)}%"></span>
                    <span class="num">{pct(c.confidence)}</span>
                  </span>
                </div>
                {#if c.authors.length || c.year}
                  <div class="byline">{bylineOf(c)}</div>
                {/if}
                {#if c.containerTitle}
                  <div class="container">{c.containerTitle}</div>
                {/if}
                <div class="doi mono">{c.doi}</div>
                <div class="reasoning">{c.reasoning}</div>
              </div>
            </label>
          {/each}
        </div>
      {/if}
    {/snippet}
    {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ⌘↵ apply</span>{/snippet}
    {#snippet footerRight()}
      <button class="btn ghost" onclick={onCancel}>Cancel</button>
      <button class="btn primary" disabled={!selectedDoi || applying} onclick={apply}>
        {applying ? 'Applying…' : 'Apply'}
      </button>
    {/snippet}
  </Dialog>
</div>

<style>
  .empty {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    padding: 24px 0;
    text-align: center;
    font-style: italic;
  }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    cursor: pointer;
  }
  .row:hover { border-color: var(--border-strong); }
  .row.selected {
    border-color: color-mix(in oklch, var(--accent) 50%, transparent);
    background: color-mix(in oklch, var(--accent) 8%, var(--bg));
  }
  .row input[type='radio'] { margin-top: 3px; flex-shrink: 0; accent-color: var(--accent); }
  .details { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .title-line {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .rtitle {
    flex: 1;
    min-width: 0;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .confidence {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .bar {
    display: inline-block;
    height: 5px;
    width: 70px;
    background: color-mix(in oklch, var(--accent) 12%, var(--bg-inset));
    border-radius: 99px;
    position: relative;
    overflow: hidden;
  }
  .bar::before {
    content: '';
    position: absolute;
    inset: 0;
    width: var(--pct, 0%);
    background: var(--accent);
  }
  .num {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
    min-width: 32px;
    text-align: right;
  }
  .byline { font-size: 12px; color: var(--text-muted); }
  .container { font-size: 11.5px; color: var(--text-muted); font-style: italic; }
  .doi {
    font-size: 11px;
    color: var(--accent);
  }
  .mono { font-family: var(--font-mono); }
  .reasoning {
    font-size: 11px;
    color: var(--text-faint);
    margin-top: 2px;
  }
  .kbd-hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
  }
  .btn.ghost { background: transparent; color: var(--text-muted); }
  .btn.ghost:hover { color: var(--text); border-color: var(--border-strong); }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) { opacity: 0.92; }
  .btn:disabled { opacity: 0.4; cursor: default; }
</style>
