import { api } from '../ipc/client';

export interface Tab {
  relativePath: string;
  fileName: string;
  content: string;
  savedContent: string;
  /** Serialized CM editor state JSON — preserved across tab switches */
  editorStateJSON?: unknown;
  /** Scroll position — preserved across tab switches */
  scrollTop?: number;
}

let tabs = $state<Tab[]>([]);
let activeIndex = $state(-1);

export function getEditorStore() {
  function activeTab(): Tab | null {
    return activeIndex >= 0 && activeIndex < tabs.length ? tabs[activeIndex] : null;
  }

  async function openFile(relativePath: string) {
    // If already open, just switch to it
    const existing = tabs.findIndex((t) => t.relativePath === relativePath);
    if (existing !== -1) {
      activeIndex = existing;
      return;
    }

    const text = await api.notebase.readFile(relativePath);
    const fileName = relativePath.split('/').pop() ?? '';
    const tab: Tab = {
      relativePath,
      fileName,
      content: text,
      savedContent: text,
    };
    tabs.push(tab);
    activeIndex = tabs.length - 1;
  }

  async function save() {
    const tab = activeTab();
    if (!tab) return;
    await api.notebase.writeFile(tab.relativePath, tab.content);
    tab.savedContent = tab.content;
  }

  function setContent(text: string) {
    const tab = activeTab();
    if (tab) tab.content = text;
  }

  function closeTab(index: number) {
    if (index < 0 || index >= tabs.length) return;
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
    tabs.length = 0;
    activeIndex = -1;
  }

  function switchTab(index: number) {
    if (index >= 0 && index < tabs.length) {
      activeIndex = index;
    }
  }

  function clear() {
    tabs.length = 0;
    activeIndex = -1;
  }

  /** Save CM editor state for current tab before switching away */
  function saveEditorState(stateJSON: unknown, scrollTop: number) {
    const tab = activeTab();
    if (tab) {
      tab.editorStateJSON = stateJSON;
      tab.scrollTop = scrollTop;
    }
  }

  return {
    get tabs() { return tabs; },
    get activeIndex() { return activeIndex; },
    get activeTab() { return activeTab(); },
    get activeFilePath() { return activeTab()?.relativePath ?? null; },
    get activeFileName() { return activeTab()?.fileName ?? ''; },
    get content() { return activeTab()?.content ?? ''; },
    get isDirty() {
      const tab = activeTab();
      return tab ? tab.content !== tab.savedContent : false;
    },
    get hasAnyDirty() { return tabs.some((t) => t.content !== t.savedContent); },
    openFile,
    save,
    setContent,
    closeTab,
    closeOthers,
    closeAll,
    switchTab,
    clear,
    saveEditorState,
  };
}
