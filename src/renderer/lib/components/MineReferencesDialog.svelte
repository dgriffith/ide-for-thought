<script lang="ts">
  /**
   * Review the LLM-parsed references before any stubs land on disk
   * (#106). Per CLAUDE.md trust principle, the LLM proposes,
   * the human confirms — this dialog is that confirmation step.
   *
   * Each row is selected by default; user can uncheck individual
   * entries before Approve. The mining call already happened so
   * we render the results immediately; the dialog never re-fetches.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and
   * backdrop-click are Dialog's job. ⌘/Ctrl+Enter-to-approve keeps a
   * dialog-wide handler (wrapping <Dialog>) since it must fire
   * regardless of which reference checkbox has focus. The accessible
   * name moves from a static `aria-label` to the actual h2 title text
   * via `titleId` — more specific (names the source), and nothing in
   * tests/ asserts the old static string.
   */
  import type { ParsedReference } from '../../../shared/mine-references';
  import Icon from './Icon.svelte';
  import Dialog from './ui/Dialog.svelte';

  interface Props {
    /** Parent source the references will be linked from. Used only
     *  for the dialog header. */
    parentTitle: string;
    refs: ParsedReference[];
    onApply: (accepted: ParsedReference[]) => Promise<void>;
    onCancel: () => void;
  }

  let { parentTitle, refs, onApply, onCancel }: Props = $props();

  // Intentional one-time seed from `refs`; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
  let selected = $state<boolean[]>(refs.map(() => true));
  let saving = $state(false);

  const selectedCount = $derived(selected.filter(Boolean).length);

  function toggleAll(value: boolean) {
    selected = refs.map(() => value);
  }

  async function apply() {
    if (saving) return;
    const accepted = refs.filter((_, i) => selected[i]);
    if (accepted.length === 0) return;
    saving = true;
    try {
      await onApply(accepted);
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void apply();
  }

  function bylineOf(ref: ParsedReference): string {
    const who = ref.authors.length === 0 ? ''
      : ref.authors.length === 1 ? ref.authors[0]
      : ref.authors.length === 2 ? `${ref.authors[0]} and ${ref.authors[1]}`
      : `${ref.authors[0]} et al.`;
    if (who && ref.year) return `${who} (${ref.year})`;
    return who || (ref.year ?? '');
  }

  /** Compact "found identifier" chip list — DOI / arXiv / PMID / ISBN /
   *  URL — so the user can see at a glance whether each row will land
   *  with a structured identifier or as a content-hash stub. */
  function idChips(ref: ParsedReference): { kind: string; value: string }[] {
    const out: { kind: string; value: string }[] = [];
    if (ref.doi) out.push({ kind: 'DOI', value: ref.doi });
    if (ref.arxiv) out.push({ kind: 'arXiv', value: ref.arxiv });
    if (ref.pubmed) out.push({ kind: 'PMID', value: ref.pubmed });
    if (ref.isbn) out.push({ kind: 'ISBN', value: ref.isbn });
    if (ref.url) out.push({ kind: 'URL', value: ref.url });
    return out;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onkeydown={handleKeydown}>
  <Dialog width={720} onClose={onCancel} titleId="mine-references-title">
    {#snippet eyebrow()}Review references · {refs.length} {refs.length === 1 ? 'candidate' : 'candidates'}{/snippet}
    {#snippet title()}Mine references from "{parentTitle}"{/snippet}
    {#snippet subtitle()}
      Each accepted reference becomes a stub source linked from
      this paper. Stubs can be promoted to full sources later with
      Resolve.
    {/snippet}
    {#snippet body()}
      {#if refs.length === 0}
        <div class="empty">
          The LLM didn't find any references it could parse. If the
          paper has a References section, the formatting may be too
          irregular for first-pass extraction.
        </div>
      {:else}
        <div class="body-inner">
          <div class="bulk-row">
            <span class="bulk-count">{selectedCount} of {refs.length} selected</span>
            <span class="bulk-spacer"></span>
            <button class="bulk-btn" onclick={() => toggleAll(true)}>Select all</button>
            <button class="bulk-btn" onclick={() => toggleAll(false)}>Select none</button>
          </div>
          <div class="list">
            {#each refs as ref, i (i)}
              <label class="row" class:selected={selected[i]}>
                <input type="checkbox" bind:checked={selected[i]} />
                <div class="details">
                  <div class="title-line">
                    <span class="rtitle">{ref.title}</span>
                    <span class="subtype">{ref.subtype}</span>
                  </div>
                  {#if ref.authors.length || ref.year}
                    <div class="byline">{bylineOf(ref)}</div>
                  {/if}
                  {#if ref.containerTitle}
                    <div class="container">{ref.containerTitle}</div>
                  {/if}
                  {#each idChips(ref) as chip}
                    <span class="id-chip">{chip.kind} · <span class="mono">{chip.value}</span></span>
                  {/each}
                  <div class="raw" title="Verbatim citation text">{ref.raw}</div>
                </div>
              </label>
            {/each}
          </div>
        </div>
      {/if}
    {/snippet}
    {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ⌘↵ approve</span>{/snippet}
    {#snippet footerRight()}
      <button class="btn ghost" onclick={onCancel}>Cancel</button>
      <button class="btn primary" disabled={selectedCount === 0 || saving} onclick={apply}>
        <Icon name="plus" size={11} />
        {saving ? 'Creating…' : `Create ${selectedCount} stub${selectedCount === 1 ? '' : 's'}`}
      </button>
    {/snippet}
  </Dialog>
</div>

<style>
  .body-inner {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .empty {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    padding: 24px 0;
    text-align: center;
    font-style: italic;
  }
  .bulk-row { display: flex; align-items: center; gap: 12px; }
  .bulk-count { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }
  .bulk-spacer { flex: 1; }
  .bulk-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 3px 9px;
    border-radius: 5px;
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .bulk-btn:hover { color: var(--text); border-color: var(--border-strong); }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
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
  .row input[type='checkbox'] {
    margin-top: 3px;
    flex-shrink: 0;
    accent-color: var(--accent);
  }
  .details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .title-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .rtitle {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .subtype {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    background: var(--bg-button);
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .byline {
    font-size: 12px;
    color: var(--text-muted);
  }
  .container {
    font-size: 11.5px;
    color: var(--text-muted);
    font-style: italic;
  }
  .id-chip {
    display: inline-block;
    margin-right: 6px;
    font-size: 11px;
    color: var(--accent);
  }
  .mono { font-family: var(--font-mono); }
  .raw {
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1.4;
    margin-top: 3px;
    padding: 5px 9px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 4px;
    word-break: break-word;
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
    display: inline-flex;
    align-items: center;
    gap: 6px;
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
