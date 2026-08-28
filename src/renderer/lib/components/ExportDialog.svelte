<script lang="ts">
  /**
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and backdrop-click
   * are Dialog's job. Previously this dialog had NO keydown handler at all
   * (Escape did nothing); Dialog's window-capture listener is a genuine new
   * capability here, not a behavior change to preserve. The title also grows
   * from 16px to Dialog's standard 19px — a deliberate consistency change
   * (the whole point of #1888), not an accident.
   */
  import { api } from '../ipc/client';
  import { getPublishStore } from '../stores/publish.svelte';
  import type { ExportPreviewPlan, ExporterInfo } from '../ipc/client';
  import Dialog from './ui/Dialog.svelte';

  const publish = getPublishStore();

  interface Props {
    /** Format-family group id the menu launched with (#: export-menu-redesign). */
    group: string;
    /** The note the user currently has open — used for note/folder/tree scope. */
    activeFilePath: string | null;
    /** The source whose tab is active, if any — enables the `source` scope. */
    activeSourceId: string | null;
    /** Close the dialog without exporting. */
    onCancel: () => void;
    /**
     * Run the export. The dialog calls `publish.runExport` (publish store)
     * and passes the result up so the caller can show a toast / open
     * the output dir. `null` when the user cancelled the directory picker.
     */
    onExported: (result: { filesWritten: number; summary: string; outputDir: string; writtenPaths: string[] }) => void;
  }

  let { group, activeFilePath, activeSourceId, onCancel, onExported }: Props = $props();

  type Scope = 'project' | 'folder' | 'single-note' | 'tree' | 'source';
  type LinkPolicy = 'drop' | 'inline-title' | 'follow-to-file';

  let scope = $state<Scope>('project');
  // Index into scopeCandidates — the variant within a family at the chosen
  // scope (e.g. Markdown Cleaned vs Verbatim). Usually there's only one.
  let variantIndex = $state(0);
  // How many wiki-link hops out from the current note the 'tree' scope walks
  // (#: export-menu-redesign). 1 = this note + what it directly links to.
  let treeDepth = $state(3);
  let linkPolicy = $state<LinkPolicy>('inline-title');
  let citationStyle = $state<string>('apa');
  let citationLocale = $state<string>('en-US');
  let plan = $state<ExportPreviewPlan | null>(null);
  let loading = $state(false);
  let exporting = $state(false);
  let error = $state<string | null>(null);
  // Every exporter in the launched family. The dialog resolves which concrete
  // one runs from (group + scope + variant).
  let groupExporters = $state<ExporterInfo[]>([]);
  let loaded = $state(false);
  // Per-export exclusion overrides (#283). Set of relative paths the
  // user has explicitly re-included; the pipeline force-includes them
  // even when the private-by-default rules would otherwise exclude.
  let overrides = $state(new Set<string>());
  // Manual deselections (#293). Set of relative paths the user has
  // unchecked in the Including list; the pipeline force-excludes them
  // and surfaces them in Excluded with reason "manually excluded".
  let deselections = $state(new Set<string>());

  function toggleOverride(relativePath: string): void {
    const next = new Set(overrides);
    if (next.has(relativePath)) next.delete(relativePath);
    else next.add(relativePath);
    overrides = next;
  }

  function toggleDeselection(relativePath: string): void {
    const next = new Set(deselections);
    if (next.has(relativePath)) next.delete(relativePath);
    else next.add(relativePath);
    deselections = next;
  }

  const activeFolder = $derived.by(() => {
    if (!activeFilePath) return '';
    const slash = activeFilePath.lastIndexOf('/');
    return slash >= 0 ? activeFilePath.slice(0, slash) : '';
  });

  const groupLabel = $derived(groupExporters[0]?.group.label ?? 'Export');

  // A scope is offered only when the family supports it AND the current
  // context can satisfy it (a note open for note/folder/tree; a source tab
  // for source). Unavailable scopes are hidden, not disabled — the menu is
  // format-first, so the live scopes follow from what you're looking at.
  function scopeAvailable(s: Scope): boolean {
    if (!groupExporters.some((e) => e.acceptedKinds.includes(s))) return false;
    if (s === 'project') return true;
    if (s === 'source') return activeSourceId != null;
    return activeFilePath != null; // single-note / folder / tree
  }
  const SCOPE_ORDER: Scope[] = ['single-note', 'folder', 'tree', 'project', 'source'];
  const availableScopes = $derived(SCOPE_ORDER.filter(scopeAvailable));

  // Exporters in this family valid at the chosen scope, sorted for the variant
  // picker (Markdown → Cleaned / Verbatim / Bundle). Usually exactly one.
  const scopeCandidates = $derived(
    groupExporters
      .filter((e) => e.acceptedKinds.includes(scope))
      .sort((a, b) => a.variantOrder - b.variantOrder || a.label.localeCompare(b.label)),
  );
  const selectedExporterId = $derived((scopeCandidates[variantIndex] ?? scopeCandidates[0])?.id ?? '');

  function scopeInput(): { kind: Scope; relativePath?: string; maxDepth?: number } {
    if (scope === 'single-note') return { kind: 'single-note', relativePath: activeFilePath ?? '' };
    if (scope === 'folder') return { kind: 'folder', relativePath: activeFolder };
    if (scope === 'tree') return { kind: 'tree', relativePath: activeFilePath ?? '', maxDepth: treeDepth };
    if (scope === 'source') return { kind: 'source', relativePath: activeSourceId ?? '' };
    return { kind: 'project' };
  }

  async function refreshPlan(): Promise<void> {
    if (!selectedExporterId) { plan = null; return; }
    loading = true;
    error = null;
    try {
      plan = await api.publish.resolvePlan(scopeInput(), {
        exporterId: selectedExporterId,
        linkPolicy,
        citationStyle,
        citationLocale,
        forceInclude: [...overrides],
        forceExclude: [...deselections],
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      plan = null;
    } finally {
      loading = false;
    }
  }

  // On mount, load the family's exporters and pick a sensible default scope:
  // the current note if the family handles it, else the current source, else
  // the whole project, else whatever's available.
  $effect(() => {
    void group; // re-load if the launched family changes
    void (async () => {
      const all = await api.publish.listExporters();
      groupExporters = all.filter((e) => e.group.id === group);
      const avail = SCOPE_ORDER.filter(scopeAvailable);
      if (!avail.includes(scope)) {
        scope = avail.includes('single-note') ? 'single-note'
          : avail.includes('source') ? 'source'
          : avail.includes('project') ? 'project'
          : avail[0] ?? 'project';
      }
      loaded = true;
    })();
  });

  // Reset the variant when scope changes so the index can't dangle onto a
  // candidate that doesn't exist at the new scope.
  $effect(() => { void scope; variantIndex = 0; });

  // Re-resolve whenever an input affecting the plan changes.
  $effect(() => {
    void scope;
    void variantIndex;
    void treeDepth;
    void linkPolicy;
    void citationStyle;
    void citationLocale;
    void activeFilePath;
    void overrides;
    void deselections;
    if (!loaded) return;
    void refreshPlan();
  });

  async function handleExport(): Promise<void> {
    if (!plan || !selectedExporterId) return;
    exporting = true;
    error = null;
    try {
      const result = await publish.runExport({
        exporterId: selectedExporterId,
        input: scopeInput(),
        linkPolicy,
        citationStyle,
        citationLocale,
        forceInclude: [...overrides],
        forceExclude: [...deselections],
      });
      if (result === null) return; // user cancelled the directory picker
      onExported(result);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      exporting = false;
    }
  }
</script>

<Dialog width={720} onClose={onCancel} titleId="export-dialog-title">
  {#snippet eyebrow()}Export{/snippet}
  {#snippet title()}Export as {groupLabel}{/snippet}
  {#snippet body()}
    {#if loaded && availableScopes.length === 0}
      <div class="empty-scope">
        {#if groupExporters.some((e) => e.acceptedKinds.includes('source'))}
          Open a source to export it as {groupLabel}.
        {:else}
          Open a note to export it as {groupLabel}.
        {/if}
      </div>
    {/if}

    {#if availableScopes.length > 0}
      <div class="option-row">
        <span class="field-label">Scope</span>
        <div class="radio-group">
          {#if availableScopes.includes('single-note')}
            <label>
              <input type="radio" name="scope" value="single-note" bind:group={scope} />
              Current note{activeFilePath ? ` (${activeFilePath})` : ''}
            </label>
          {/if}
          {#if availableScopes.includes('folder')}
            <label>
              <input type="radio" name="scope" value="folder" bind:group={scope} />
              Current folder ({activeFolder || 'root'})
            </label>
          {/if}
          {#if availableScopes.includes('tree')}
            <label>
              <input type="radio" name="scope" value="tree" bind:group={scope} />
              Linked notes <span class="scope-hint">— this note and the notes it links to</span>
            </label>
          {/if}
          {#if availableScopes.includes('project')}
            <label>
              <input type="radio" name="scope" value="project" bind:group={scope} />
              Entire project
            </label>
          {/if}
          {#if availableScopes.includes('source')}
            <label>
              <input type="radio" name="scope" value="source" bind:group={scope} />
              This source{activeSourceId ? ` (${activeSourceId})` : ''}
            </label>
          {/if}
        </div>
      </div>
    {/if}

    {#if scope === 'tree'}
      <div class="option-row">
        <span class="field-label">Depth</span>
        <div class="depth-control">
          <select bind:value={treeDepth}>
            {#each [1, 2, 3, 4, 5] as d (d)}
              <option value={d}>{d} hop{d === 1 ? '' : 's'}</option>
            {/each}
          </select>
          <span class="scope-hint">
            how far to follow links out from this note{plan ? ` — ${plan.inputs.length} note${plan.inputs.length === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </div>
    {/if}

    {#if scopeCandidates.length > 1}
      <div class="option-row">
        <span class="field-label">Variant</span>
        <div class="radio-group">
          {#each scopeCandidates as cand, i (cand.id)}
            <label>
              <input type="radio" name="variant" checked={variantIndex === i} onchange={() => (variantIndex = i)} />
              {cand.variantLabel ?? cand.label}
            </label>
          {/each}
        </div>
      </div>
    {/if}

    <div class="option-row">
      <label for="link-policy">Link handling</label>
      <select id="link-policy" bind:value={linkPolicy}>
        <option value="inline-title">Replace wiki-links with target title</option>
        <option value="follow-to-file">Rewrite wiki-links to .md file links</option>
        <option value="drop">Drop wiki-links (keep display text only)</option>
      </select>
    </div>

    {#if plan}
      <div class="option-row">
        <label for="citation-style">Citation style</label>
        <select id="citation-style" bind:value={citationStyle}>
          {#each plan.citations.availableStyles as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </div>

      <div class="option-row">
        <label for="citation-locale">Citation locale</label>
        <select id="citation-locale" bind:value={citationLocale}>
          {#each plan.citations.availableLocales as l (l.id)}
            <option value={l.id}>{l.label}</option>
          {/each}
        </select>
      </div>
    {/if}

    {#if loading}
      <div class="status">Resolving plan…</div>
    {:else if plan}
      <div class="audit">
        <div class="audit-section">
          <h3>
            Including <span class="count">{plan.inputs.length}</span>
            {#if overrides.size > 0}
              <span class="count override-count" title="{overrides.size} item{overrides.size === 1 ? '' : 's'} re-included via override">
                {overrides.size} overridden
              </span>
            {/if}
            {#if deselections.size > 0}
              <span class="count override-count" title="{deselections.size} item{deselections.size === 1 ? '' : 's'} manually excluded for this export">
                {deselections.size} unchecked
              </span>
            {/if}
          </h3>
          {#if plan.inputs.length === 0}
            <p class="empty">Nothing to export in this scope.</p>
          {:else}
            <p class="hint">Uncheck a row to drop it from this export only.</p>
            <ul>
              {#each plan.inputs.slice(0, 40) as f (f.relativePath)}
                <li class:overridden={f.overridden}>
                  <input
                    type="checkbox"
                    class="row-check"
                    checked
                    onchange={() => toggleDeselection(f.relativePath)}
                    title="Uncheck to drop this note from the export"
                  />
                  <span class="row-title">
                    {f.title}
                    {#if f.overridden}
                      <button
                        class="badge-btn"
                        onclick={() => toggleOverride(f.relativePath)}
                        title="Click to remove the override and exclude this note again"
                      >overridden ✕</button>
                    {/if}
                  </span>
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
            <p class="hint">Click any excluded row to re-include it in this export.</p>
            <ul>
              {#each plan.excluded.slice(0, 40) as ex (ex.relativePath)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <li
                  class="clickable"
                  onclick={() => (
                    ex.reason === 'manually excluded'
                      ? toggleDeselection(ex.relativePath)
                      : toggleOverride(ex.relativePath)
                  )}
                  title="Click to re-include in the export"
                >
                  <span class="row-title">{ex.relativePath}</span>
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

      {#if plan.citations.bySource.length > 0 || plan.citations.missing.length > 0}
        <div class="audit-section citations-section">
          <h3>
            Citations <span class="count">{plan.citations.bySource.length}</span>
            {#if plan.citations.missing.length > 0}
              <span class="count missing-count">{plan.citations.missing.length} missing</span>
            {/if}
          </h3>
          {#if plan.citations.missing.length > 0}
            <ul class="missing-list">
              {#each plan.citations.missing as m (m.kind + ':' + m.id)}
                <li>
                  <span class="row-title">[missing {m.kind}: {m.id}]</span>
                  <span class="reason">{m.refCount} reference{m.refCount === 1 ? '' : 's'}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if plan.citations.bySource.length > 0}
            <ul>
              {#each plan.citations.bySource.slice(0, 60) as s (s.sourceId)}
                <li>
                  <span class="row-title">{s.title}</span>
                  <span class="reason">{s.sourceId} · {s.refCount} ref{s.refCount === 1 ? '' : 's'}</span>
                </li>
              {/each}
              {#if plan.citations.bySource.length > 60}
                <li class="more">…and {plan.citations.bySource.length - 60} more</li>
              {/if}
            </ul>
          {/if}
        </div>
      {/if}
    {/if}

    {#if error}
      <div class="error">{error}</div>
    {/if}
  {/snippet}
  {#snippet footerRight()}
    <button class="secondary" onclick={onCancel} disabled={exporting}>Cancel</button>
    <button
      class="primary"
      onclick={handleExport}
      disabled={exporting || loading || !plan || !selectedExporterId || plan.inputs.length === 0}
    >
      {exporting ? 'Exporting…' : 'Export…'}
    </button>
  {/snippet}
</Dialog>

<style>
  .option-row {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    font-size: 12px;
  }
  .option-row > label:first-child,
  .field-label {
    min-width: 90px;
    color: var(--text-muted);
    padding-top: 3px;
  }

  .empty-scope {
    font-size: 12px;
    color: var(--text-muted);
    background: var(--bg-button);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }

  .scope-hint {
    color: var(--text-muted);
    font-size: 11px;
  }

  .depth-control {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .depth-control select {
    flex: 0 0 auto;
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
  .row-title {
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

  /* Including-row checkbox for manual deselection (#293). */
  .audit-section .row-check {
    margin-right: 6px;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 3px;
  }
  .audit-section li {
    flex-direction: row;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .audit-section li > .row-title,
  .audit-section li > .path,
  .audit-section li > .reason {
    flex-basis: 100%;
  }
  .audit-section li > .row-check ~ .row-title,
  .audit-section li > .row-check ~ .path {
    flex-basis: calc(100% - 22px);
  }

  /* Excluded-row click affordance + override badge (#283). */
  .audit-section li.clickable {
    cursor: pointer;
  }
  .audit-section li.clickable:hover {
    background: var(--bg-button);
  }
  .audit-section .hint {
    margin: 0 0 6px;
    font-size: 10px;
    color: var(--text-muted);
    font-style: italic;
  }
  .audit-section li.overridden .row-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .audit-section .badge-btn {
    background: var(--bg-button);
    color: var(--accent);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 9px;
    font-weight: 500;
    padding: 1px 8px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .audit-section .badge-btn:hover { background: var(--bg-button-hover); }
  .audit-section .override-count {
    background: var(--bg-button);
    color: var(--accent);
    font-weight: 600;
  }

  /* Citations span the full grid width — they're a separate concern from
     Including/Excluded so the user can audit them at full reading width. */
  .citations-section {
    grid-column: 1 / -1;
    margin-top: 8px;
  }
  /* Missing-source pill per §10.5 — rust signal color instead of accent.
     Per CLAUDE.md "no danger styling" — rust is signal, not red. */
  .citations-section .missing-count {
    background: color-mix(in oklch, var(--rust) 18%, transparent);
    color: var(--rust);
    font-family: var(--font-mono);
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
  }
  .citations-section .missing-list .row-title {
    color: var(--rust);
  }
  .citations-section .missing-list {
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px dashed var(--border);
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

  .secondary {
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg-button);
    color: var(--text);
  }
  .secondary:hover:not(:disabled) {
    background: var(--bg-button-hover);
  }
  .primary {
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 500;
  }
  .primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
