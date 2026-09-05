<script lang="ts">
  import { api } from '../ipc/client';
  import type { SourceMetadata, Collection, SmartCollection, ReadStatus } from '../../../shared/types';
  import { displaySourceTitle } from '../../../shared/source-display';
  import { clampMenuToViewport, clampSubmenu } from '../utils/menuClamp';
  import { installDismissOnClickOutside } from '../dismiss-menu';
  import SourcePickerDialog from './SourcePickerDialog.svelte';
  import CollectionPickerDialog from './CollectionPickerDialog.svelte';
  import CollectionsTree from './CollectionsTree.svelte';
  import ReadingQueueSection from './ReadingQueueSection.svelte';
  import SourceListItem from './SourceListItem.svelte';
  import { formatDueStamp } from '../sources/source-display';
  import { renameSource, deleteSource, addSourceTag, sourceTagSuggestions } from '../sources/source-actions';
  import { collectionSubtree, membersInSubtree, filterSources } from '../sources/collection-tree';
  import { QUEUE_VIEWS, type QueueView } from '../sources/reading-queue';
  import Icon from './Icon.svelte';
  import { getSourceDataStore } from '../stores/source-data.svelte';
  import { logger } from '../../../shared/logger';

  const sourceData = getSourceDataStore();

  const STATUS_OPTIONS: { value: ReadStatus; label: string }[] = [
    { value: 'unread', label: 'Mark unread' },
    { value: 'reading', label: 'Mark reading' },
    { value: 'read', label: 'Mark read' },
    { value: 'skipped', label: 'Mark skipped' },
  ];

  interface Props {
    onSourceSelect: (sourceId: string) => void;
    onSourceDeleted?: (sourceId: string) => void;
    onShowConfirm: (message: string, key: string, label?: string) => Promise<boolean>;
    onShowPrompt: (message: string, initialOrOptions?: string | { suggestions?: string[]; initial?: string }) => Promise<string | null>;
    /** Open a freshly-ingested source in a tab. Wired by the host so
     *  the "+" button's smart-paste path lands the user on the new
     *  source without an extra click. (#473) */
    onSourceOpened?: (sourceId: string) => void;
    /** Mine the source's References section into stub Source nodes
     *  (#106). Host orchestrates the LLM call + review dialog. */
    onMineReferences?: (source: SourceMetadata) => Promise<void>;
  }

  let { onSourceSelect, onSourceDeleted, onShowConfirm, onShowPrompt, onSourceOpened, onMineReferences }: Props = $props();

  let sources = $state<SourceMetadata[]>([]);
  let filter = $state('');
  let contextMenu = $state<{ x: number; y: number; source: SourceMetadata } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();
  /** When set, the merge picker is open with this source as the src. */
  let mergeSrc = $state<SourceMetadata | null>(null);
  /** When set, the collection picker is open to add this source to one. */
  let addToCollectionFor = $state<SourceMetadata | null>(null);

  /** Active queue view id, or null when no queue row is selected. The
   *  queue rows and collection rows share the focus slot but live in
   *  separate state vars because they resolve their members
   *  differently (built-in vs. user-defined). */
  let activeQueueView = $state<QueueView | null>(null);
  /** Source ids for the active queue view, re-fetched on demand. */
  let queueMembers = $state<Set<string> | null>(null);
  let queueSectionRef = $state<ReadingQueueSection>();

  let collections = $state<Collection[]>([]);
  let smartCollections = $state<SmartCollection[]>([]);
  /** Currently focused collection id; null = "All sources". Manual and
   *  smart ids live in the same namespace (the backend uniqueIdFor
   *  enforces this) so a single field is enough. */
  let activeCollectionId = $state<string | null>(null);
  /** Members of the currently focused smart collection. Re-fetched
   *  when activeCollectionId changes to a smart entry, since
   *  membership is derived not stored. */
  let smartMembers = $state<Set<string> | null>(null);

  function adjustSubmenu(event: MouseEvent) {
    clampSubmenu(event.currentTarget as HTMLElement);
  }

  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });

  // Fetch on mount so the panel populates whenever it's switched into,
  // not only when the host calls refresh().
  $effect(() => {
    void refresh();
    void refreshCollections();
  });

  // The main process broadcasts COLLECTIONS_CHANGED after any mutation
  // (including from other windows / direct file edits). Keep our tree
  // in sync without forcing the host to call refresh() explicitly.
  //
  // This panel lives behind a {#if activePanel === 'sites'} in Sidebar.svelte
  // — switching sidebar tabs destroys and recreates it — so the subscription
  // MUST be torn down on unmount (#1890) or every tab switch leaks another
  // listener, each firing refreshCollections() on the next change.
  $effect(() => sourceData.onCollectionsChanged(() => { void refreshCollections(); }));

  async function refreshCollections(): Promise<void> {
    const data = await api.collections.list();
    collections = data.collections;
    smartCollections = data.smartCollections ?? [];
    // If the active smart collection still exists, refresh its
    // membership in case the predicate changed (rename doesn't, but
    // edit-predicate does). Cheap enough to always do.
    if (activeCollectionId && smartCollections.some((s) => s.id === activeCollectionId)) {
      smartMembers = new Set((await api.collections.smartMembers(activeCollectionId)).map((s) => s.sourceId));
    } else if (activeCollectionId && !collections.some((c) => c.id === activeCollectionId)) {
      // The active collection was deleted by an out-of-band edit.
      activeCollectionId = null;
      smartMembers = null;
    }
  }

  function handleContextMenu(e: MouseEvent, source: SourceMetadata) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, source };
    installDismissOnClickOutside(() => { contextMenu = null; });
  }

  async function handleDelete(source: SourceMetadata) {
    contextMenu = null;
    await deleteSource(source, onShowConfirm, () => {
      onSourceDeleted?.(source.sourceId);
      return refresh();
    });
  }

  async function handleRenameSource(source: SourceMetadata): Promise<void> {
    contextMenu = null;
    // No onDone: setTitle broadcasts SOURCES_CHANGED → host refreshes the sidebar.
    await renameSource(source, onShowPrompt);
  }

  async function handleAddTag(source: SourceMetadata): Promise<void> {
    contextMenu = null;
    // Offer the project tag vocabulary (minus what this source already has) as
    // autocomplete, so tags get reused rather than re-spelled.
    const suggestions = await sourceTagSuggestions(source);
    const tag = await onShowPrompt('Add tag to source:', { suggestions });
    if (!tag || !tag.trim()) return;
    // No onDone: addTag broadcasts SOURCES_CHANGED → host refreshes the sidebar.
    await addSourceTag(source.sourceId, tag);
  }

  function handleMergeStart(source: SourceMetadata) {
    contextMenu = null;
    mergeSrc = source;
  }

  async function handleMergePick(destId: string) {
    const src = mergeSrc;
    mergeSrc = null;
    if (!src) return;
    const srcLabel = src.title ?? src.sourceId;
    const dest = sources.find((s) => s.sourceId === destId);
    const destLabel = dest?.title ?? destId;
    const confirmed = await onShowConfirm(
      `Merge "${srcLabel}" into "${destLabel}"?\n\nExcerpts and citations of "${srcLabel}" will move to "${destLabel}", then "${srcLabel}" will be removed.`,
      'merge-sources',
      'Merge',
    );
    if (!confirmed) return;
    try {
      await sourceData.merge(src.sourceId, destId);
      onSourceDeleted?.(src.sourceId);
      await refresh();
    } catch (err) {
      logger('sources').error('Merge sources failed:', err);
      // No dedicated error toast yet — surface the message via the
      // confirm dialog as an informational pop, dismissable via OK.
      await onShowConfirm(
        `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
        'merge-sources-error',
        'OK',
      );
    }
  }

  export async function refresh(): Promise<void> {
    sources = await api.sources.listAll();
    void queueSectionRef?.refreshCounts();
    if (activeQueueView) {
      queueMembers = new Set((await api.sources.queueMembers(activeQueueView)).map((s) => s.sourceId));
    }
  }

  // Sources change → host App.svelte's sources.onChanged listener
  // calls sidebar.refreshSources() which calls our refresh() above,
  // and that already kicks off the queue section's own recount.

  const activeIsSmart = $derived(
    !!activeCollectionId && smartCollections.some((s) => s.id === activeCollectionId),
  );

  /** Collection ids in the active subtree (the focused manual collection and
   *  every descendant) — see collectionSubtree. */
  const activeSubtree = $derived(collectionSubtree(activeCollectionId, activeIsSmart, collections));

  /** Source ids the active collection contributes. For manual: union of every
   *  member array in the subtree. For smart: the live smartMembers set. For a
   *  queue view: the live queueMembers set. */
  const activeMembers = $derived.by(() => {
    if (activeQueueView) return queueMembers;
    if (!activeCollectionId) return null;
    if (activeIsSmart) return smartMembers;
    if (!activeSubtree) return null;
    return membersInSubtree(activeSubtree, collections);
  });

  let visible = $derived(filterSources(sources, activeMembers, filter));

  async function selectCollection(id: string | null) {
    activeCollectionId = id;
    activeQueueView = null;
    queueMembers = null;
    if (id && smartCollections.some((s) => s.id === id)) {
      smartMembers = new Set((await api.collections.smartMembers(id)).map((s) => s.sourceId));
    } else {
      smartMembers = null;
    }
  }

  async function selectQueueView(view: QueueView) {
    if (activeQueueView === view) {
      // Click-to-toggle: deselecting returns to "All sources".
      activeQueueView = null;
      queueMembers = null;
      return;
    }
    activeQueueView = view;
    activeCollectionId = null;
    smartMembers = null;
    queueMembers = new Set((await api.sources.queueMembers(view)).map((s) => s.sourceId));
  }

  async function handleMarkStatus(source: SourceMetadata, status: ReadStatus | null): Promise<void> {
    contextMenu = null;
    try {
      await sourceData.setReadStatus(source.sourceId, status);
      // Host listener refreshes the panel; nothing more to do.
    } catch (err) {
      logger('sources').error('Mark status failed:', err);
    }
  }

  /** Set/clear the reading-queue due date. Closes the due-date modal
   *  on completion; the host's broadcast listener refreshes the panel
   *  so the row stamp updates without us needing to patch in place. */
  async function handleSetDueBy(source: SourceMetadata, dueBy: string | null): Promise<void> {
    const value = dueBy && dueBy.trim() ? dueBy.trim() : null;
    try {
      await sourceData.setReadDueBy(source.sourceId, value);
      // Patch the in-memory record so the byline stamp updates even
      // if the host's refresh listener hasn't fired yet.
      source.readDueBy = value;
      dueDateModal = null;
    } catch (err) {
      logger('sources').error('Set due date failed:', err);
    }
  }

  /** Small modal that pops out of the context menu's "Set due date"
   *  item. Owns its own dismissal (Escape, overlay click, Save/Clear)
   *  so the native date-picker overlay doesn't trip the context menu's
   *  window-level click dismisser. */
  let dueDateModal = $state<{ source: SourceMetadata; draft: string } | null>(null);
  function openDueDateModal(source: SourceMetadata): void {
    contextMenu = null;
    dueDateModal = { source, draft: source.readDueBy ?? '' };
  }
  function handleDueDateModalKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') dueDateModal = null;
    if (e.key === 'Enter' && dueDateModal) void handleSetDueBy(dueDateModal.source, dueDateModal.draft);
  }

  async function handleCopyDoi(source: SourceMetadata, kind: 'bare' | 'url'): Promise<void> {
    contextMenu = null;
    if (!source.doi) return;
    const text = kind === 'url' ? `https://doi.org/${source.doi}` : source.doi;
    try { await navigator.clipboard.writeText(text); }
    catch (err) { logger('sources').error('Copy DOI failed:', err); }
  }

  async function handleStripUpstreamTags(source: SourceMetadata): Promise<void> {
    contextMenu = null;
    try {
      await sourceData.stripUpstreamTags(source.sourceId);
    } catch (err) {
      logger('sources').error('Strip upstream tags failed:', err);
    }
  }

  async function handleMineReferences(source: SourceMetadata): Promise<void> {
    contextMenu = null;
    if (!onMineReferences) return;
    await onMineReferences(source);
  }

  let adding = $state(false);
  async function handleAddSource(): Promise<void> {
    if (adding) return;
    const raw = await onShowPrompt('URL, DOI, arXiv id, or PubMed id:');
    if (!raw) return;
    const input = raw.trim();
    if (!input) return;
    adding = true;
    try {
      const result = await sourceData.ingestSmart(input);
      await refresh();
      onSourceOpened?.(result.sourceId);
      if (result.duplicate) {
        void onShowConfirm(
          `Already ingested: "${result.title || result.sourceId}". Opened the existing source.`,
          'ingest-duplicate',
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void onShowConfirm(`Ingest failed: ${msg}`, 'ingest-failed', 'OK');
    } finally {
      adding = false;
    }
  }

  function handleAddToCollection(source: SourceMetadata) {
    contextMenu = null;
    addToCollectionFor = source;
  }

  async function handleAddToCollectionPick(collectionId: string) {
    const src = addToCollectionFor;
    addToCollectionFor = null;
    if (!src) return;
    try {
      await sourceData.addSourceToCollection(collectionId, src.sourceId);
    } catch (err) {
      logger('sources').error('Add to collection failed:', err);
    }
  }

  /** Used by the Add-to-collection picker's inline "Create new
   *  collection: <typed name>" affordance. Creates the collection,
   *  refreshes the local cache so the picker can resolve labels for
   *  it, and returns the new id so the picker can complete its
   *  selection flow. (#470) */
  async function handleCreateFromPicker(name: string): Promise<string> {
    const created = await sourceData.createCollection({ name, parent: null });
    // The COLLECTIONS_CHANGED broadcast will fire too, but kicking
    // off a refresh here avoids the millisecond gap where the
    // picker might list the new collection without resolving its
    // breadcrumb label (since labels are derived from the local
    // `collections` snapshot).
    await refreshCollections();
    return created.id;
  }

  async function handleRemoveFromActiveCollection(source: SourceMetadata) {
    contextMenu = null;
    if (!activeCollectionId) return;
    try {
      await sourceData.removeSourceFromCollection(activeCollectionId, source.sourceId);
    } catch (err) {
      logger('sources').error('Remove from collection failed:', err);
    }
  }

</script>

<div class="sources-panel">
  {#if sources.length === 0 && collections.length === 0}
    <div class="empty">No sources yet. File → Ingest URL… to start.</div>
  {:else}
    <CollectionsTree
      {collections}
      {smartCollections}
      {activeCollectionId}
      allSourcesActive={activeCollectionId === null && activeQueueView === null}
      allSourcesCount={sources.length}
      onSelect={selectCollection}
      {onShowPrompt}
      {onShowConfirm}
    />

    <ReadingQueueSection bind:this={queueSectionRef} activeView={activeQueueView} onSelect={selectQueueView} />

    <div class="filter-row">
      <input
        type="text"
        class="filter-input"
        placeholder={activeQueueView
          ? `Filter "${QUEUE_VIEWS.find((v) => v.id === activeQueueView)?.label ?? 'queue'}"…`
          : activeCollectionId
            ? `Filter "${
                collections.find((c) => c.id === activeCollectionId)?.name
                ?? smartCollections.find((s) => s.id === activeCollectionId)?.name
                ?? 'collection'
              }"…`
            : 'Filter sources…'}
        bind:value={filter}
      />
      <button
        type="button"
        class="add-source-btn"
        disabled={adding}
        onclick={handleAddSource}
        title="Add source from URL, DOI, arXiv id, or PubMed id"
        aria-label="Add source"
      >
        <Icon name="plus" size={11} color="var(--text-muted)" />
      </button>
    </div>
    <div class="source-list">
      {#each visible as s (s.sourceId)}
        <SourceListItem source={s} onSelect={onSourceSelect} onContextMenu={handleContextMenu} />
      {/each}
      {#if visible.length === 0}
        <div class="empty">
          {#if activeQueueView}
            Nothing in this queue view.
          {:else if activeCollectionId}
            This collection is empty.
          {:else}
            No matches.
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if contextMenu}
    <div
      class="context-menu"
      bind:this={contextMenuEl}
      style:left="{contextMenu.x}px"
      style:top="{contextMenu.y}px"
    >
      <button onclick={() => handleRenameSource(contextMenu!.source)}>Rename…</button>
      <button onclick={() => handleAddTag(contextMenu!.source)}>Add tag…</button>
      <div class="context-divider"></div>
      <button onclick={() => handleAddToCollection(contextMenu!.source)}>Add to collection…</button>
      {#if activeCollectionId && !activeIsSmart}
        <button onclick={() => handleRemoveFromActiveCollection(contextMenu!.source)}>Remove from collection</button>
      {/if}
      <div class="context-divider"></div>
      <div class="submenu-item" role="menuitem" tabindex="-1" onmouseenter={adjustSubmenu}>
        <span class="submenu-trigger">
          Mark as…
          <Icon name="chevronRight" size={10} />
        </span>
        <div class="submenu">
          {#each STATUS_OPTIONS as opt (opt.value)}
            <button
              class:current={contextMenu.source.readStatus === opt.value}
              onclick={() => handleMarkStatus(contextMenu!.source, opt.value)}
            >{opt.label}</button>
          {/each}
          {#if contextMenu.source.readStatus}
            <button onclick={() => handleMarkStatus(contextMenu!.source, null)}>Clear status</button>
          {/if}
        </div>
      </div>
      <!-- The context menu's window-click dismissal closes any
           inline date input the moment the native picker pops up
           (the picker overlay sits outside the menu DOM). Surfacing
           the picker via a small modal sidesteps that — the modal
           captures its own focus and dismisses on Escape / overlay
           click only. -->
      <button onclick={() => openDueDateModal(contextMenu!.source)}>
        Set due date{contextMenu.source.readDueBy ? ` (${formatDueStamp(contextMenu.source.readDueBy)})` : '…'}
      </button>
      {#if contextMenu.source.doi}
        <div class="context-divider"></div>
        <button onclick={() => handleCopyDoi(contextMenu!.source, 'bare')}>Copy DOI</button>
        <button onclick={() => handleCopyDoi(contextMenu!.source, 'url')}>Copy DOI URL</button>
      {/if}
      <div class="context-divider"></div>
      {#if onMineReferences}
        <button onclick={() => handleMineReferences(contextMenu!.source)}>Mine references…</button>
      {/if}
      <button onclick={() => handleStripUpstreamTags(contextMenu!.source)}>Strip upstream tags</button>
      <button onclick={() => handleMergeStart(contextMenu!.source)}>Merge into…</button>
      <button onclick={() => handleDelete(contextMenu!.source)}>Delete Source</button>
    </div>
  {/if}
</div>

{#if mergeSrc}
  <SourcePickerDialog
    {sources}
    title={`Merge "${mergeSrc.title ?? mergeSrc.sourceId}" into…`}
    placeholder="Pick the source to keep…"
    excludeSourceId={mergeSrc.sourceId}
    onSelect={handleMergePick}
    onCancel={() => { mergeSrc = null; }}
  />
{/if}

{#if addToCollectionFor}
  <CollectionPickerDialog
    {collections}
    title={`Add "${addToCollectionFor.title ?? addToCollectionFor.sourceId}" to collection…`}
    onSelect={handleAddToCollectionPick}
    onCancel={() => { addToCollectionFor = null; }}
    onCreate={handleCreateFromPicker}
  />
{/if}

{#if dueDateModal}
  {@const m = dueDateModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="due-overlay"
    onkeydown={handleDueDateModalKey}
    onmousedown={(e) => { if (e.target === e.currentTarget) dueDateModal = null; }}
  >
    <div class="due-dialog" role="dialog" aria-modal="true" aria-label="Reading due date">
      <header class="due-dialog-header">
        <div class="due-dialog-eyebrow">READING DUE DATE</div>
        <h2 class="due-dialog-title">{displaySourceTitle(m.source)}</h2>
      </header>
      <div class="due-dialog-body">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="date"
          class="due-dialog-input"
          bind:value={m.draft}
          autofocus
        />
      </div>
      <footer class="due-dialog-footer">
        <span class="due-dialog-kbd">esc · cancel · ↵ save</span>
        <span class="due-dialog-actions">
          {#if m.source.readDueBy}
            <button class="due-dialog-btn ghost" onclick={() => handleSetDueBy(m.source, null)}>Clear</button>
          {/if}
          <button class="due-dialog-btn ghost" onclick={() => { dueDateModal = null; }}>Cancel</button>
          <button class="due-dialog-btn primary" onclick={() => handleSetDueBy(m.source, m.draft)}>Save</button>
        </span>
      </footer>
    </div>
  </div>
{/if}

<style>
  /* Base shape shared via .context-menu in global.css (#1910); only the
     per-instance min-width stays local. */
  .context-menu {
    min-width: 160px;
  }
  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .context-menu button:hover { background: var(--bg-button); }
  .sources-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .empty {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .filter-row {
    padding: 8px 8px 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .add-source-btn {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .add-source-btn:hover:not(:disabled) {
    background: var(--bg-button);
    color: var(--text);
    border-color: var(--accent);
  }
  .add-source-btn:disabled { opacity: 0.5; cursor: default; }

  .filter-input {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 12px;
    box-sizing: border-box;
  }
  .filter-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .source-list {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 6px;
  }

  /* Editorial-row treatment (§5.5). Each source reads like a
     bibliography entry: italic display-serif title, sans+mono byline.
     The 2px accent rail still marks hover/active for parity with the
     file tree. */
  /* The row itself (border, title, byline, status dot, due stamp) now lives
     in SourceListItem.svelte. Only the list-level seam stays here: the first
     row drops its top border so it doesn't double up with the section edge.
     Targets the child component's root via :global. */
  .source-list :global(.source-item:first-child) {
    border-top: none;
  }

  /* Subtle separator inside the context menu. */
  .context-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
  /* The user's current status row reads as a quiet indicator
     ("you're already at this state") rather than an action. */
  .context-menu button.current {
    color: var(--accent);
    font-weight: 500;
  }

  /* Cascading submenu — matches Editor.svelte's right-click pattern.
     Mark as… nests its four status options + Clear status under one
     menu entry so the top level stays scannable. */
  .submenu-item {
    position: relative;
  }
  .submenu-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text);
    cursor: default;
  }
  .submenu-item:hover > .submenu-trigger {
    background: var(--bg-button);
  }
  .submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: -4px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 150px;
    z-index: calc(var(--z-popover) + 1);
  }
  .submenu-item:hover > .submenu {
    display: block;
  }
  /* Reading-due-date modal — popped out of the context-menu "Set due
     date" item. Owns its own dismissal (Escape / overlay click /
     Cancel / Save) so the native date picker can open without the
     context menu's window-level click dismisser tearing the dialog
     down. */
  .due-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .due-dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 380px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }
  .due-dialog-header { padding: 20px 24px 0; }
  .due-dialog-eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    margin-bottom: 6px;
  }
  .due-dialog-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 500;
    line-height: 1.3;
  }
  .due-dialog-body { padding: 14px 24px 18px; }
  .due-dialog-input {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: inherit;
    font-size: 13px;
  }
  .due-dialog-input:focus { outline: none; border-color: var(--accent); }
  .due-dialog-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .due-dialog-kbd {
    margin-right: auto;
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .due-dialog-actions { display: inline-flex; gap: 8px; }
  .due-dialog-btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
  }
  .due-dialog-btn.ghost {
    background: transparent;
    color: var(--text-muted);
  }
  .due-dialog-btn.ghost:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .due-dialog-btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .due-dialog-btn.primary:hover { opacity: 0.92; }
</style>
