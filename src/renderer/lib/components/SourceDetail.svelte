<script lang="ts">
  import { api } from '../ipc/client';
  import Preview from './Preview.svelte';
  import { renderInlineWithMath } from '../markdown/inline-math';
  import type { SourceDetail, SourceExcerpt, SourceBacklink } from '../../../shared/types';

  interface Props {
    sourceId: string;
    highlightExcerptId?: string;
    onNavigate: (target: string) => void;
    onShowConfirm: (message: string, key: string, label?: string) => Promise<boolean>;
    onDeleted?: (sourceId: string) => void;
  }

  let { sourceId, highlightExcerptId, onNavigate, onShowConfirm, onDeleted }: Props = $props();

  async function handleDelete() {
    if (!detail) return;
    const label = detail.metadata.title ?? sourceId;
    const confirmed = await onShowConfirm(
      `Delete source "${label}"? Any excerpts from this source will also be removed.`,
      'delete-source',
      'Delete',
    );
    if (!confirmed) return;
    await api.sources.delete(sourceId);
    onDeleted?.(sourceId);
  }

  let detail = $state<SourceDetail | null>(null);
  let loading = $state(true);
  let loadedId = $state<string | null>(null);

  // body.md is the extracted content from ingest (or hand-authored for
  // manually-placed sources). Null means the file doesn't exist for this
  // source — older sources without bodies stay tidy with no "Content" header.
  let bodyContent = $state<string | null>(null);
  let bodyLoaded = $state(false);
  let bodyLoadedFor = $state<string | null>(null);
  let editMode = $state(false);
  let draftBody = $state('');
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  const bodyRelativePath = $derived(`.minerva/sources/${sourceId}/body.md`);

  async function load(id: string) {
    loading = true;
    loadedId = id;
    try {
      detail = await api.graph.sourceDetail(id);
    } finally {
      loading = false;
    }
  }

  async function loadBody(id: string) {
    bodyLoaded = false;
    bodyLoadedFor = id;
    editMode = false;
    saveError = null;
    try {
      bodyContent = await api.notebase.readFile(`.minerva/sources/${id}/body.md`);
    } catch {
      // body.md is optional; sources can ship meta-only.
      bodyContent = null;
    } finally {
      bodyLoaded = true;
    }
  }

  $effect(() => {
    if (sourceId !== loadedId) {
      void load(sourceId);
    }
  });

  $effect(() => {
    if (sourceId !== bodyLoadedFor) {
      void loadBody(sourceId);
    }
  });

  function enterEditMode() {
    draftBody = bodyContent ?? '';
    saveError = null;
    editMode = true;
  }

  function cancelEdit() {
    editMode = false;
    draftBody = '';
    saveError = null;
  }

  async function saveBody() {
    saving = true;
    saveError = null;
    try {
      await api.notebase.writeFile(bodyRelativePath, draftBody);
      bodyContent = draftBody;
      editMode = false;
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  // ── Highlight → Excerpt (#224) ──────────────────────────────────────────

  // Right-click inside the rendered body with text selected → show a small
  // menu with "Save as excerpt". Click invokes the main-process create, then
  // the file-watcher broadcast refreshes the Excerpts list below.
  let excerptMenu = $state<{ x: number; y: number; text: string } | null>(null);
  let excerptError = $state<string | null>(null);
  let creatingExcerpt = $state(false);
  let recentExcerpt = $state<{ id: string; duplicate: boolean } | null>(null);

  function handleBodyContextMenu(e: MouseEvent): void {
    if (editMode) return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) return; // no selection — let the native context menu show
    e.preventDefault();
    excerptMenu = { x: e.clientX, y: e.clientY, text };
    excerptError = null;
    const close = () => {
      excerptMenu = null;
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  async function saveExcerpt(): Promise<void> {
    if (!excerptMenu) return;
    const citedText = excerptMenu.text;
    creatingExcerpt = true;
    excerptError = null;
    try {
      const result = await api.sources.createExcerpt({ sourceId, citedText });
      recentExcerpt = { id: result.excerptId, duplicate: result.duplicate };
      excerptMenu = null;
      // Reload the source detail so the new excerpt shows up in the list
      // even before the file-watcher's broadcast arrives.
      await load(sourceId);
      // Clear the "just-saved" banner after a moment.
      setTimeout(() => { recentExcerpt = null; }, 4000);
    } catch (err) {
      excerptError = err instanceof Error ? err.message : String(err);
    } finally {
      creatingExcerpt = false;
    }
  }

  // Reload the source detail when the main process tells us an excerpt
  // was added/updated/removed (covers cross-window sync and any direct
  // filesystem edits the user made to excerpt ttls).
  api.sources.onExcerptsChanged(() => {
    if (loadedId === sourceId) void load(sourceId);
  });

  // After render, if a specific excerpt was highlighted, scroll it into view.
  $effect(() => {
    if (!detail || !highlightExcerptId) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-excerpt-anchor="${CSS.escape(highlightExcerptId!)}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  });

  function formatByline(creators: string[], year: string | null): string {
    const who = creators.length === 0 ? ''
      : creators.length === 1 ? creators[0]
      : creators.length === 2 ? `${creators[0]} and ${creators[1]}`
      : `${creators[0]} et al.`;
    if (who && year) return `${who} (${year})`;
    return who || (year ?? '');
  }

  function openExternal(url: string) {
    void api.shell.openExternal(url);
  }

  function excerptLocation(e: SourceExcerpt): string {
    if (e.pageRange) return `pp. ${e.pageRange}`;
    if (e.page) return `p. ${e.page}`;
    if (e.locationText) return e.locationText;
    return '';
  }

  function backlinkLabel(b: SourceBacklink): string {
    return b.kind === 'cite' ? 'cites' : 'quotes';
  }
</script>

<div class="source-detail">
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if !detail}
    <div class="missing">
      <h1>Source not found</h1>
      <p class="muted">
        No source with id <code>{sourceId}</code> is in the graph. Make sure
        <code>.minerva/sources/{sourceId}/meta.ttl</code> exists and the graph has been rebuilt.
      </p>
    </div>
  {:else}
    <header>
      <div class="subtype">{detail.metadata.subtype ?? 'Source'}</div>
      <h1>{@html renderInlineWithMath(detail.metadata.title ?? sourceId)}</h1>
      {#if detail.metadata.creators.length || detail.metadata.year}
        <div class="byline">{formatByline(detail.metadata.creators, detail.metadata.year)}</div>
      {/if}
    </header>

    <section class="metadata">
      {#if detail.metadata.publisher}
        <div class="kv"><span class="k">Publisher</span><span class="v">{detail.metadata.publisher}</span></div>
      {/if}
      {#if detail.metadata.doi}
        {@const doiHref = `https://doi.org/${detail.metadata.doi}`}
        <div class="kv">
          <span class="k">DOI</span>
          <span class="v">
            <a class="external" href={doiHref} onclick={(e) => { e.preventDefault(); openExternal(doiHref); }}>{detail.metadata.doi}</a>
          </span>
        </div>
      {/if}
      {#if detail.metadata.uri}
        {@const uriHref = detail.metadata.uri}
        <div class="kv">
          <span class="k">URL</span>
          <span class="v">
            <a class="external" href={uriHref} onclick={(e) => { e.preventDefault(); openExternal(uriHref); }}>{uriHref}</a>
          </span>
        </div>
      {/if}
      <div class="kv"><span class="k">Source id</span><span class="v mono">{detail.metadata.sourceId}</span></div>
      <div class="actions">
        <button class="action-btn" onclick={handleDelete}>Delete source</button>
      </div>
    </section>

    {#if detail.metadata.abstract}
      <section class="abstract">
        <h2>Abstract</h2>
        <p>{@html renderInlineWithMath(detail.metadata.abstract)}</p>
      </section>
    {/if}

    {#if bodyLoaded && (bodyContent !== null || editMode)}
      <section class="body">
        <div class="body-header">
          <h2>Content</h2>
          {#if !editMode}
            <button class="body-edit" onclick={enterEditMode}>Edit body</button>
          {/if}
        </div>
        {#if editMode}
          <textarea
            class="body-editor"
            bind:value={draftBody}
            spellcheck="false"
            autocomplete="off"
          ></textarea>
          {#if saveError}
            <div class="save-error">{saveError}</div>
          {/if}
          <div class="body-actions">
            <button class="btn primary" disabled={saving} onclick={saveBody}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button class="btn secondary" disabled={saving} onclick={cancelEdit}>Cancel</button>
          </div>
        {:else if bodyContent !== null}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="body-view" oncontextmenu={handleBodyContextMenu}>
            <Preview content={bodyContent} onNavigate={onNavigate} />
          </div>
          {#if recentExcerpt}
            <div class="excerpt-banner" class:duplicate={recentExcerpt.duplicate}>
              {recentExcerpt.duplicate
                ? 'That passage was already saved as an excerpt.'
                : 'Saved as excerpt'}
              <code>{recentExcerpt.id}</code>
            </div>
          {/if}
          {#if excerptError}
            <div class="save-error">Couldn't save excerpt: {excerptError}</div>
          {/if}
        {/if}
      </section>
    {/if}

    {#if excerptMenu}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div
        class="excerpt-menu"
        style:left="{excerptMenu.x}px"
        style:top="{excerptMenu.y}px"
        onmousedown={(e) => e.preventDefault()}
      >
        <button disabled={creatingExcerpt} onclick={saveExcerpt}>
          {creatingExcerpt ? 'Saving…' : 'Save as excerpt'}
        </button>
      </div>
    {/if}

    <section>
      <h2>Excerpts ({detail.excerpts.length})</h2>
      {#if detail.excerpts.length === 0}
        <p class="muted">No excerpts linked to this source yet.</p>
      {:else}
        <ul class="excerpt-list">
          {#each detail.excerpts as excerpt}
            <li
              data-excerpt-anchor={excerpt.excerptId}
              class:highlighted={excerpt.excerptId === highlightExcerptId}
            >
              {#if excerpt.citedText}
                <blockquote>{excerpt.citedText}</blockquote>
              {:else}
                <p class="muted">No cited text</p>
              {/if}
              <div class="excerpt-meta">
                <span class="mono">{excerpt.excerptId}</span>
                {#if excerptLocation(excerpt)}
                  <span class="sep">·</span>
                  <span>{excerptLocation(excerpt)}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2>Referenced from ({detail.backlinks.length})</h2>
      {#if detail.backlinks.length === 0}
        <p class="muted">No notes reference this source.</p>
      {:else}
        <ul class="backlink-list">
          {#each detail.backlinks as b}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <li onclick={() => onNavigate(b.relativePath)}>
              <span class="backlink-title">{b.title}</span>
              <span class="backlink-meta">
                <span class="backlink-kind">{backlinkLabel(b)}</span>
                {#if b.viaExcerptId}
                  <span class="sep">·</span>
                  <span class="mono">{b.viaExcerptId}</span>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .source-detail {
    flex: 1;
    overflow-y: auto;
    padding: 32px 48px;
    max-width: 820px;
    font-size: 15px;
    line-height: 1.6;
    color: var(--text);
  }

  header {
    margin-bottom: 20px;
  }

  .subtype {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    background: var(--bg-button);
    padding: 2px 8px;
    border-radius: 3px;
    margin-bottom: 8px;
  }

  h1 {
    font-size: 26px;
    font-weight: 600;
    margin: 0 0 6px;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin: 24px 0 12px;
  }

  .byline {
    color: var(--text-muted);
    font-size: 14px;
  }

  section {
    margin-bottom: 12px;
  }

  .metadata {
    border-top: 1px solid var(--border);
    padding-top: 16px;
    margin-top: 16px;
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 6px 16px;
  }

  .kv { display: contents; }
  .actions {
    grid-column: 1 / -1;
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
  .action-btn {
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .action-btn:hover { background: var(--bg-button-hover); }
  .k {
    color: var(--text-muted);
    font-size: 13px;
  }
  .v {
    font-size: 14px;
    word-break: break-word;
  }
  .mono {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px;
  }

  .external {
    color: var(--accent);
    cursor: pointer;
  }
  .external:hover { text-decoration: underline; }

  .abstract p {
    font-size: 14px;
    color: var(--text-muted);
    margin: 0;
  }

  .body-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .body-edit {
    border: 1px solid var(--border);
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
  }
  .body-edit:hover {
    background: var(--bg-button-hover);
  }

  .body-view {
    /* Preview has its own padding; reset it so the body sits flush within
     * the source panel's existing padding. */
    margin-left: -48px;
    margin-right: -48px;
  }
  .body-view :global(.preview) {
    padding: 0 48px;
    overflow-y: visible;
  }

  .body-editor {
    width: 100%;
    min-height: 300px;
    padding: 12px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
  }
  .body-editor:focus {
    outline: none;
    border-color: var(--accent);
  }

  .body-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .btn {
    padding: 5px 14px;
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .btn.primary:hover:not(:disabled) { opacity: 0.9; }
  .btn.secondary {
    background: var(--bg-button);
    color: var(--text);
  }
  .btn.secondary:hover:not(:disabled) {
    background: var(--bg-button-hover);
  }

  .save-error {
    color: var(--text);
    background: var(--bg-button);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 12px;
    margin-top: 8px;
    font-size: 12px;
  }

  .excerpt-menu {
    position: fixed;
    z-index: 100;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    padding: 4px;
    min-width: 160px;
  }
  .excerpt-menu button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
  }
  .excerpt-menu button:hover:not(:disabled) {
    background: var(--bg-button);
  }
  .excerpt-menu button:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .excerpt-banner {
    margin-top: 8px;
    padding: 6px 10px;
    border-left: 3px solid var(--accent);
    background: var(--bg-button);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .excerpt-banner.duplicate {
    border-left-color: var(--text-muted);
  }
  .excerpt-banner code {
    font-size: 11px;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
  }

  .muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .excerpt-list, .backlink-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .excerpt-list li {
    border-left: 3px solid var(--border);
    padding: 8px 12px;
    margin: 0 0 12px;
    transition: border-color 0.15s;
  }
  .excerpt-list li.highlighted {
    border-left-color: var(--accent);
    background: var(--bg-button);
  }

  .excerpt-list blockquote {
    margin: 0 0 6px;
    font-style: italic;
    color: var(--text);
  }

  .excerpt-meta {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sep { opacity: 0.5; }

  .backlink-list li {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .backlink-list li:hover { background: var(--bg-button); }
  .backlink-list li:last-child { border-bottom: none; }

  .backlink-title {
    color: var(--accent);
  }

  .backlink-meta {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .backlink-kind {
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.3px;
    font-weight: 600;
  }

  code {
    background: var(--bg-button);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px;
  }

  .missing h1 {
    font-size: 18px;
    margin-bottom: 8px;
  }
</style>
