<script lang="ts">
  import { api } from '../ipc/client';
  import type { SourceMetadata, Collection } from '../../../shared/types';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import SourcePickerDialog from './SourcePickerDialog.svelte';
  import CollectionPickerDialog from './CollectionPickerDialog.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    onSourceSelect: (sourceId: string) => void;
    onSourceDeleted?: (sourceId: string) => void;
    onShowConfirm: (message: string, key: string, label?: string) => Promise<boolean>;
    onShowPrompt: (message: string, initial?: string) => Promise<string | null>;
  }

  let { onSourceSelect, onSourceDeleted, onShowConfirm, onShowPrompt }: Props = $props();

  let sources = $state<SourceMetadata[]>([]);
  let filter = $state('');
  let contextMenu = $state<{ x: number; y: number; source: SourceMetadata } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();
  let collectionMenu = $state<{ x: number; y: number; collection: Collection } | null>(null);
  let collectionMenuEl = $state<HTMLDivElement | undefined>();
  /** When set, the merge picker is open with this source as the src. */
  let mergeSrc = $state<SourceMetadata | null>(null);
  /** When set, the collection picker is open to add this source to one. */
  let addToCollectionFor = $state<SourceMetadata | null>(null);

  let collections = $state<Collection[]>([]);
  /** Currently focused collection id; null = "All sources". */
  let activeCollectionId = $state<string | null>(null);
  /** Persisted expansion state of the collection tree (per project would
   *  be nicer, but matches the convention already used by the right
   *  sidebar's tag tree). */
  const COLL_EXPAND_KEY = 'minerva.collections.expanded';
  let expandedCollections = $state<Record<string, boolean>>(loadExpanded());

  function loadExpanded(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(COLL_EXPAND_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'boolean') out[k] = v;
        }
        return out;
      }
    } catch { /* ok */ }
    return {};
  }
  function persistExpanded(): void {
    try { localStorage.setItem(COLL_EXPAND_KEY, JSON.stringify(expandedCollections)); } catch { /* ok */ }
  }

  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });
  $effect(() => {
    if (!collectionMenu || !collectionMenuEl) return;
    const next = clampMenuToViewport(collectionMenu.x, collectionMenu.y, collectionMenuEl);
    if (next.x !== collectionMenu.x || next.y !== collectionMenu.y) {
      collectionMenu = { ...collectionMenu, ...next };
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
  api.collections.onChanged(() => { void refreshCollections(); });

  async function refreshCollections(): Promise<void> {
    const data = await api.collections.list();
    collections = data.collections;
  }

  function handleContextMenu(e: MouseEvent, source: SourceMetadata) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, source };
    const close = () => { contextMenu = null; window.removeEventListener('click', close); };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  async function handleDelete(source: SourceMetadata) {
    contextMenu = null;
    const label = source.title ?? source.sourceId;
    const confirmed = await onShowConfirm(
      `Delete source "${label}"? Any excerpts from this source will also be removed.`,
      'delete-source',
      'Delete',
    );
    if (!confirmed) return;
    await api.sources.delete(source.sourceId);
    onSourceDeleted?.(source.sourceId);
    await refresh();
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
      await api.sources.merge(src.sourceId, destId);
      onSourceDeleted?.(src.sourceId);
      await refresh();
    } catch (err) {
      console.error('[minerva] Merge sources failed:', err);
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
  }

  /** Collection ids in the active subtree (the focused collection and
   *  every descendant). Selecting a parent collection shows everything
   *  filed under it — matches what users expect from Zotero's "include
   *  child collections" default. */
  const activeSubtree = $derived.by(() => {
    if (!activeCollectionId) return null;
    const out = new Set<string>([activeCollectionId]);
    let added = true;
    while (added) {
      added = false;
      for (const c of collections) {
        if (c.parent && out.has(c.parent) && !out.has(c.id)) {
          out.add(c.id);
          added = true;
        }
      }
    }
    return out;
  });

  /** Source ids in the active subtree (union of all member arrays). */
  const activeMembers = $derived.by(() => {
    if (!activeSubtree) return null;
    const out = new Set<string>();
    for (const c of collections) {
      if (activeSubtree.has(c.id)) for (const m of c.members) out.add(m);
    }
    return out;
  });

  /** Per-collection visible counts shown next to each row. Each count
   *  reflects the subtree-rooted membership the user would see if they
   *  clicked that row (i.e. includes descendants). */
  const counts = $derived.by(() => {
    const childrenOf = new Map<string | null, string[]>();
    for (const c of collections) {
      const arr = childrenOf.get(c.parent) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parent, arr);
    }
    const subtreeMembers = new Map<string, Set<string>>();
    const collect = (id: string): Set<string> => {
      const cached = subtreeMembers.get(id);
      if (cached) return cached;
      const own = collections.find((c) => c.id === id);
      const out = new Set<string>(own?.members ?? []);
      for (const childId of childrenOf.get(id) ?? []) {
        for (const m of collect(childId)) out.add(m);
      }
      subtreeMembers.set(id, out);
      return out;
    };
    const result = new Map<string, number>();
    for (const c of collections) result.set(c.id, collect(c.id).size);
    return result;
  });

  let visible = $derived.by(() => {
    let base = sources;
    if (activeMembers) base = base.filter((s) => activeMembers.has(s.sourceId));
    const q = filter.trim().toLowerCase();
    if (!q) return base;
    return base.filter((s) => {
      const title = (s.title ?? s.sourceId).toLowerCase();
      const byline = s.creators.join(' ').toLowerCase();
      const year = s.year ?? '';
      return title.includes(q) || byline.includes(q) || year.includes(q) || s.sourceId.includes(q);
    });
  });

  interface CollectionRow {
    collection: Collection;
    depth: number;
    hasChildren: boolean;
  }
  /** Display-order flattening of the tree, honouring expansion state. */
  const collectionRows = $derived.by<CollectionRow[]>(() => {
    const childrenOf = new Map<string | null, Collection[]>();
    for (const c of collections) {
      const arr = childrenOf.get(c.parent) ?? [];
      arr.push(c);
      childrenOf.set(c.parent, arr);
    }
    for (const arr of childrenOf.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    const out: CollectionRow[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const c of childrenOf.get(parent) ?? []) {
        const hasChildren = (childrenOf.get(c.id)?.length ?? 0) > 0;
        out.push({ collection: c, depth, hasChildren });
        if (hasChildren && expandedCollections[c.id]) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  function toggleExpanded(id: string) {
    expandedCollections = { ...expandedCollections, [id]: !expandedCollections[id] };
    persistExpanded();
  }

  function selectCollection(id: string | null) {
    activeCollectionId = id;
  }

  function handleCollectionContextMenu(e: MouseEvent, collection: Collection) {
    e.preventDefault();
    e.stopPropagation();
    collectionMenu = { x: e.clientX, y: e.clientY, collection };
    const close = () => { collectionMenu = null; window.removeEventListener('click', close); };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  async function handleNewCollection(parent: string | null = null): Promise<void> {
    collectionMenu = null;
    const name = await onShowPrompt('New collection name:');
    if (!name) return;
    try {
      await api.collections.create({ name, parent });
    } catch (err) {
      console.error('[minerva] Create collection failed:', err);
    }
  }

  async function handleRenameCollection(c: Collection): Promise<void> {
    collectionMenu = null;
    const name = await onShowPrompt('Rename collection:', c.name);
    if (!name || name === c.name) return;
    try {
      await api.collections.rename(c.id, name);
    } catch (err) {
      console.error('[minerva] Rename collection failed:', err);
    }
  }

  async function handleDeleteCollection(c: Collection): Promise<void> {
    collectionMenu = null;
    const confirmed = await onShowConfirm(
      `Delete collection "${c.name}"? Its sources are kept; only the membership goes away. Any nested collections become top-level.`,
      'delete-collection',
      'Delete',
    );
    if (!confirmed) return;
    if (activeCollectionId === c.id) activeCollectionId = null;
    try {
      await api.collections.remove(c.id);
    } catch (err) {
      console.error('[minerva] Delete collection failed:', err);
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
      await api.collections.addSource(collectionId, src.sourceId);
    } catch (err) {
      console.error('[minerva] Add to collection failed:', err);
    }
  }

  /** Used by the Add-to-collection picker's inline "Create new
   *  collection: <typed name>" affordance. Creates the collection,
   *  refreshes the local cache so the picker can resolve labels for
   *  it, and returns the new id so the picker can complete its
   *  selection flow. (#470) */
  async function handleCreateFromPicker(name: string): Promise<string> {
    const created = await api.collections.create({ name, parent: null });
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
      await api.collections.removeSource(activeCollectionId, source.sourceId);
    } catch (err) {
      console.error('[minerva] Remove from collection failed:', err);
    }
  }

  function formatCreators(creators: string[]): string {
    if (creators.length === 0) return '';
    if (creators.length === 1) return creators[0];
    if (creators.length === 2) return `${creators[0]} and ${creators[1]}`;
    return `${creators[0]} et al.`;
  }
</script>

<div class="sources-panel">
  {#if sources.length === 0 && collections.length === 0}
    <div class="empty">No sources yet. File → Ingest URL… to start.</div>
  {:else}
    <div class="collections-section">
      <div class="collections-header">
        <span class="collections-eyebrow">COLLECTIONS</span>
        <button class="new-coll" onclick={() => handleNewCollection(null)} title="New collection">
          <Icon name="plus" size={11} color="var(--text-muted)" />
        </button>
      </div>
      <button
        class="coll-row"
        class:active={activeCollectionId === null}
        onclick={() => selectCollection(null)}
      >
        <span class="chevron-spacer"></span>
        <span class="coll-name">All sources</span>
        <span class="coll-count">{sources.length}</span>
      </button>
      {#each collectionRows as row (row.collection.id)}
        <button
          class="coll-row"
          class:active={activeCollectionId === row.collection.id}
          style:padding-left="{row.depth * 14 + 8}px"
          onclick={() => selectCollection(row.collection.id)}
          oncontextmenu={(e) => handleCollectionContextMenu(e, row.collection)}
          title={row.collection.id}
        >
          {#if row.hasChildren}
            <span
              class="chevron"
              role="button"
              tabindex="-1"
              onclick={(e) => { e.stopPropagation(); toggleExpanded(row.collection.id); }}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(row.collection.id); } }}
            >
              <Icon name={expandedCollections[row.collection.id] ? 'chevronDown' : 'chevronRight'} size={11} color="var(--text-faint)" />
            </span>
          {:else}
            <span class="chevron-spacer"></span>
          {/if}
          <span class="coll-name">{row.collection.name}</span>
          <span class="coll-count">{counts.get(row.collection.id) ?? 0}</span>
        </button>
      {/each}
    </div>

    <div class="filter-row">
      <input
        type="text"
        class="filter-input"
        placeholder={activeCollectionId
          ? `Filter "${collections.find((c) => c.id === activeCollectionId)?.name ?? 'collection'}"…`
          : 'Filter sources…'}
        bind:value={filter}
      />
    </div>
    <div class="source-list">
      {#each visible as s (s.sourceId)}
        <button
          class="source-item"
          onclick={() => onSourceSelect(s.sourceId)}
          oncontextmenu={(e) => handleContextMenu(e, s)}
          title={s.sourceId}
        >
          <div class="source-title">{s.title ?? s.sourceId}</div>
          {#if s.creators.length > 0 || s.year}
            {@const who = formatCreators(s.creators)}
            <div class="source-byline">
              {#if who}{who}{/if}{#if who && s.year} · {/if}{#if s.year}<span class="year">{s.year}</span>{/if}
            </div>
          {/if}
        </button>
      {/each}
      {#if visible.length === 0}
        <div class="empty">
          {activeCollectionId ? 'This collection is empty.' : 'No matches.'}
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
      <button onclick={() => handleAddToCollection(contextMenu!.source)}>Add to collection…</button>
      {#if activeCollectionId}
        <button onclick={() => handleRemoveFromActiveCollection(contextMenu!.source)}>Remove from collection</button>
      {/if}
      <button onclick={() => handleMergeStart(contextMenu!.source)}>Merge into…</button>
      <button onclick={() => handleDelete(contextMenu!.source)}>Delete Source</button>
    </div>
  {/if}
  {#if collectionMenu}
    <div
      class="context-menu"
      bind:this={collectionMenuEl}
      style:left="{collectionMenu.x}px"
      style:top="{collectionMenu.y}px"
    >
      <button onclick={() => handleNewCollection(collectionMenu!.collection.id)}>New nested collection…</button>
      <button onclick={() => handleRenameCollection(collectionMenu!.collection)}>Rename…</button>
      <button onclick={() => handleDeleteCollection(collectionMenu!.collection)}>Delete</button>
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

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
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
  }

  .filter-input {
    width: 100%;
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
  .source-item {
    display: flex;
    flex-direction: column;
    width: 100%;
    text-align: left;
    padding: 10px 16px;
    background: none;
    border: none;
    border-top: 1px solid var(--border);
    border-left: 2px solid transparent;
    color: var(--text);
    cursor: pointer;
  }
  .source-list .source-item:first-child {
    border-top: none;
  }
  .source-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }

  .source-title {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-byline {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 2px;
  }
  /* The year (and any other mono fragment in the byline) reads as a
     citation locator — switch to the mono face for tabular feel. */
  .source-byline :global(.year) {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* Collections section sits above the flat source list. Visual
     density is between the file tree (row-per-line) and the
     editorial source list — a short, scrollable region with a
     muted eyebrow heading. */
  .collections-section {
    flex-shrink: 0;
    max-height: 40%;
    overflow-y: auto;
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
  }
  .collections-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 4px 14px;
  }
  .collections-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.06em;
  }
  .new-coll {
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .new-coll:hover {
    background: var(--bg-button);
    color: var(--text);
  }
  .coll-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 4px 12px 4px 8px;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .coll-row:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
  }
  .coll-row.active {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    border-left-color: var(--accent);
    color: var(--accent);
  }
  .chevron, .chevron-spacer {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .chevron { cursor: pointer; }
  .coll-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .coll-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .coll-row.active .coll-count { color: var(--accent); }
</style>
