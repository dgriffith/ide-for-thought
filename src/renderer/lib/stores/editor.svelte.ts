import { api } from '../ipc/client';
import type { TabSession, SavedTab, SavedGroup, LayoutSession } from '../../../shared/types';
import { normalizeSqlRows, unionColumns } from '../editor/sql-result';
import {
  type LayoutNode,
  type SplitDirection,
  leaf,
  splitLeaf,
  removeLeaf,
  collectGroupIds,
  isLayoutNode,
} from '../editor/layout-tree';

// ── Tab types ───────────────────────────────────────────────────────────────

export interface NoteTab {
  type: 'note';
  relativePath: string;
  fileName: string;
  content: string;
  savedContent: string;
  cursorOffset?: number;
  scrollTop?: number;
  /**
   * Serialised CodeMirror `EditorState` (doc + selection + history
   * stacks) captured on Editor unmount. Used to restore undo/redo across
   * tab switches — without this, switching tabs and back would give you
   * a fresh editor with empty history (#167). Memory-only; not persisted
   * to disk since session-restore is a separate concern.
   */
  historyJson?: unknown;
}

export type QueryLanguage = 'sparql' | 'sql';

export interface QueryTab {
  type: 'query';
  id: string;
  title: string;
  query: string;
  language: QueryLanguage;
  results: Record<string, string>[] | null;
  columns: string[];
  error: string | null;
  executing: boolean;
  executionTime: number | null;
}

export interface SourceTab {
  type: 'source';
  sourceId: string;
  /** If the user arrived via a [[quote::id]] click, highlight this excerpt in the detail view. */
  highlightExcerptId?: string;
}

export interface PdfTab {
  type: 'pdf';
  sourceId: string;
  /** 1-based current page; viewer updates this on navigation so
   *  reopening the tab restores the user's place. */
  page: number;
}

export type Tab = NoteTab | QueryTab | SourceTab | PdfTab;

/**
 * Source / preview view mode. `'editor-preview'` = source editor + rendered
 * preview side by side (#818). Lives per editor group (#811) — moved off the
 * App.svelte global so each split pane can carry its own mode.
 */
export type ViewMode = 'source' | 'preview' | 'editor-preview';

/**
 * One editor group — an independent pane owning its own tab strip, active tab,
 * and view mode (#811). Until pane-splitting lands (#813+) there is exactly one
 * group, so every "active group" delegate below reproduces the old singleton
 * behavior bit-for-bit.
 */
export interface EditorGroup {
  id: string;
  tabs: Tab[];
  activeIndex: number;
  viewMode: ViewMode;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isNote(tab: Tab): tab is NoteTab { return tab.type === 'note'; }
function isQuery(tab: Tab): tab is QueryTab { return tab.type === 'query'; }
function isSource(tab: Tab): tab is SourceTab { return tab.type === 'source'; }
function isPdf(tab: Tab): tab is PdfTab { return tab.type === 'pdf'; }

let queryCounter = 0;
let groupCounter = 0;

function newGroupId(): string {
  groupCounter++;
  return `group-${groupCounter}`;
}

// ── State ───────────────────────────────────────────────────────────────────

// The window starts with a single editor group; `activeGroupId` points at the
// focused one. Tab state that used to be module-global (`tabs` / `activeIndex`)
// and the view mode (formerly an App.svelte global) now live per group.
const groups = $state<EditorGroup[]>([
  { id: newGroupId(), tabs: [], activeIndex: -1, viewMode: 'source' },
]);
let activeGroupId = $state(groups[0].id);
// Recursive split layout (#813). A lone leaf = the single-pane case (today);
// `splitGroup` grows it into a tree, `collapseGroup` rebalances it back.
let layout = $state<LayoutNode>(leaf(groups[0].id));

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let tabPersistTimer: ReturnType<typeof setTimeout> | null = null;
let onAutoSaved: (() => void) | null = null;
const AUTO_SAVE_DELAY = 1000;
const TAB_PERSIST_DELAY = 500;

export function getEditorStore() {
  function activeGroup(): EditorGroup {
    return groups.find((g) => g.id === activeGroupId) ?? groups[0];
  }

  /** Resolve an explicit group target, falling back to the active group. Lets
   *  the store API target a specific pane while keeping every existing caller
   *  (which omits the id) operating on the focused group. */
  function resolveGroup(groupId?: string): EditorGroup {
    if (!groupId) return activeGroup();
    return groups.find((g) => g.id === groupId) ?? activeGroup();
  }

  /** Every tab across every group — for file-path operations (rename, delete,
   *  dirty checks) that are inherently window-global, not pane-scoped. */
  function allTabs(): Tab[] {
    return groups.flatMap((g) => g.tabs);
  }

  /** First tab matching `match` across every group, with its group + index.
   *  Backs the forbid-duplicate-open rule (#815): a file/source/pdf lives in
   *  at most one pane, so opening one already open anywhere just refocuses it. */
  function locateTab(match: (t: Tab) => boolean): { group: EditorGroup; index: number } | null {
    for (const group of groups) {
      const index = group.tabs.findIndex(match);
      if (index !== -1) return { group, index };
    }
    return null;
  }

  /** Focus the pane + tab `found` points at, and persist the focus change.
   *  The redirect target when a duplicate open is suppressed (#815). */
  function focusExistingTab(found: { group: EditorGroup; index: number }): void {
    activeGroupId = found.group.id;
    found.group.activeIndex = found.index;
    schedulePersistTabs();
  }

  function activeTab(): Tab | null {
    const g = activeGroup();
    return g.activeIndex >= 0 && g.activeIndex < g.tabs.length ? g.tabs[g.activeIndex] : null;
  }

  function activeNoteTab(): NoteTab | null {
    const tab = activeTab();
    return tab && isNote(tab) ? tab : null;
  }

  function activeQueryTab(): QueryTab | null {
    const tab = activeTab();
    return tab && isQuery(tab) ? tab : null;
  }

  function activeSourceTab(): SourceTab | null {
    const tab = activeTab();
    return tab && isSource(tab) ? tab : null;
  }

  // ── Group operations ──────────────────────────────────────────────────────

  /** Append a new (empty) editor group and return its id. Pane-creation UI
   *  lands in #813/#814; this is the store primitive they build on. */
  function addGroup(viewMode: ViewMode = 'source'): string {
    const id = newGroupId();
    groups.push({ id, tabs: [], activeIndex: -1, viewMode });
    return id;
  }

  function setActiveGroup(id: string): void {
    if (id !== activeGroupId && groups.some((g) => g.id === id)) {
      activeGroupId = id;
      schedulePersistTabs(); // focus is part of the persisted session (#816)
    }
  }

  /**
   * Move focus to the next/previous pane in visual (left-to-right) order,
   * wrapping around the ends (#814). `collectGroupIds(layout)` is the same
   * order the panes render in, so cycling matches what the user sees. No-op
   * with a single pane.
   */
  function cycleFocus(delta: 1 | -1): void {
    const ids = collectGroupIds(layout);
    if (ids.length <= 1) return;
    const cur = ids.indexOf(activeGroupId);
    const start = cur === -1 ? 0 : cur;
    activeGroupId = ids[(start + delta + ids.length) % ids.length];
    schedulePersistTabs();
  }
  const focusNextGroup = () => cycleFocus(1);
  const focusPreviousGroup = () => cycleFocus(-1);

  /**
   * Close the focused pane: drop all its tabs and collapse it, rebalancing the
   * tree (#814). On the lone pane this just empties it (collapse no-ops), so the
   * window always keeps one group — same contract as {@link closeAll}.
   */
  function closeActiveGroup(): void {
    closeAll(activeGroupId);
  }

  // ── Split layout (#813) ───────────────────────────────────────────────────

  /**
   * Split the pane holding `groupId` along `direction`, creating an empty new
   * group beside it and focusing it. The new pane starts empty — opening a file
   * (which targets the active group) populates it. `before` places the new pane
   * on the leading side (left / top) instead of the trailing side, used by
   * drag-tab-to-split (#817). Returns the new group id.
   */
  function splitGroup(groupId: string, direction: SplitDirection, opts?: { before?: boolean }): string {
    const source = groups.find((g) => g.id === groupId);
    // New pane inherits the splitting pane's view mode so the split feels
    // continuous; falls back to 'source'.
    const newId = addGroup(source?.viewMode ?? 'source');
    layout = splitLeaf(layout, groupId, direction, newId, opts?.before ?? false);
    activeGroupId = newId;
    schedulePersistTabs();
    return newId;
  }

  /**
   * Move a tab from one pane to another (or to a new index within a pane),
   * focusing the destination (#817 drag-and-drop). The moved tab becomes the
   * destination's active tab. If the source pane is left empty it collapses,
   * rebalancing the tree — same contract as closing its last tab. No-op if the
   * source tab doesn't exist or the move would be a no-op within one pane.
   */
  function moveTab(fromGroupId: string, fromIndex: number, toGroupId: string, toIndex?: number): void {
    const from = groups.find((g) => g.id === fromGroupId);
    const to = groups.find((g) => g.id === toGroupId);
    if (!from || !to) return;
    if (fromIndex < 0 || fromIndex >= from.tabs.length) return;

    const sameGroup = from.id === to.id;
    let insertAt = toIndex ?? to.tabs.length;
    if (sameGroup && toIndex !== undefined && toIndex > fromIndex) insertAt -= 1;
    if (sameGroup && insertAt === fromIndex) return; // dropped onto itself

    const [tab] = from.tabs.splice(fromIndex, 1);
    // Re-home the source's active index now that a tab left it.
    if (from.tabs.length === 0) {
      from.activeIndex = -1;
    } else if (fromIndex <= from.activeIndex) {
      from.activeIndex = Math.max(0, from.activeIndex - 1);
    }

    insertAt = Math.max(0, Math.min(insertAt, to.tabs.length));
    to.tabs.splice(insertAt, 0, tab);
    to.activeIndex = insertAt;
    activeGroupId = to.id;

    if (!sameGroup && from.tabs.length === 0) collapseGroup(from.id);
    schedulePersistTabs();
  }

  /**
   * Drag-tab-to-split (#817): split the target pane along `direction` and move
   * the dragged tab into the freshly created sub-pane (on the leading side when
   * `before`). Dragging a pane's only tab onto its own edge is a no-op net —
   * the source empties and collapses back, leaving the tab where it was.
   */
  function moveTabToSplit(
    fromGroupId: string,
    fromIndex: number,
    targetGroupId: string,
    direction: SplitDirection,
    before: boolean,
  ): void {
    const from = groups.find((g) => g.id === fromGroupId);
    if (!from || fromIndex < 0 || fromIndex >= from.tabs.length) return;
    const newId = splitGroup(targetGroupId, direction, { before });
    moveTab(fromGroupId, fromIndex, newId);
  }

  /**
   * Remove a group's pane from the layout and rebalance the tree (a split left
   * with one child collapses into it). No-op for the last remaining pane — the
   * window always keeps one. Drops the group from `groups` and reassigns focus
   * to the first surviving pane if the collapsed one was active.
   */
  function collapseGroup(groupId: string): void {
    if (groups.length <= 1) return;
    const next = removeLeaf(layout, groupId);
    if (next === null) return; // was the whole tree — keep it
    layout = next;
    const idx = groups.findIndex((g) => g.id === groupId);
    if (idx !== -1) groups.splice(idx, 1);
    if (activeGroupId === groupId) {
      activeGroupId = collectGroupIds(layout)[0] ?? groups[0]?.id;
    }
    schedulePersistTabs();
  }

  // ── Source operations ───────────────────────────────────────────────────

  function openSource(sourceId: string, opts?: { highlightExcerptId?: string; groupId?: string }) {
    // Forbid duplicate open (#815): if this source is already open in any pane,
    // refocus it (refreshing the excerpt highlight) instead of opening a copy.
    const found = locateTab((t) => isSource(t) && t.sourceId === sourceId);
    if (found) {
      (found.group.tabs[found.index] as SourceTab).highlightExcerptId = opts?.highlightExcerptId;
      focusExistingTab(found);
      return;
    }
    const grp = resolveGroup(opts?.groupId);
    activeGroupId = grp.id;
    const tab: SourceTab = {
      type: 'source',
      sourceId,
      highlightExcerptId: opts?.highlightExcerptId,
    };
    grp.tabs.push(tab);
    grp.activeIndex = grp.tabs.length - 1;
    schedulePersistTabs();
  }

  function openPdf(sourceId: string, opts?: { page?: number; groupId?: string }) {
    // Forbid duplicate open (#815): if this PDF is already open in any pane,
    // refocus it (jumping to the requested page) instead of opening a copy.
    const found = locateTab((t) => isPdf(t) && t.sourceId === sourceId);
    if (found) {
      if (opts?.page) (found.group.tabs[found.index] as PdfTab).page = opts.page;
      focusExistingTab(found);
      return;
    }
    const grp = resolveGroup(opts?.groupId);
    activeGroupId = grp.id;
    const tab: PdfTab = {
      type: 'pdf',
      sourceId,
      page: opts?.page ?? 1,
    };
    grp.tabs.push(tab);
    grp.activeIndex = grp.tabs.length - 1;
    schedulePersistTabs();
  }

  /** Update the persisted current page on the PDF tab for this source so the
   *  next reload restores where the user was. Searches all groups. */
  function setPdfPage(sourceId: string, page: number) {
    for (const grp of groups) {
      const idx = grp.tabs.findIndex((t) => isPdf(t) && t.sourceId === sourceId);
      if (idx === -1) continue;
      const tab = grp.tabs[idx] as PdfTab;
      if (tab.page === page) return;
      tab.page = page;
      schedulePersistTabs();
      return;
    }
  }

  // ── Note operations ─────────────────────────────────────────────────────

  async function openFile(relativePath: string, groupId?: string) {
    // Forbid duplicate open (#815): a note lives in at most one pane. If it's
    // already open anywhere, focus that pane + tab rather than spawning a second
    // live buffer (which would race to last-write-wins on save). This holds for
    // every caller — sidebar, wiki-link, search, split-open.
    const found = locateTab((t) => isNote(t) && t.relativePath === relativePath);
    if (found) {
      focusExistingTab(found);
      return;
    }

    const grp = resolveGroup(groupId);
    activeGroupId = grp.id;
    const text = await api.notebase.readFile(relativePath);
    const fileName = relativePath.split('/').pop() ?? '';
    const tab: NoteTab = {
      type: 'note',
      relativePath,
      fileName,
      content: text,
      savedContent: text,
    };
    grp.tabs.push(tab);
    grp.activeIndex = grp.tabs.length - 1;
    schedulePersistTabs();
  }

  async function save() {
    const tab = activeNoteTab();
    if (!tab) return;
    await api.notebase.writeFile(tab.relativePath, tab.content);
    tab.savedContent = tab.content;
  }

  // ── External change handlers (rename / content rewrite on disk) ─────────

  /** Return true if the tab for this path has unsaved local edits — checked
   *  across every group (a file lives in exactly one pane). */
  function isPathDirty(relativePath: string): boolean {
    const tab = allTabs().find((t) => isNote(t) && t.relativePath === relativePath) as NoteTab | undefined;
    return tab ? tab.content !== tab.savedContent : false;
  }

  /**
   * Apply file renames (from the main process) to tab paths in every group.
   * Content is unchanged, so no reload is needed — the tab's buffer is still
   * correct.
   */
  function applyRenameTransitions(transitions: Array<{ old: string; new: string }>): void {
    if (transitions.length === 0) return;
    const byOld = new Map(transitions.map((t) => [t.old, t.new]));
    let touched = false;
    for (const tab of allTabs()) {
      if (!isNote(tab)) continue;
      const newPath = byOld.get(tab.relativePath);
      if (newPath && newPath !== tab.relativePath) {
        tab.relativePath = newPath;
        tab.fileName = newPath.split('/').pop() ?? '';
        touched = true;
      }
    }
    if (touched) schedulePersistTabs();
  }

  /**
   * Reload a tab's content from disk. Caller is responsible for deciding
   * whether to call this when the tab is dirty (usually after a conflict
   * prompt). Does nothing if no tab is open at that path.
   */
  async function reloadTabFromDisk(relativePath: string): Promise<void> {
    const tab = allTabs().find((t) => isNote(t) && t.relativePath === relativePath) as NoteTab | undefined;
    if (!tab) return;
    try {
      const text = await api.notebase.readFile(relativePath);
      tab.content = text;
      tab.savedContent = text;
    } catch {
      // File may have been deleted between the rewrite notification and now.
    }
  }

  function setContent(text: string, groupId?: string) {
    const tab = groupId
      ? noteTabOf(resolveGroup(groupId))
      : activeNoteTab();
    if (tab) {
      tab.content = text;
      scheduleAutoSave();
    }
  }

  function noteTabOf(grp: EditorGroup): NoteTab | null {
    const tab = grp.activeIndex >= 0 && grp.activeIndex < grp.tabs.length ? grp.tabs[grp.activeIndex] : null;
    return tab && isNote(tab) ? tab : null;
  }

  /** Active note tab of a specific group — what an `Editor` bound to that group
   *  renders from (#812). Returns null if the group's active tab isn't a note
   *  (or the group doesn't exist). */
  function noteTabForGroup(groupId: string): NoteTab | null {
    const grp = groups.find((g) => g.id === groupId);
    return grp ? noteTabOf(grp) : null;
  }

  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      autoSaveTimer = null;
      await save();
      onAutoSaved?.();
    }, AUTO_SAVE_DELAY);
  }

  function flushAutoSave() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
      void save();
    }
  }

  function saveEditorState(
    relativePath: string,
    cursorOffset: number,
    scrollTop: number,
    historyJson?: unknown,
  ) {
    const tab = allTabs().find((t) => isNote(t) && t.relativePath === relativePath) as NoteTab | undefined;
    if (tab) {
      tab.cursorOffset = cursorOffset;
      tab.scrollTop = scrollTop;
      // Only record history when the caller provided it — absent arg means
      // "just updating cursor/scroll" (e.g. position-save on scroll).
      if (historyJson !== undefined) tab.historyJson = historyJson;
      schedulePersistTabs();
    }
  }

  // ── View mode (per group) ─────────────────────────────────────────────────

  function setViewMode(mode: ViewMode, groupId?: string) {
    resolveGroup(groupId).viewMode = mode;
  }

  function cycleViewMode(groupId?: string) {
    const grp = resolveGroup(groupId);
    if (grp.viewMode === 'source') grp.viewMode = 'preview';
    else if (grp.viewMode === 'preview') grp.viewMode = 'editor-preview';
    else grp.viewMode = 'source';
  }

  // ── Tab session persistence ────────────────────────────────────────────

  function schedulePersistTabs() {
    if (tabPersistTimer) clearTimeout(tabPersistTimer);
    tabPersistTimer = setTimeout(() => {
      tabPersistTimer = null;
      persistTabs();
    }, TAB_PERSIST_DELAY);
  }

  function toSavedTab(t: Tab): SavedTab {
    if (isNote(t)) {
      return { type: 'note', relativePath: t.relativePath, cursorOffset: t.cursorOffset, scrollTop: t.scrollTop };
    } else if (isQuery(t)) {
      return { type: 'query', title: t.title, query: t.query, language: t.language };
    } else if (isPdf(t)) {
      return { type: 'pdf', sourceId: t.sourceId, page: t.page };
    } else {
      return { type: 'source', sourceId: t.sourceId, highlightExcerptId: t.highlightExcerptId };
    }
  }

  function persistTabs() {
    // Persist the whole split arrangement (#816): every group's tabs +
    // active tab + view mode, the focused group, and the layout tree. The
    // layout is reactive ($state) — snapshot it to a plain object so the
    // structured-clone IPC boundary doesn't choke on the Svelte proxy.
    const session: LayoutSession = {
      version: 2,
      activeGroupId,
      groups: groups.map((g): SavedGroup => ({
        id: g.id,
        activeIndex: g.activeIndex,
        viewMode: g.viewMode,
        tabs: g.tabs.map(toSavedTab),
      })),
      layout: $state.snapshot(layout),
    };
    void api.tabs.save(session);
  }

  /** Reconstruct a live tab from its persisted form. Notes read their file
   *  back (returning null if it was deleted since last session, so the tab is
   *  dropped); the other kinds rehydrate from saved fields. */
  async function reconstructTab(saved: SavedTab): Promise<Tab | null> {
    if (saved.type === 'note') {
      try {
        const text = await api.notebase.readFile(saved.relativePath);
        const fileName = saved.relativePath.split('/').pop() ?? '';
        return {
          type: 'note',
          relativePath: saved.relativePath,
          fileName,
          content: text,
          savedContent: text,
          cursorOffset: saved.cursorOffset,
          scrollTop: saved.scrollTop,
        };
      } catch {
        return null; // file deleted since last session
      }
    } else if (saved.type === 'query') {
      queryCounter++;
      return {
        type: 'query',
        id: `query-${queryCounter}-${Date.now()}`,
        title: saved.title,
        query: saved.query,
        language: saved.language ?? 'sparql',
        results: null,
        columns: [],
        error: null,
        executing: false,
        executionTime: null,
      };
    } else if (saved.type === 'pdf') {
      return { type: 'pdf', sourceId: saved.sourceId, page: saved.page ?? 1 };
    } else {
      return { type: 'source', sourceId: saved.sourceId, highlightExcerptId: saved.highlightExcerptId };
    }
  }

  function asViewMode(v: unknown): ViewMode {
    return v === 'preview' || v === 'editor-preview' || v === 'source' ? v : 'source';
  }

  /** Cross-pane identity of a persisted tab, for the forbid-duplicate dedup on
   *  restore (#815). Queries have no shared-buffer identity (each is its own
   *  scratch buffer), so they return null and are never deduped. */
  function savedTabIdentity(t: SavedTab): string | null {
    if (t.type === 'note') return `note:${t.relativePath}`;
    if (t.type === 'source') return `source:${t.sourceId}`;
    if (t.type === 'pdf') return `pdf:${t.sourceId}`;
    return null;
  }

  /** Coerce whatever is on disk into the current multi-group shape. New
   *  sessions pass through; a legacy flat `TabSession` migrates to a single
   *  group (#816); anything else (null / empty / unrecognised) → null, so the
   *  caller keeps the start-of-session empty group. */
  function normalizeSession(raw: LayoutSession | TabSession | null): LayoutSession | null {
    if (!raw || typeof raw !== 'object') return null;
    if ('groups' in raw && Array.isArray(raw.groups)) {
      return raw.groups.length > 0 ? raw : null;
    }
    if ('tabs' in raw && Array.isArray(raw.tabs)) {
      if (raw.tabs.length === 0) return null;
      const id = newGroupId();
      return {
        version: 2,
        activeGroupId: id,
        groups: [{ id, activeIndex: raw.activeIndex ?? 0, viewMode: 'source', tabs: raw.tabs }],
        layout: { kind: 'leaf', groupId: id },
      };
    }
    return null;
  }

  async function restoreTabs() {
    const session = normalizeSession(await api.tabs.load());
    if (!session) return; // nothing saved or corrupt → keep the default empty group

    // Rebuild each group, dropping note tabs whose files have since vanished
    // and any duplicate of a tab already restored in an earlier pane — the
    // forbid-duplicate-open invariant (#815) must hold even if the on-disk
    // session was hand-edited or written by an older build.
    const seen = new Set<string>();
    const restored: EditorGroup[] = [];
    for (const sg of session.groups) {
      const tabs: Tab[] = [];
      for (const saved of sg.tabs) {
        const identity = savedTabIdentity(saved);
        if (identity && seen.has(identity)) continue;
        const tab = await reconstructTab(saved);
        if (tab) {
          tabs.push(tab);
          if (identity) seen.add(identity);
        }
      }
      const activeIndex =
        sg.activeIndex >= 0 && sg.activeIndex < tabs.length
          ? sg.activeIndex
          : tabs.length > 0 ? 0 : -1;
      restored.push({ id: sg.id, tabs, activeIndex, viewMode: asViewMode(sg.viewMode) });
    }
    if (restored.length === 0) return;

    // The saved layout must structurally match the restored groups exactly
    // (every leaf ↔ a live group, no orphans). If it doesn't, we can't trust
    // the tree — recover by merging every restored tab into one pane rather
    // than rendering a broken split or crashing.
    const ids = new Set(restored.map((g) => g.id));
    // SavedLayoutNode is structurally a LayoutNode; isLayoutNode still guards
    // against a corrupt on-disk tree that doesn't match the declared shape.
    const savedLayout = session.layout;
    const layoutOk =
      isLayoutNode(savedLayout) &&
      (() => {
        const leaves = collectGroupIds(savedLayout);
        return leaves.length === ids.size && leaves.every((id) => ids.has(id));
      })();

    groups.length = 0;
    if (layoutOk) {
      groups.push(...restored);
      layout = savedLayout;
      activeGroupId = ids.has(session.activeGroupId) ? session.activeGroupId : restored[0].id;
    } else {
      const merged: EditorGroup = {
        id: restored[0].id,
        tabs: restored.flatMap((g) => g.tabs),
        activeIndex: -1,
        viewMode: restored[0].viewMode,
      };
      merged.activeIndex = merged.tabs.length > 0 ? 0 : -1;
      groups.push(merged);
      layout = leaf(merged.id);
      activeGroupId = merged.id;
    }

    // `groupCounter` reset to 0 at launch; restored ids came from disk. Advance
    // it past the highest restored `group-N` so a later split can't re-mint an
    // id that's already live.
    for (const g of groups) {
      const n = Number(g.id.match(/^group-(\d+)$/)?.[1]);
      if (Number.isFinite(n) && n > groupCounter) groupCounter = n;
    }
  }

  // ── Query operations ────────────────────────────────────────────────────

  function openQuery(initialQuery = '', language: QueryLanguage = 'sparql', groupId?: string) {
    const grp = resolveGroup(groupId);
    activeGroupId = grp.id;
    queryCounter++;
    const tab: QueryTab = {
      type: 'query',
      id: `query-${queryCounter}-${Date.now()}`,
      title: language === 'sql' ? `SQL Query ${queryCounter}` : `Query ${queryCounter}`,
      query: initialQuery,
      language,
      results: null,
      columns: [],
      error: null,
      executing: false,
      executionTime: null,
    };
    grp.tabs.push(tab);
    grp.activeIndex = grp.tabs.length - 1;
    schedulePersistTabs();
  }

  function setQueryLanguage(language: QueryLanguage) {
    const tab = activeQueryTab();
    if (!tab || tab.language === language) return;
    tab.language = language;
    // Auto-rename only when the title hasn't been customized — the default
    // "Query N" / "SQL Query N" keeps the language visible in the tab strip.
    if (/^(SQL )?Query \d+$/.test(tab.title)) {
      const n = tab.title.match(/\d+/)?.[0] ?? String(queryCounter);
      tab.title = language === 'sql' ? `SQL Query ${n}` : `Query ${n}`;
    }
    // Clear stale results from the prior language so the user doesn't read
    // SPARQL rows while looking at a SQL query (or vice versa).
    tab.results = null;
    tab.columns = [];
    tab.error = null;
    tab.executionTime = null;
    schedulePersistTabs();
  }

  function setQueryText(text: string) {
    const tab = activeQueryTab();
    if (tab) tab.query = text;
  }

  async function executeQuery() {
    const tab = activeQueryTab();
    if (!tab || tab.executing) return;

    tab.executing = true;
    tab.error = null;
    tab.results = null;
    tab.columns = [];
    tab.executionTime = null;

    const start = performance.now();
    try {
      if (tab.language === 'sql') {
        const response = await api.tables.query(tab.query);
        tab.executionTime = Math.round(performance.now() - start);
        if (!response.ok) {
          tab.error = response.error;
        } else {
          tab.columns = response.columns;
          tab.results = normalizeSqlRows(response.columns, response.rows);
        }
      } else {
        const response = await api.graph.query(tab.query);
        tab.executionTime = Math.round(performance.now() - start);
        if (response.error) {
          tab.error = response.error;
        } else {
          const rows = response.results as Record<string, string>[];
          // Prefer the SELECT projection (from the engine metadata) — it keeps a
          // variable that's unbound in every row as an empty column. Fall back
          // to the union of keys across all rows when the projection is absent
          // (e.g. an older main process that predates the columns field), so the
          // panel never renders header-less / cell-less.
          tab.columns = response.columns?.length
            ? response.columns
            : unionColumns(rows);
          tab.results = rows;
        }
      }
    } catch (e) {
      tab.executionTime = Math.round(performance.now() - start);
      tab.error = String(e);
    } finally {
      tab.executing = false;
    }
  }

  // ── Generic tab operations ──────────────────────────────────────────────

  function closeTab(index: number, groupId?: string) {
    const grp = resolveGroup(groupId);
    if (index < 0 || index >= grp.tabs.length) return;
    if (index === grp.activeIndex && grp.id === activeGroupId) flushAutoSave();
    grp.tabs.splice(index, 1);
    if (grp.tabs.length === 0) {
      grp.activeIndex = -1;
      // Closing a split pane's last tab collapses the pane and rebalances the
      // tree (#813). The final pane is kept (collapseGroup no-ops there) so a
      // lone editor empties to its "no file" state exactly as today.
      collapseGroup(grp.id);
    } else if (index <= grp.activeIndex) {
      grp.activeIndex = Math.max(0, grp.activeIndex - 1);
    }
    schedulePersistTabs();
  }

  function closeOthers(index: number, groupId?: string) {
    const grp = resolveGroup(groupId);
    const kept = grp.tabs[index];
    if (!kept) return; // out-of-range — nothing to keep, leave the pane as-is
    grp.tabs.length = 0;
    grp.tabs.push(kept);
    grp.activeIndex = 0;
    schedulePersistTabs();
  }

  function closeAll(groupId?: string) {
    const grp = resolveGroup(groupId);
    flushAutoSave();
    grp.tabs.length = 0;
    grp.activeIndex = -1;
    // Emptying a split pane collapses it and rebalances the tree, same as
    // closing its last tab one-by-one (#813). No-ops on the last pane.
    collapseGroup(grp.id);
    schedulePersistTabs();
  }

  /**
   * Close every note tab whose file was deleted (or sat under a deleted
   * directory), across all groups. Drops dirty buffers without prompting — the
   * file is gone on disk; preserving a stale buffer would just create a ghost.
   *
   * Path matching covers the file itself AND any descendant of a deleted
   * directory (`relativePath === deleted` or starts with `deleted + '/'`).
   * Returns the count of tabs closed for caller diagnostics.
   */
  function closeTabsForDeletedPath(deleted: string): number {
    const isUnder = (p: string) => p === deleted || p.startsWith(deleted + '/');
    let closed = 0;
    for (const grp of groups) {
      // Walk in reverse so each splice doesn't disturb pending indexes.
      for (let i = grp.tabs.length - 1; i >= 0; i--) {
        const t = grp.tabs[i];
        if (isNote(t) && isUnder(t.relativePath)) {
          grp.tabs.splice(i, 1);
          if (i === grp.activeIndex) {
            grp.activeIndex = -1;
          } else if (i < grp.activeIndex) {
            grp.activeIndex--;
          }
          closed++;
        }
      }
      if (grp.activeIndex < 0 && grp.tabs.length > 0) {
        grp.activeIndex = Math.min(grp.tabs.length - 1, Math.max(0, grp.activeIndex));
      }
    }
    if (closed > 0) schedulePersistTabs();
    return closed;
  }

  /** Close every tab bound to a source — both its detail view and its PDF
   *  viewer, across all groups — e.g. when the source is deleted, so neither is
   *  left pointing at files that no longer exist. */
  function closeTabsForSource(sourceId: string): number {
    let closed = 0;
    for (const grp of groups) {
      for (let i = grp.tabs.length - 1; i >= 0; i--) {
        const t = grp.tabs[i];
        if ((isSource(t) || isPdf(t)) && t.sourceId === sourceId) {
          grp.tabs.splice(i, 1);
          if (i === grp.activeIndex) {
            grp.activeIndex = -1;
          } else if (i < grp.activeIndex) {
            grp.activeIndex--;
          }
          closed++;
        }
      }
      if (grp.activeIndex < 0 && grp.tabs.length > 0) {
        grp.activeIndex = Math.min(grp.tabs.length - 1, Math.max(0, grp.activeIndex));
      }
    }
    if (closed > 0) schedulePersistTabs();
    return closed;
  }

  function switchTab(index: number, groupId?: string) {
    const grp = resolveGroup(groupId);
    if (index >= 0 && index < grp.tabs.length) {
      flushAutoSave();
      activeGroupId = grp.id;
      grp.activeIndex = index;
      schedulePersistTabs();
    }
  }

  function clear() {
    flushAutoSave();
    // Collapse back to a single empty group + single-leaf layout — the
    // start-of-session shape.
    groups.length = 0;
    groups.push({ id: newGroupId(), tabs: [], activeIndex: -1, viewMode: 'source' });
    activeGroupId = groups[0].id;
    layout = leaf(groups[0].id);
  }

  return {
    get tabs() { return activeGroup().tabs; },
    get activeIndex() { return activeGroup().activeIndex; },
    get activeTab() { return activeTab(); },
    get activeNoteTab() { return activeNoteTab(); },
    get activeQueryTab() { return activeQueryTab(); },
    get activeSourceTab() { return activeSourceTab(); },
    get activeFilePath() { return activeNoteTab()?.relativePath ?? null; },
    get activeFileName() { return activeNoteTab()?.fileName ?? ''; },
    get content() { return activeNoteTab()?.content ?? ''; },
    get viewMode() { return activeGroup().viewMode; },
    get isDirty() {
      const tab = activeNoteTab();
      return tab ? tab.content !== tab.savedContent : false;
    },
    get hasAnyDirty() { return allTabs().some((t) => isNote(t) && t.content !== t.savedContent); },
    // Editor-group surface (#811). Read-only views; pane creation/focus UI
    // arrives in #813/#814.
    get groups() { return groups; },
    get activeGroupId() { return activeGroupId; },
    get activeGroup() { return activeGroup(); },
    get layout() { return layout; },
    noteTabForGroup,
    addGroup,
    setActiveGroup,
    focusNextGroup,
    focusPreviousGroup,
    closeActiveGroup,
    splitGroup,
    collapseGroup,
    moveTab,
    moveTabToSplit,
    openFile,
    openSource,
    openPdf,
    setPdfPage,
    save,
    isPathDirty,
    closeTabsForDeletedPath,
    closeTabsForSource,
    applyRenameTransitions,
    reloadTabFromDisk,
    setContent,
    flushAutoSave,
    set onAutoSaved(cb: (() => void) | null) { onAutoSaved = cb; },
    closeTab,
    closeOthers,
    closeAll,
    switchTab,
    clear,
    saveEditorState,
    setViewMode,
    cycleViewMode,
    openQuery,
    setQueryText,
    setQueryLanguage,
    executeQuery,
    restoreTabs,
    persistTabs,
    schedulePersistTabs,
  };
}
