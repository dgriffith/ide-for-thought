import { api } from '../ipc/client';
import type { TabSession, SavedTab } from '../../../shared/types';

// ── Tab types ───────────────────────────────────────────────────────────────

export interface NoteTab {
  type: 'note';
  relativePath: string;
  fileName: string;
  content: string;
  savedContent: string;
  cursorOffset?: number;
  scrollTop?: number;
}

export interface QueryTab {
  type: 'query';
  id: string;
  title: string;
  query: string;
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

let tabs = $state<Tab[]>([]);
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
      save();
    }
  }

  function saveEditorState(relativePath: string, cursorOffset: number, scrollTop: number) {
    const tab = tabs.find((t) => isNote(t) && t.relativePath === relativePath) as NoteTab | undefined;
    if (tab) {
      tab.cursorOffset = cursorOffset;
      tab.scrollTop = scrollTop;
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
        return { type: 'query', title: t.title, query: t.query };
      } else {
        return { type: 'source', sourceId: t.sourceId, highlightExcerptId: t.highlightExcerptId };
      }
    });
    const session: TabSession = { activeIndex, tabs: savedTabs };
    api.tabs.save(session);
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

  function openQuery(initialQuery = '') {
    queryCounter++;
    const tab: QueryTab = {
      type: 'query',
      id: `query-${queryCounter}-${Date.now()}`,
      title: `Query ${queryCounter}`,
      query: initialQuery,
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
      const response = await api.graph.query(tab.query);
      tab.executionTime = Math.round(performance.now() - start);
      if ((response as any).error) {
        tab.error = (response as any).error;
      } else if (response.results.length > 0) {
        tab.columns = Object.keys(response.results[0] as Record<string, string>);
        tab.results = response.results as Record<string, string>[];
      } else {
        tab.columns = [];
        tab.results = [];
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
    executeQuery,
    restoreTabs,
    persistTabs,
  };
}
