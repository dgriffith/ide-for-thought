import { api } from '../ipc/client';

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

export type Tab = NoteTab | QueryTab;

// ── Helpers ─────────────────────────────────────────────────────────────────

function isNote(tab: Tab): tab is NoteTab { return tab.type === 'note'; }
function isQuery(tab: Tab): tab is QueryTab { return tab.type === 'query'; }

let queryCounter = 0;

// ── State ───────────────────────────────────────────────────────────────────

let tabs = $state<Tab[]>([]);
let activeIndex = $state(-1);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let onAutoSaved: (() => void) | null = null;
const AUTO_SAVE_DELAY = 1000;

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
  }

  function closeOthers(index: number) {
    const kept = tabs[index];
    tabs.length = 0;
    tabs.push(kept);
    activeIndex = 0;
  }

  function closeAll() {
    flushAutoSave();
    tabs.length = 0;
    activeIndex = -1;
  }

  function switchTab(index: number) {
    if (index >= 0 && index < tabs.length) {
      flushAutoSave();
      activeIndex = index;
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
    get activeFilePath() { return activeNoteTab()?.relativePath ?? null; },
    get activeFileName() { return activeNoteTab()?.fileName ?? ''; },
    get content() { return activeNoteTab()?.content ?? ''; },
    get isDirty() {
      const tab = activeNoteTab();
      return tab ? tab.content !== tab.savedContent : false;
    },
    get hasAnyDirty() { return tabs.some((t) => isNote(t) && t.content !== t.savedContent); },
    openFile,
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
  };
}
