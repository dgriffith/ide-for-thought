<script lang="ts">
  import type { Collection, SmartCollection, SmartCollectionPredicate } from '../../../shared/types';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import { installDismissOnClickOutside } from '../dismiss-menu';
  import SmartCollectionEditorDialog from './SmartCollectionEditorDialog.svelte';
  import Icon from './Icon.svelte';
  import { getSourceDataStore } from '../stores/source-data.svelte';
  import { logger } from '../../../shared/logger';
  import { subtreeCounts, flattenCollectionRows } from '../sources/collection-tree';

  const sourceData = getSourceDataStore();

  interface Props {
    collections: Collection[];
    smartCollections: SmartCollection[];
    activeCollectionId: string | null;
    /** True when neither a collection nor a queue view is selected — i.e.
     *  the "All sources" row should render as active. */
    allSourcesActive: boolean;
    allSourcesCount: number;
    /** Select a manual/smart collection, or null for "All sources". Owned by
     *  the host since selecting here must also clear any active queue-view
     *  selection, which lives outside this component. Re-invoking with the
     *  currently-active id is also used internally as a "refresh this
     *  selection's derived state" signal (e.g. after a predicate edit). */
    onSelect: (id: string | null) => void;
    onShowPrompt: (message: string, initialOrOptions?: string | { suggestions?: string[]; initial?: string }) => Promise<string | null>;
    onShowConfirm: (message: string, key: string, label?: string) => Promise<boolean>;
  }

  let { collections, smartCollections, activeCollectionId, allSourcesActive, allSourcesCount, onSelect, onShowPrompt, onShowConfirm }: Props = $props();

  let collectionMenu = $state<{ x: number; y: number; collection: Collection } | null>(null);
  let collectionMenuEl = $state<HTMLDivElement | undefined>();
  let smartMenu = $state<{ x: number; y: number; smart: SmartCollection } | null>(null);
  let smartMenuEl = $state<HTMLDivElement | undefined>();
  /** + button popover menu state — used to disambiguate "new manual" vs
   *  "new smart". */
  let newCollectionMenu = $state<{ x: number; y: number } | null>(null);
  let newCollectionMenuEl = $state<HTMLDivElement | undefined>();
  /** Smart-collection editor dialog state. `mode === 'edit'` carries the
   *  existing collection so the dialog seeds its inputs. */
  let smartEditor = $state<
    | { mode: 'create' }
    | { mode: 'edit'; collection: SmartCollection }
    | null
  >(null);

  /** Persisted expansion state of the collection tree (per project would be
   *  nicer, but matches the convention already used by the right sidebar's
   *  tag tree). */
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
  function toggleExpanded(id: string) {
    expandedCollections = { ...expandedCollections, [id]: !expandedCollections[id] };
    persistExpanded();
  }

  /** Per-collection subtree-rooted counts shown next to each row. */
  const counts = $derived(subtreeCounts(collections));
  /** Display-order flattening of the tree, honouring expansion state. */
  const collectionRows = $derived(flattenCollectionRows(collections, expandedCollections));

  $effect(() => {
    if (!collectionMenu || !collectionMenuEl) return;
    const next = clampMenuToViewport(collectionMenu.x, collectionMenu.y, collectionMenuEl);
    if (next.x !== collectionMenu.x || next.y !== collectionMenu.y) {
      collectionMenu = { ...collectionMenu, ...next };
    }
  });
  $effect(() => {
    if (!smartMenu || !smartMenuEl) return;
    const next = clampMenuToViewport(smartMenu.x, smartMenu.y, smartMenuEl);
    if (next.x !== smartMenu.x || next.y !== smartMenu.y) {
      smartMenu = { ...smartMenu, ...next };
    }
  });
  $effect(() => {
    if (!newCollectionMenu || !newCollectionMenuEl) return;
    const next = clampMenuToViewport(newCollectionMenu.x, newCollectionMenu.y, newCollectionMenuEl);
    if (next.x !== newCollectionMenu.x || next.y !== newCollectionMenu.y) {
      newCollectionMenu = { ...newCollectionMenu, ...next };
    }
  });

  function handleCollectionContextMenu(e: MouseEvent, collection: Collection) {
    e.preventDefault();
    e.stopPropagation();
    collectionMenu = { x: e.clientX, y: e.clientY, collection };
    installDismissOnClickOutside(() => { collectionMenu = null; });
  }

  function handleSmartContextMenu(e: MouseEvent, smart: SmartCollection) {
    e.preventDefault();
    e.stopPropagation();
    smartMenu = { x: e.clientX, y: e.clientY, smart };
    installDismissOnClickOutside(() => { smartMenu = null; });
  }

  function openNewCollectionMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    newCollectionMenu = { x: rect.right, y: rect.bottom + 2 };
    installDismissOnClickOutside(() => { newCollectionMenu = null; });
  }

  function smartHoverHint(s: SmartCollection): string {
    if (s.predicate.kind === 'tags') {
      const tags = s.predicate.allOf.map((t) => `#${t}`).join(' AND ');
      return tags || s.id;
    }
    if (s.predicate.kind === 'readStatus') {
      return s.predicate.status.length > 0
        ? `Status: ${s.predicate.status.join(' or ')}`
        : s.id;
    }
    return s.id;
  }

  async function handleNewCollection(parent: string | null = null): Promise<void> {
    collectionMenu = null;
    const name = await onShowPrompt('New collection name:');
    if (!name) return;
    try {
      await sourceData.createCollection({ name, parent });
    } catch (err) {
      logger('sources').error('Create collection failed:', err);
    }
  }

  async function handleRenameCollection(c: Collection): Promise<void> {
    collectionMenu = null;
    const name = await onShowPrompt('Rename collection:', c.name);
    if (!name || name === c.name) return;
    try {
      await sourceData.renameCollection(c.id, name);
    } catch (err) {
      logger('sources').error('Rename collection failed:', err);
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
    if (activeCollectionId === c.id) onSelect(null);
    try {
      await sourceData.removeCollection(c.id);
    } catch (err) {
      logger('sources').error('Delete collection failed:', err);
    }
  }

  function handleNewSmartCollection(): void {
    newCollectionMenu = null;
    smartEditor = { mode: 'create' };
  }

  function handleEditSmart(smart: SmartCollection): void {
    smartMenu = null;
    smartEditor = { mode: 'edit', collection: smart };
  }

  async function handleRenameSmart(smart: SmartCollection): Promise<void> {
    smartMenu = null;
    const name = await onShowPrompt('Rename smart collection:', smart.name);
    if (!name || name === smart.name) return;
    try {
      await sourceData.renameSmartCollection(smart.id, name);
    } catch (err) {
      logger('sources').error('Rename smart collection failed:', err);
    }
  }

  async function handleDeleteSmart(smart: SmartCollection): Promise<void> {
    smartMenu = null;
    const confirmed = await onShowConfirm(
      `Delete smart collection "${smart.name}"? Its result set is derived, so no sources are removed.`,
      'delete-smart-collection',
      'Delete',
    );
    if (!confirmed) return;
    if (activeCollectionId === smart.id) onSelect(null);
    try {
      await sourceData.removeSmartCollection(smart.id);
    } catch (err) {
      logger('sources').error('Delete smart collection failed:', err);
    }
  }

  async function handleSmartEditorSave(name: string, predicate: SmartCollectionPredicate): Promise<void> {
    const editor = smartEditor;
    smartEditor = null;
    if (!editor) return;
    try {
      if (editor.mode === 'create') {
        const created = await sourceData.createSmartCollection({ name, predicate });
        // Auto-focus the new collection so the user sees what they just made
        // (mirrors the create-from-picker UX).
        onSelect(created.id);
      } else {
        const c = editor.collection;
        if (name !== c.name) await sourceData.renameSmartCollection(c.id, name);
        await sourceData.updateSmartPredicate(c.id, predicate);
        // Re-select the active one to force the host to re-fetch its
        // membership, in case the predicate changed.
        if (activeCollectionId === c.id) onSelect(c.id);
      }
    } catch (err) {
      logger('sources').error('Save smart collection failed:', err);
    }
  }
</script>

<div class="collections-section">
  <div class="collections-header">
    <span class="collections-eyebrow">COLLECTIONS</span>
    <button class="new-coll" onclick={openNewCollectionMenu} title="New collection…">
      <Icon name="plus" size={11} color="var(--text-muted)" />
    </button>
  </div>
  <button
    class="coll-row"
    class:active={allSourcesActive}
    onclick={() => onSelect(null)}
  >
    <span class="chevron-spacer"></span>
    <span class="coll-name">All sources</span>
    <span class="coll-count">{allSourcesCount}</span>
  </button>
  {#each collectionRows as row (row.collection.id)}
    <button
      class="coll-row"
      class:active={activeCollectionId === row.collection.id}
      style:padding-left="{row.depth * 14 + 8}px"
      onclick={() => onSelect(row.collection.id)}
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

  {#if smartCollections.length > 0}
    <div class="smart-divider">SMART</div>
    {#each smartCollections as s (s.id)}
      <button
        class="coll-row smart-row"
        class:active={activeCollectionId === s.id}
        onclick={() => onSelect(s.id)}
        oncontextmenu={(e) => handleSmartContextMenu(e, s)}
        title={smartHoverHint(s)}
      >
        <span class="chevron-spacer"></span>
        <Icon name="search" size={11} color={activeCollectionId === s.id ? 'var(--accent)' : 'var(--text-faint)'} />
        <span class="coll-name">{s.name}</span>
      </button>
    {/each}
  {/if}
</div>

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
{#if smartMenu}
  <div
    class="context-menu"
    bind:this={smartMenuEl}
    style:left="{smartMenu.x}px"
    style:top="{smartMenu.y}px"
  >
    <button onclick={() => handleEditSmart(smartMenu!.smart)}>Edit query…</button>
    <button onclick={() => handleRenameSmart(smartMenu!.smart)}>Rename…</button>
    <button onclick={() => handleDeleteSmart(smartMenu!.smart)}>Delete</button>
  </div>
{/if}
{#if newCollectionMenu}
  <div
    class="context-menu"
    bind:this={newCollectionMenuEl}
    style:left="{newCollectionMenu.x}px"
    style:top="{newCollectionMenu.y}px"
  >
    <button onclick={() => { newCollectionMenu = null; void handleNewCollection(null); }}>New collection…</button>
    <button onclick={handleNewSmartCollection}>New smart collection…</button>
  </div>
{/if}

{#if smartEditor}
  <SmartCollectionEditorDialog
    {...(smartEditor.mode === 'edit' ? { editing: smartEditor.collection } : {})}
    onSave={handleSmartEditorSave}
    onCancel={() => { smartEditor = null; }}
  />
{/if}

<style>
  /* Base shape shared via .context-menu in global.css (#1910); only the
     per-instance min-width stays local (duplicated in SourcesPanel.svelte
     too — Svelte scopes styles per-component, so a shared class name still
     needs its rule repeated in every file that renders one of these menus). */
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

  /* Collections section sits above the flat source list. Visual density is
     between the file tree (row-per-line) and the editorial source list — a
     short, scrollable region with a muted eyebrow heading. */
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

  /* SMART subsection — kept visually subordinate so the manual tree stays
     the primary affordance. Small uppercase divider, no count badge (the
     row's hover tooltip carries the predicate). */
  .smart-divider {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    padding: 8px 14px 2px;
  }
  .smart-row { gap: 6px; }
</style>
