<script lang="ts">
  /**
   * The propose_compute review card (#245, extracted from ConversationsPanel
   * for #672). Shows the proposed cell — language pill, rationale, safety
   * flags, code (with an inline editor), Run / Edit / Insert / Discard actions,
   * and the run output (text / json / table / image / html).
   *
   * The card owns its ephemeral UI state — edit buffer, edit mode, and the
   * "risky → click Run twice" acknowledgement — since those are per-card view
   * concerns. The panel keeps the run state (running / result / insertedAt,
   * which live in the conversation store) and the actions that touch the store
   * (Run / Insert / Discard) and the editor (open-inserted), passed in as
   * callbacks. So the Trust boundary is unchanged: this card only proposes;
   * the store/approval path still does the work.
   */
  import type { ConversationComputeDraft } from '../../../shared/conversation-compute-drafts';
  import type { CellOutput, CellResult } from '../../../shared/compute/types';
  import { sanitizeComputeOutputHtml } from '../compute-output-sanitize';

  interface RunState {
    running: boolean;
    result: CellResult | null;
    insertedAt: string | null;
  }

  interface Props {
    draft: ConversationComputeDraft;
    /** Run state from the conversation store, or undefined before first Run. */
    runState: RunState | undefined;
    /** edited === undefined when the cell was never edited (run the original). */
    onRun: (draft: ConversationComputeDraft, edited: string | undefined) => void;
    onInsert: (draft: ConversationComputeDraft, edited: string | undefined) => void;
    onDiscard: (draft: ConversationComputeDraft) => void;
    onOpenInserted: (path: string) => void;
  }

  let { draft, runState, onRun, onInsert, onDiscard, onOpenInserted }: Props = $props();

  // Per-card ephemeral state. `editBuffer === null` means "never edited".
  let editing = $state(false);
  let editBuffer = $state<string | null>(null);
  let armedRisky = $state(false);

  const code = $derived(editBuffer ?? draft.code);
  const running = $derived(runState?.running === true);
  const result = $derived(runState?.result ?? null);
  const insertedAt = $derived(runState?.insertedAt ?? null);

  function langLabel(lang: 'sparql' | 'sql' | 'python'): string {
    return lang === 'sparql' ? 'SPARQL' : lang === 'sql' ? 'SQL' : 'Python';
  }

  /** Last path segment for the "filed as a cell in X" link. */
  function basename(p: string): string {
    const slash = p.lastIndexOf('/');
    return slash >= 0 ? p.slice(slash + 1) : p;
  }

  /** Format a single table cell — wide values truncate; bigints show plain. */
  function formatComputeCell(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '…' : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch { return ''; }
  }

  function startEdit(): void {
    editBuffer = draft.code;
    editing = true;
  }
  function cancelEdit(): void {
    editBuffer = null;
    editing = false;
  }
  function commitEdit(): void {
    // Keep the buffer; just exit edit mode. The edited code folds into the
    // Run / Insert payloads when those fire.
    editing = false;
  }

  function run(): void {
    if (draft.safetyFlags.length > 0 && !armedRisky) {
      // First click on a flagged cell just arms; a second Run executes.
      armedRisky = true;
      return;
    }
    onRun(draft, editBuffer ?? undefined);
  }
</script>

<div class="draft-card compute-card">
  <div class="compute-header">
    <span class="compute-lang">{langLabel(draft.language)}</span>
    <span class="draft-note">{draft.rationale}</span>
  </div>
  {#if draft.safetyFlags.length > 0}
    <div class="compute-safety" role="alert">
      <strong>⚠ Risky patterns detected:</strong>
      <ul>
        {#each draft.safetyFlags as f (f.id)}
          <li>{@html f.message}</li>
        {/each}
      </ul>
      {#if armedRisky}
        <span class="compute-safety-armed">Click Run again to confirm execution.</span>
      {/if}
    </div>
  {/if}
  {#if editing}
    <textarea
      class="compute-edit"
      value={code}
      spellcheck="false"
      oninput={(e) => { editBuffer = e.currentTarget.value; }}
      rows={Math.max(4, Math.min(20, code.split('\n').length))}
    ></textarea>
    <div class="compute-edit-actions">
      <button type="button" class="draft-btn" onclick={cancelEdit}>Cancel</button>
      <button type="button" class="draft-btn primary" onclick={commitEdit}>Done</button>
    </div>
  {:else}
    <pre class="compute-code"><code>{code}</code></pre>
  {/if}
  <div class="draft-actions">
    <button
      type="button"
      class="draft-btn primary"
      disabled={running || editing}
      onclick={run}
    >{running ? 'Running…' : armedRisky ? 'Run anyway' : 'Run'}</button>
    {#if !editing}
      <button type="button" class="draft-btn" onclick={startEdit}>Edit</button>
    {/if}
    <button
      type="button"
      class="draft-btn"
      disabled={running || editing}
      onclick={() => onInsert(draft, editBuffer ?? undefined)}
    >Insert into notebook</button>
    <button type="button" class="draft-btn" onclick={() => onDiscard(draft)}>Discard</button>
  </div>
  {#if insertedAt}
    <div class="compute-inserted">
      Filed as a cell in
      <button
        type="button"
        class="filed-link"
        title={insertedAt}
        onclick={() => onOpenInserted(insertedAt)}
      >{basename(insertedAt)}</button>
    </div>
  {/if}
  {#if result}
    <div class="compute-output">
      {#if !result.ok}
        <div class="compute-output-error">
          <strong>Error:</strong> {result.error}
        </div>
      {:else}
        {@render outputBlock(result.output)}
      {/if}
    </div>
  {/if}
</div>

{#snippet outputBlock(output: CellOutput)}
  {#if output.type === 'text'}
    <pre class="compute-output-text">{output.value}</pre>
  {:else if output.type === 'json'}
    <pre class="compute-output-text">{JSON.stringify(output.value, null, 2)}</pre>
  {:else if output.type === 'table'}
    <div class="compute-output-table">
      <table>
        <thead>
          <tr>{#each output.columns as col (col)}<th>{col}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each output.rows.slice(0, 50) as row, ri (ri)}
            <tr>{#each row as cell, ci (ci)}<td>{formatComputeCell(cell)}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
      {#if output.truncated || output.rows.length > 50}
        <div class="compute-output-trailer">
          Showing {Math.min(output.rows.length, 50)} of {output.totalRows ?? output.rows.length} rows
        </div>
      {/if}
    </div>
  {:else if output.type === 'image'}
    {#if output.mime === 'image/png'}
      <!-- Base64 PNG bytes from matplotlib / PIL. -->
      <img class="compute-output-image" alt="compute output" src={`data:image/png;base64,${output.data}`} />
    {:else}
      <!-- SVG markup — sanitized for the same reasons as html. -->
      <div class="compute-output-image">{@html sanitizeComputeOutputHtml(output.data)}</div>
    {/if}
  {:else if output.type === 'html'}
    <div class="compute-output-html">{@html sanitizeComputeOutputHtml(output.html)}</div>
  {/if}
{/snippet}

<style>
  /* Card chrome shared in spirit with DraftCard.svelte; the compute card's
     mid-card actions + output don't fit that shell, so it carries its own. */
  .draft-card {
    border: 1px solid color-mix(in oklch, var(--accent) 28%, transparent);
    border-radius: 8px;
    padding: 10px 12px;
    background: color-mix(in oklch, var(--accent) 5%, var(--bg));
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
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
  .draft-btn.primary:hover:not(:disabled) {
    background: var(--accent);
    opacity: 0.9;
  }
  .draft-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .compute-card { gap: 6px; }
  .compute-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .compute-lang {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 3px;
    background: var(--accent);
    color: var(--bg);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .compute-code {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--text);
    white-space: pre;
    overflow-x: auto;
    max-height: 360px;
    overflow-y: auto;
  }
  .compute-code code {
    background: transparent;
    padding: 0;
    font-family: inherit;
  }
  .compute-edit {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--text);
    resize: vertical;
    box-sizing: border-box;
  }
  .compute-edit:focus { outline: none; border-color: var(--accent); }
  .compute-edit-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .compute-safety {
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 3px;
    padding: 6px 10px;
    font-size: 11px;
    background: var(--bg-button);
    color: var(--text);
  }
  .compute-safety ul {
    margin: 4px 0 0 0;
    padding-left: 18px;
    color: var(--text-muted);
  }
  .compute-safety-armed {
    display: block;
    margin-top: 4px;
    color: var(--accent);
    font-weight: 600;
  }
  .compute-output {
    margin-top: 4px;
    padding: 8px 10px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .compute-output-error {
    color: var(--text);
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .compute-output-text {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: var(--text);
    white-space: pre-wrap;
    max-height: 240px;
    overflow-y: auto;
  }
  .compute-output-table {
    overflow-x: auto;
    max-height: 280px;
    overflow-y: auto;
  }
  .compute-output-table table {
    border-collapse: collapse;
    font-size: 11px;
    color: var(--text);
  }
  .compute-output-table th,
  .compute-output-table td {
    padding: 2px 8px;
    border: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  .compute-output-table th {
    background: var(--bg-button);
    font-weight: 600;
  }
  .compute-output-trailer {
    font-size: 10px;
    color: var(--text-muted);
    padding-top: 4px;
  }
  .compute-output-image {
    max-width: 100%;
    height: auto;
  }
  .compute-output-html {
    font-size: 12px;
    color: var(--text);
  }
  .compute-inserted {
    font-size: 11px;
    color: var(--text-muted);
    padding: 2px 4px;
  }
  .filed-link {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .filed-link:hover { text-decoration-color: var(--accent); }
</style>
