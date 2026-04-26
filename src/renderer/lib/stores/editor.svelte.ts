import { api } from '../ipc/client';
import type { TabSession, SavedTab } from '../../../shared/types';
import { normalizeSqlRows } from '../editor/sql-result';

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

export type Tab = NoteTab | QueryTab | SourceTab;

// ── Helpers ─────────────────────────────────────────────────────────────────

function isNote(tab: Tab): tab is NoteTab { return tab.type === 'note'; }
function isQuery(tab: Tab): tab is QueryTab { return tab.type === 'query'; }
function isSource(tab: Tab): tab is SourceTab { return tab.type === 'source'; }

let queryCounter = 0;

// ── State ───────────────────────────────────────────────────────────────────

const tabs = $state<Tab[]>([]);
let activeIndex = $state(-1);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let tabPersistTimer: ReturnType<typeof setTimeout> | null = null;
let onAutoSaved: (() => void) | null = null;
const AUTO_SAVE_DELAY = 1000;
const TAB_PERSIST_DELAY = 500;

export function getEditorStore() {
  function activeTab(): Tab | null {
    return activeIndex >= 0 && activeIndex < tabs.length ? tabs[activeIndex] : null;
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

  // ── Source operations ───────────────────────────────────────────────────

  function openSource(sourceId: string, opts?: { highlightExcerptId?: string }) {
    const existing = tabs.findIndex((t) => isSource(t) && t.sourceId === sourceId);
    if (existing !== -1) {
      const existingTab = tabs[existing] as SourceTab;
      existingTab.highlightExcerptId = opts?.highlightExcerptId;
      activeIndex = existing;
      schedulePersistTabs();
      return;
    }
    const tab: SourceTab = {
      type: 'source',
      sourceId,
      highlightExcerptId: opts?.highlightExcerptId,
    };
    tabs.push(tab);
    activeIndex = tabs.length - 1;
    schedulePersistTabs();
  }

  // ── Note operations ─────────────────────────────────────────────────────

  async function openFile(relativePath: string) {
    const existing = tabs.findIndex((t) => isNote(t) && t.relativePath === relativePath);
    if (existing !== -1) {
      activeIndex = existing;
      return;
    }

    const text = await api.notebase.readFile(relativePath);
    const fileName = relativePath.split('/').pop() ?? '';
    const tab: NoteTab = {
      type: 'note',
      relativePath,
      fileName,
      content: text,
      savedContent: text,
    };
    tabs.push(tab);
    activeIndex = tabs.length - 1;
    schedulePersistTabs();
  }

  async function save() {
    const tab = activeNoteTab();
    if (!tab) return;
    await api.notebase.writeFile(tab.relativePath, tab.content);
    tab.savedContent = tab.content;
  }

  // ── External change handlers (rename / content rewrite on disk) ─────────

  /** Return true if the tab for this path has unsaved local edits. */
  function isPathDirty(relativePath: string): boolean {
    const tab = tabs.find((t) => isNote(t) && t.relativePath === relativePath) as NoteTab | undefined;
    return tab ? tab.content !== tab.savedContent : false;
  }

  /**
   * Apply file renames (from the main process) to tab paths. Content is
   * unchanged, so no reload is needed — the tab's buffer is still correct.
   */
  function applyRenameTransitions(transitions: Array<{ old: string; new: string }>): void {
    if (transitions.length === 0) return;
    const byOld = new Map(transitions.map((t) => [t.old, t.new]));
    let touched = false;
    for (const tab of tabs) {
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
    const tab = tabs.find((t) => isNote(t) && t.relativePath === relativePath) as NoteTab | undefined;
    if (!tab) return;
    try {
      const text = await api.notebase.readFile(relativePath);
      tab.content = text;
      tab.savedContent = text;
    } catch {
      // File may have been deleted between the rewrite notification and now.
    }
  }

  function setContent(text: string) {
    const tab = activeNoteTab();
    if (tab) {
      tab.content = text;
      scheduleAutoSave();
    }
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
    const tab = tabs.find((t) => isNote(t) && t.relativePath === relativePath) as NoteTab | undefined;
    if (tab) {
      tab.cursorOffset = cursorOffset;
      tab.scrollTop = scrollTop;
      // Only record history when the caller provided it — absent arg means
      // "just updating cursor/scroll" (e.g. position-save on scroll).
      if (historyJson !== undefined) tab.historyJson = historyJson;
      schedulePersistTabs();
    }
  }

  // ── Tab session persistence ────────────────────────────────────────────

  function schedulePersistTabs() {
    if (tabPersistTimer) clearTimeout(tabPersistTimer);
    tabPersistTimer = setTimeout(() => {
      tabPersistTimer = null;
      persistTabs();
    }, TAB_PERSIST_DELAY);
  }

  function persistTabs() {
    const savedTabs: SavedTab[] = tabs.map((t): SavedTab => {
      if (isNote(t)) {
        return { type: 'note', relativePath: t.relativePath, cursorOffset: t.cursorOffset, scrollTop: t.scrollTop };
      } else if (isQuery(t)) {
        return { type: 'query', title: t.title, query: t.query, language: t.language };
      } else {
        return { type: 'source', sourceId: t.sourceId, highlightExcerptId: t.highlightExcerptId };
      }
    });
    const session: TabSession = { activeIndex, tabs: savedTabs };
    void api.tabs.save(session);
  }

  async function restoreTabs() {
    const session = await api.tabs.load();
    if (!session || session.tabs.length === 0) return;

    for (const saved of session.tabs) {
      if (saved.type === 'note') {
        try {
          const text = await api.notebase.readFile(saved.relativePath);
          const fileName = saved.relativePath.split('/').pop() ?? '';
          const tab: NoteTab = {
            type: 'note',
            relativePath: saved.relativePath,
            fileName,
            content: text,
            savedContent: text,
            cursorOffset: saved.cursorOffset,
            scrollTop: saved.scrollTop,
          };
          tabs.push(tab);
        } catch {
          // File may have been deleted since last session
        }
      } else if (saved.type === 'query') {
        queryCounter++;
        const tab: QueryTab = {
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
        tabs.push(tab);
      } else {
        tabs.push({
          type: 'source',
          sourceId: saved.sourceId,
          highlightExcerptId: saved.highlightExcerptId,
        });
      }
    }

    // Clamp activeIndex to valid range
    if (session.activeIndex >= 0 && session.activeIndex < tabs.length) {
      activeIndex = session.activeIndex;
    } else if (tabs.length > 0) {
      activeIndex = 0;
    }
  }

  // ── Query operations ────────────────────────────────────────────────────

  function openQuery(initialQuery = '', language: QueryLanguage = 'sparql') {
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
    tabs.push(tab);
    activeIndex = tabs.length - 1;
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
        } else if (response.results.length > 0) {
          tab.columns = Object.keys(response.results[0] as Record<string, string>);
          tab.results = response.results as Record<string, string>[];
        } else {
          tab.columns = [];
          tab.results = [];
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

  function closeTab(index: number) {
    if (index < 0 || index >= tabs.length) return;
    if (index === activeIndex) flushAutoSave();
    tabs.splice(index, 1);
    if (tabs.length === 0) {
      activeIndex = -1;
    } else if (index <= activeIndex) {
      activeIndex = Math.max(0, activeIndex - 1);
    }
    schedulePersistTabs();
  }

  function closeOthers(index: number) {
    const kept = tabs[index];
    tabs.length = 0;
    tabs.push(kept);
    activeIndex = 0;
    schedulePersistTabs();
  }

  function closeAll() {
    flushAutoSave();
    tabs.length = 0;
    activeIndex = -1;
    schedulePersistTabs();
  }

  function switchTab(index: number) {
    if (index >= 0 && index < tabs.length) {
      flushAutoSave();
      activeIndex = index;
      schedulePersistTabs();
    }
  }

  function clear() {
    flushAutoSave();
    tabs.length = 0;
    activeIndex = -1;
  }

  return {
    get tabs() { return tabs; },
    get activeIndex() { return activeIndex; },
    get activeTab() { return activeTab(); },
    get activeNoteTab() { return activeNoteTab(); },
    get activeQueryTab() { return activeQueryTab(); },
    get activeSourceTab() { return activeSourceTab(); },
    get activeFilePath() { return activeNoteTab()?.relativePath ?? null; },
    get activeFileName() { return activeNoteTab()?.fileName ?? ''; },
    get content() { return activeNoteTab()?.content ?? ''; },
    get isDirty() {
      const tab = activeNoteTab();
      return tab ? tab.content !== tab.savedContent : false;
    },
    get hasAnyDirty() { return tabs.some((t) => isNote(t) && t.content !== t.savedContent); },
    openFile,
    openSource,
    save,
    isPathDirty,
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
    openQuery,
    setQueryText,
    setQueryLanguage,
    executeQuery,
    restoreTabs,
    persistTabs,
  };
}
