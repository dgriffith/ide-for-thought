<script lang="ts">
  import { api } from '../ipc/client';
  import type { SourceMetadata, Collection, SmartCollection, SmartCollectionPredicate, ReadStatus } from '../../../shared/types';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import SourcePickerDialog from './SourcePickerDialog.svelte';
  import CollectionPickerDialog from './CollectionPickerDialog.svelte';
  import SmartCollectionEditorDialog from './SmartCollectionEditorDialog.svelte';
  import Icon from './Icon.svelte';

  type QueueView = 'unread' | 'reading' | 'dueThisWeek' | 'recentlyFinished';
  const QUEUE_VIEWS: { id: QueueView; label: string }[] = [
    { id: 'unread', label: 'Unread' },
    { id: 'reading', label: 'Reading' },
    { id: 'dueThisWeek', label: 'Due this week' },
    { id: 'recentlyFinished', label: 'Recently finished' },
  ];
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
    onShowPrompt: (message: string, initial?: string) => Promise<string | null>;
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
  let collectionMenu = $state<{ x: number; y: number; collection: Collection } | null>(null);
  let collectionMenuEl = $state<HTMLDivElement | undefined>();
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
  /** Counts shown next to each queue row. Refreshed alongside the
   *  source/collection lists so the user gets fresh numbers without
   *  clicking. */
  let queueCounts = $state<Record<QueueView, number>>({
    unread: 0, reading: 0, dueThisWeek: 0, recentlyFinished: 0,
  });

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
  /** Smart-collection editor dialog state. `mode === 'edit'` carries
   *  the existing collection so the dialog seeds its inputs. */
  let smartEditor = $state<
    | { mode: 'create' }
    | { mode: 'edit'; collection: SmartCollection }
    | null
  >(null);
  /** + button popover menu state — used to disambiguate "new manual"
   *  vs "new smart". */
  let newCollectionMenu = $state<{ x: number; y: number } | null>(null);
  let newCollectionMenuEl = $state<HTMLDivElement | undefined>();
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

  /** Reading-queue section collapsed-state. Default is expanded; the
   *  section now sits below Collections and is the user's preference
   *  to fold out of the way once collections become the primary view. */
  const QUEUE_EXPANDED_KEY = 'minerva.sources.queueExpanded';
  let queueExpanded = $state<boolean>(loadQueueExpanded());
  function loadQueueExpanded(): boolean {
    try {
      const raw = localStorage.getItem(QUEUE_EXPANDED_KEY);
      return raw === null ? true : raw === 'true';
    } catch { return true; }
  }
  function toggleQueueExpanded(): void {
    queueExpanded = !queueExpanded;
    try { localStorage.setItem(QUEUE_EXPANDED_KEY, String(queueExpanded)); } catch { /* ok */ }
  }

  /** Reposition a submenu so it doesn't clip the viewport — same
   *  helper Editor.svelte uses for its right-click submenus. */
  function adjustSubmenu(event: MouseEvent) {
    const item = event.currentTarget as HTMLElement;
    const submenu = item.querySelector<HTMLElement>(':scope > .submenu');
    if (!submenu) return;
    submenu.style.top = '';
    submenu.style.bottom = '';
    submenu.style.left = '';
    submenu.style.right = '';
    requestAnimationFrame(() => {
      const rect = submenu.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const MARGIN = 8;
      if (rect.bottom > vh - MARGIN) { submenu.style.top = 'auto'; submenu.style.bottom = '-4px'; }
      if (rect.right  > vw - MARGIN) { submenu.style.left = 'auto'; submenu.style.right = '100%'; }
    });
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

  $effect(() => {
    if (!newCollectionMenu || !newCollectionMenuEl) return;
    const next = clampMenuToViewport(newCollectionMenu.x, newCollectionMenu.y, newCollectionMenuEl);
    if (next.x !== newCollectionMenu.x || next.y !== newCollectionMenu.y) {
      newCollectionMenu = { ...newCollectionMenu, ...next };
    }
  });

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
    void refreshQueueCounts();
    if (activeQueueView) {
      queueMembers = new Set((await api.sources.queueMembers(activeQueueView)).map((s) => s.sourceId));
    }
  }

  async function refreshQueueCounts(): Promise<void> {
    const entries = await Promise.all(
      QUEUE_VIEWS.map(async (v) => [v.id, (await api.sources.queueMembers(v.id)).length] as const),
    );
    const next: Record<QueueView, number> = { unread: 0, reading: 0, dueThisWeek: 0, recentlyFinished: 0 };
    for (const [id, count] of entries) next[id] = count;
    queueCounts = next;
  }

  // Sources change → host App.svelte's sources.onChanged listener
  // calls sidebar.refreshSources() which calls our refresh() above,
  // and that already kicks off refreshQueueCounts(). No additional
  // listener needed here.

  const activeIsSmart = $derived(
    !!activeCollectionId && smartCollections.some((s) => s.id === activeCollectionId),
  );

  /** Collection ids in the active subtree (the focused manual
   *  collection and every descendant). Selecting a parent shows
   *  everything filed under it — matches what users expect from
   *  Zotero's "include child collections" default. Returns null
   *  when nothing is focused, or when the focused entry is a smart
   *  collection (which has no subtree). */
  const activeSubtree = $derived.by(() => {
    if (!activeCollectionId || activeIsSmart) return null;
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

  /** Source ids the active collection contributes. For manual: union
   *  of every member array in the subtree. For smart: the live
   *  smartMembers set. For a queue view: the live queueMembers set. */
  const activeMembers = $derived.by(() => {
    if (activeQueueView) return queueMembers;
    if (!activeCollectionId) return null;
    if (activeIsSmart) return smartMembers;
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
      await api.sources.setReadStatus(source.sourceId, status);
      // Host listener refreshes the panel; nothing more to do.
    } catch (err) {
      console.error('[minerva] Mark status failed:', err);
    }
  }

  /** Set/clear the reading-queue due date. Closes the due-date modal
   *  on completion; the host's broadcast listener refreshes the panel
   *  so the row stamp updates without us needing to patch in place. */
  async function handleSetDueBy(source: SourceMetadata, dueBy: string | null): Promise<void> {
    const value = dueBy && dueBy.trim() ? dueBy.trim() : null;
    try {
      await api.sources.setReadDueBy(source.sourceId, value);
      // Patch the in-memory record so the byline stamp updates even
      // if the host's refresh listener hasn't fired yet.
      source.readDueBy = value;
      dueDateModal = null;
    } catch (err) {
      console.error('[minerva] Set due date failed:', err);
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
    catch (err) { console.error('[minerva] Copy DOI failed:', err); }
  }

  async function handleStripUpstreamTags(source: SourceMetadata): Promise<void> {
    contextMenu = null;
    try {
      await api.sources.stripUpstreamTags(source.sourceId);
    } catch (err) {
      console.error('[minerva] Strip upstream tags failed:', err);
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
      const result = await api.sources.ingestSmart(input);
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

  function handleCollectionContextMenu(e: MouseEvent, collection: Collection) {
    e.preventDefault();
    e.stopPropagation();
    collectionMenu = { x: e.clientX, y: e.clientY, collection };
    const close = () => { collectionMenu = null; window.removeEventListener('click', close); };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  let smartMenu = $state<{ x: number; y: number; smart: SmartCollection } | null>(null);
  let smartMenuEl = $state<HTMLDivElement | undefined>();
  $effect(() => {
    if (!smartMenu || !smartMenuEl) return;
    const next = clampMenuToViewport(smartMenu.x, smartMenu.y, smartMenuEl);
    if (next.x !== smartMenu.x || next.y !== smartMenu.y) {
      smartMenu = { ...smartMenu, ...next };
    }
  });

  function handleSmartContextMenu(e: MouseEvent, smart: SmartCollection) {
    e.preventDefault();
    e.stopPropagation();
    smartMenu = { x: e.clientX, y: e.clientY, smart };
    const close = () => { smartMenu = null; window.removeEventListener('click', close); };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  function openNewCollectionMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    newCollectionMenu = { x: rect.right, y: rect.bottom + 2 };
    const close = () => { newCollectionMenu = null; window.removeEventListener('click', close); };
    setTimeout(() => window.addEventListener('click', close), 0);
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
      await api.collections.renameSmart(smart.id, name);
    } catch (err) {
      console.error('[minerva] Rename smart collection failed:', err);
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
    if (activeCollectionId === smart.id) {
      activeCollectionId = null;
      smartMembers = null;
    }
    try {
      await api.collections.removeSmart(smart.id);
    } catch (err) {
      console.error('[minerva] Delete smart collection failed:', err);
    }
  }

  async function handleSmartEditorSave(name: string, predicate: SmartCollectionPredicate): Promise<void> {
    const editor = smartEditor;
    smartEditor = null;
    if (!editor) return;
    try {
      if (editor.mode === 'create') {
        const created = await api.collections.createSmart({ name, predicate });
        // Auto-focus the new collection so the user sees what they
        // just made (mirrors the create-from-picker UX).
        await selectCollection(created.id);
      } else {
        const c = editor.collection;
        if (name !== c.name) await api.collections.renameSmart(c.id, name);
        await api.collections.updateSmartPredicate(c.id, predicate);
        // Re-fetch members if this is the active one.
        if (activeCollectionId === c.id) {
          smartMembers = new Set((await api.collections.smartMembers(c.id)).map((s) => s.sourceId));
        }
      }
    } catch (err) {
      console.error('[minerva] Save smart collection failed:', err);
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

  /** Compact stamp for the source row's due-by indicator. Shows
   *  "Jun 15" within the current year, "Jun 15 2027" otherwise. The
   *  caller adds the leading "due " word so it can be re-styled
   *  independently. */
  function formatDueStamp(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const opts: Intl.DateTimeFormatOptions = sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  }

  /** True when the due-by date is strictly before today (local time).
   *  We highlight overdue items in the list so the user can spot them
   *  without opening detail. Per CLAUDE.md no-danger-styling: overdue
   *  uses --rust (a signal color, not red). */
  function isOverdue(iso: string | null): boolean {
    if (!iso) return false;
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d.getTime() < today.getTime();
  }

  /** Single character glyph for the status indicator dot. Picked for
   *  ASCII-safety; users learn the mapping from the title attribute. */
  function statusGlyph(status: SourceMetadata['readStatus']): string {
    switch (status) {
      case 'reading': return '◐';
      case 'read': return '●';
      case 'unread': return '○';
      case 'skipped': return '×';
      default: return '';
    }
  }
  function statusTitle(status: SourceMetadata['readStatus']): string {
    switch (status) {
      case 'reading': return 'Reading';
      case 'read': return 'Read';
      case 'unread': return 'Unread';
      case 'skipped': return 'Skipped';
      default: return '';
    }
  }
</script>

<div class="sources-panel">
  {#if sources.length === 0 && collections.length === 0}
    <div class="empty">No sources yet. File → Ingest URL… to start.</div>
  {:else}
    <div class="collections-section">
      <div class="collections-header">
        <span class="collections-eyebrow">COLLECTIONS</span>
        <button class="new-coll" onclick={openNewCollectionMenu} title="New collection…">
          <Icon name="plus" size={11} color="var(--text-muted)" />
        </button>
      </div>
      <button
        class="coll-row"
        class:active={activeCollectionId === null && activeQueueView === null}
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

      {#if smartCollections.length > 0}
        <div class="smart-divider">SMART</div>
        {#each smartCollections as s (s.id)}
          <button
            class="coll-row smart-row"
            class:active={activeCollectionId === s.id}
            onclick={() => selectCollection(s.id)}
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

    <div class="queue-section">
      <button
        class="queue-header"
        onclick={toggleQueueExpanded}
        aria-expanded={queueExpanded}
        title={queueExpanded ? 'Collapse reading queue' : 'Expand reading queue'}
      >
        <Icon name={queueExpanded ? 'chevronDown' : 'chevronRight'} size={11} color="var(--text-faint)" />
        <span class="section-eyebrow queue-eyebrow">READING QUEUE</span>
      </button>
      {#if queueExpanded}
        {#each QUEUE_VIEWS as v (v.id)}
          <button
            class="coll-row queue-row"
            class:active={activeQueueView === v.id}
            onclick={() => selectQueueView(v.id)}
            title={`Show ${v.label.toLowerCase()}`}
          >
            <span class="chevron-spacer"></span>
            <span class="coll-name">{v.label}</span>
            <span class="coll-count">{queueCounts[v.id]}</span>
          </button>
        {/each}
      {/if}
    </div>

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
        <button
          class="source-item"
          onclick={() => onSourceSelect(s.sourceId)}
          oncontextmenu={(e) => handleContextMenu(e, s)}
          title={s.sourceId}
        >
          <div class="source-title">
            {#if s.readStatus}
              <span
                class="status-dot status-{s.readStatus}"
                title={statusTitle(s.readStatus)}
                aria-label={statusTitle(s.readStatus)}
              >{statusGlyph(s.readStatus)}</span>
            {/if}
            {s.title ?? s.sourceId}
          </div>
          {#if s.creators.length > 0 || s.year || s.readDueBy}
            {@const who = formatCreators(s.creators)}
            <div class="source-byline">
              {#if who}{who}{/if}{#if who && s.year} · {/if}{#if s.year}<span class="year">{s.year}</span>{/if}
              {#if s.readDueBy}
                {#if who || s.year} · {/if}
                <span class="due-stamp" class:overdue={isOverdue(s.readDueBy)} title="Reading due {s.readDueBy}">
                  due {formatDueStamp(s.readDueBy)}
                </span>
              {/if}
            </div>
          {/if}
        </button>
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
      <button onclick={() => handleAddToCollection(contextMenu!.source)}>Add to collection…</button>
      {#if activeCollectionId && !activeIsSmart}
        <button onclick={() => handleRemoveFromActiveCollection(contextMenu!.source)}>Remove from collection</button>
      {/if}
      <div class="context-divider"></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
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

{#if smartEditor}
  <SmartCollectionEditorDialog
    editing={smartEditor.mode === 'edit' ? smartEditor.collection : undefined}
    onSave={handleSmartEditorSave}
    onCancel={() => { smartEditor = null; }}
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
        <h2 class="due-dialog-title">{m.source.title ?? m.source.sourceId}</h2>
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

  /* SMART subsection — kept visually subordinate so the manual tree
     stays the primary affordance. Small uppercase divider, no count
     badge (the row's hover tooltip carries the predicate). */
  .smart-divider {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    padding: 8px 14px 2px;
  }
  .smart-row { gap: 6px; }

  /* Reading-queue status dot in the source list (#116). Just a small
     inline mark in front of the title so the user can scan for "what's
     reading right now" without leaving the panel. */
  .status-dot {
    display: inline-block;
    width: 1em;
    text-align: center;
    margin-right: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    vertical-align: baseline;
  }
  .status-dot.status-reading { color: var(--accent); }
  .status-dot.status-read { color: color-mix(in oklch, var(--text-muted) 90%, transparent); }
  .status-dot.status-unread { color: var(--text-faint); }
  .status-dot.status-skipped { color: var(--text-faint); }

  /* Reading-queue section sits BELOW Collections now, with a
     collapsible header so users who never touch the queue can fold
     it away. Same row shape as the collection tree; no "+" button
     because the views are built-in. */
  .queue-section {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
  }
  .section-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.06em;
    padding: 10px 14px 4px;
  }
  .queue-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 10px 14px 4px 8px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .queue-header:hover .queue-eyebrow {
    color: var(--text-muted);
  }
  .queue-eyebrow {
    padding: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.06em;
  }
  .queue-row { /* re-uses .coll-row look */ }

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
    z-index: 1001;
  }
  .submenu-item:hover > .submenu {
    display: block;
  }
  .submenu-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  /* Reading-due-date modal — popped out of the context-menu "Set due
     date" item. Owns its own dismissal (Escape / overlay click /
     Cancel / Save) so the native date picker can open without the
     context menu's window-level click dismisser tearing the dialog
     down. */
  .due-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
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

  /* Compact "due Jun 15" stamp on the source row byline. Overdue
     items shift to --rust (signal color, not red — per CLAUDE.md). */
  .due-stamp {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
  }
  .due-stamp.overdue {
    color: var(--rust);
  }
</style>
