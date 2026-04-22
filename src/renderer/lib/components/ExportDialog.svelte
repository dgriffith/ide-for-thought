<script lang="ts">
  import { api } from '../ipc/client';
  import type { ExportPreviewPlan } from '../ipc/client';

  interface Props {
    /** Registered exporter id the menu launched with. */
    exporterId: string;
    /** The note the user currently has open — used for 'single-note' scope and the folder default. */
    activeFilePath: string | null;
    /** Close the dialog without exporting. */
    onCancel: () => void;
    /**
     * Run the export. The dialog calls `api.publish.runExport` itself
     * and passes the result up so the caller can show a toast / open
     * the output dir. `null` when the user cancelled the directory picker.
     */
    onExported: (result: { filesWritten: number; summary: string; outputDir: string; writtenPaths: string[] }) => void;
  }

  let { exporterId, activeFilePath, onCancel, onExported }: Props = $props();

  type Scope = 'project' | 'folder' | 'single-note';
  type LinkPolicy = 'drop' | 'inline-title' | 'follow-to-file';

  let scope = $state<Scope>('project');
  let linkPolicy = $state<LinkPolicy>('inline-title');
  let plan = $state<ExportPreviewPlan | null>(null);
  let loading = $state(false);
  let exporting = $state(false);
  let error = $state<string | null>(null);

  const activeFolder = $derived.by(() => {
    if (!activeFilePath) return '';
    const slash = activeFilePath.lastIndexOf('/');
    return slash >= 0 ? activeFilePath.slice(0, slash) : '';
  });

  // Scopes that don't apply to the current context (e.g. 'single-note'
  // when no file is open) get disabled rather than hidden — keeps the
  // radio layout stable.
  const canScopeNote = $derived(activeFilePath != null);

  function scopeInput(): { kind: Scope; relativePath?: string } {
    if (scope === 'single-note') return { kind: 'single-note', relativePath: activeFilePath ?? '' };
    if (scope === 'folder') return { kind: 'folder', relativePath: activeFolder };
    return { kind: 'project' };
  }

  async function refreshPlan(): Promise<void> {
    loading = true;
    error = null;
    try {
      plan = await api.publish.resolvePlan(scopeInput(), { exporterId, linkPolicy });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      plan = null;
    } finally {
      loading = false;
    }
  }

  // Re-resolve whenever the scope or link policy changes. `$effect`
  // re-runs on any tracked read, so wrapping refreshPlan() in here
  // subscribes to scope, linkPolicy, activeFilePath, and activeFolder.
  $effect(() => {
    void scope;
    void linkPolicy;
    void activeFilePath;
    void refreshPlan();
  });

  async function handleExport(): Promise<void> {
    if (!plan) return;
    exporting = true;
    error = null;
    try {
      const result = await api.publish.runExport({
        exporterId,
        input: scopeInput(),
        linkPolicy,
      });
      if (result === null) return; // user cancelled the directory picker
      onExported(result);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      exporting = false;
    }
  }

  function handleBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('export-dialog-backdrop')) {
      onCancel();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="export-dialog-backdrop" onclick={handleBackdropClick}>
  <div class="export-dialog" role="dialog" aria-labelledby="export-dialog-title">
    <h2 id="export-dialog-title">
      {plan ? `Export as ${plan.exporterLabel}` : 'Export'}
    </h2>

    <div class="option-row">
      <label>Scope</label>
      <div class="radio-group">
        <label>
          <input type="radio" name="scope" value="project" bind:group={scope} />
          Entire project
        </label>
        <label>
          <input type="radio" name="scope" value="folder" bind:group={scope} disabled={!activeFilePath} />
          Current folder{activeFolder ? ` (${activeFolder || 'root'})` : ''}
        </label>
        <label>
          <input type="radio" name="scope" value="single-note" bind:group={scope} disabled={!canScopeNote} />
          Current note{activeFilePath ? ` (${activeFilePath})` : ''}
        </label>
      </div>
    </div>

    <div class="option-row">
      <label for="link-policy">Link handling</label>
      <select id="link-policy" bind:value={linkPolicy}>
        <option value="inline-title">Replace wiki-links with target title</option>
        <option value="follow-to-file">Rewrite wiki-links to .md file links</option>
        <option value="drop">Drop wiki-links (keep display text only)</option>
      </select>
    </div>

    {#if loading}
      <div class="status">Resolving plan…</div>
    {:else if plan}
      <div class="audit">
        <div class="audit-section">
          <h3>Including <span class="count">{plan.inputs.length}</span></h3>
          {#if plan.inputs.length === 0}
            <p class="empty">Nothing to export in this scope.</p>
          {:else}
            <ul>
              {#each plan.inputs.slice(0, 40) as f (f.relativePath)}
                <li>
                  <span class="title">{f.title}</span>
                  <span class="path">{f.relativePath}</span>
                </li>
              {/each}
              {#if plan.inputs.length > 40}
                <li class="more">…and {plan.inputs.length - 40} more</li>
              {/if}
            </ul>
          {/if}
        </div>

        <div class="audit-section">
          <h3>Excluded <span class="count">{plan.excluded.length}</span></h3>
          {#if plan.excluded.length === 0}
            <p class="empty">Nothing excluded.</p>
          {:else}
            <ul>
              {#each plan.excluded.slice(0, 40) as ex (ex.relativePath)}
                <li>
                  <span class="title">{ex.relativePath}</span>
                  <span class="reason">{ex.reason}</span>
                </li>
              {/each}
              {#if plan.excluded.length > 40}
                <li class="more">…and {plan.excluded.length - 40} more</li>
              {/if}
            </ul>
          {/if}
        </div>
      </div>
    {/if}

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <div class="actions">
      <button class="secondary" onclick={onCancel} disabled={exporting}>Cancel</button>
      <button
        class="primary"
        onclick={handleExport}
        disabled={exporting || loading || !plan || plan.inputs.length === 0}
      >
        {exporting ? 'Exporting…' : 'Export…'}
      </button>
    </div>
  </div>
</div>

<style>
  .export-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .export-dialog {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 24px;
    width: 640px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  h2 {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
  }

  .option-row {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    font-size: 12px;
  }
  .option-row > label:first-child {
    min-width: 90px;
    color: var(--text-muted);
    padding-top: 3px;
  }
  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .radio-group label {
    display: flex;
    gap: 6px;
    align-items: center;
    cursor: pointer;
  }
  .radio-group input:disabled + * {
    color: var(--text-muted);
  }
  select {
    background: var(--bg-button);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 3px 6px;
    font-size: 12px;
    flex: 1;
  }

  .audit {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 12px 0;
    flex: 1;
    min-height: 0;
  }
  .audit-section {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 12px;
    overflow-y: auto;
    max-height: 320px;
  }
  .audit-section h3 {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .audit-section .count {
    background: var(--bg-button);
    border-radius: 8px;
    padding: 1px 8px;
    font-size: 10px;
    font-weight: 500;
    color: var(--text);
  }
  .audit-section ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .audit-section li {
    padding: 3px 0;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .audit-section li:last-child {
    border-bottom: none;
  }
  .audit-section .title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .audit-section .path,
  .audit-section .reason {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono, ui-monospace, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .audit-section .empty {
    margin: 0;
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
  }
  .audit-section .more {
    border-bottom: none;
    padding-top: 6px;
    font-size: 10px;
    color: var(--text-muted);
    font-style: italic;
  }

  .status {
    padding: 12px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }

  .error {
    color: var(--text);
    background: var(--bg-button);
    border-left: 3px solid var(--accent);
    padding: 8px 12px;
    border-radius: 0 4px 4px 0;
    margin: 8px 0;
    font-size: 12px;
    font-family: var(--font-mono, ui-monospace, monospace);
    white-space: pre-wrap;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
  .actions button {
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--border);
  }
  .actions .secondary {
    background: var(--bg-button);
    color: var(--text);
  }
  .actions .secondary:hover {
    background: var(--bg-button-hover);
  }
  .actions .primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-weight: 500;
  }
  .actions .primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
