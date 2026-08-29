/**
 * Tab/editor-group type definitions, extracted from `stores/editor.svelte.ts`
 * (#1919) so `editor/tab-session.ts` (the pure session-serialization module)
 * can share them without importing the store itself — that would be a cycle,
 * since the store imports the session module's functions. `editor.svelte.ts`
 * re-exports everything here so existing `from '../stores/editor.svelte'`
 * imports across the renderer are unaffected.
 */

export interface NoteTab {
  type: 'note';
  relativePath: string;
  fileName: string;
  content: string;
  savedContent: string;
  /** True when opened in plain-text mode — a non-markdown text file (#1130).
   *  Drives the Editor's plain-text mode (markdown behaviors off). Omitted for
   *  markdown files. */
  plainText?: boolean | undefined;
  cursorOffset?: number | undefined;
  scrollTop?: number | undefined;
  /** Preview-pane scroll offset. Separate from `scrollTop`: the editor and the
   *  preview lay the same note out at different heights, so sharing one number
   *  would land the reader in the wrong place. */
  previewScrollTop?: number | undefined;
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
  highlightExcerptId?: string | undefined;
}

export interface PdfTab {
  type: 'pdf';
  sourceId: string;
  /** 1-based current page; viewer updates this on navigation so
   *  reopening the tab restores the user's place. */
  page: number;
}

export interface GraphTab {
  type: 'graph';
  /** The note whose link neighborhood is shown (#847). */
  relativePath: string;
  /** Traversal depth (1–N). */
  depth: number;
}

export interface UnsupportedTab {
  type: 'unsupported';
  relativePath: string;
  fileName: string;
  /** Lowercased extension (with dot) or '' — drives the "no preview for `.xyz`" copy. */
  ext: string;
}

/** Multi-view over all instances of a typed-object type (#1070). */
export type TypeViewLayout = 'list' | 'table' | 'gallery';
/** The view's mutable projection state — layout + sort + visible columns.
 *  Carried on the tab (persisted across sessions) and captured into a saved
 *  view (#1072). */
export interface TypeViewState {
  layout: TypeViewLayout;
  /** Sort key: a property name, `__title`, or null for the intrinsic order. */
  sortColumn: string | null;
  sortDir: 'asc' | 'desc';
  /** Visible property names (table); null = every declared column. */
  columns: string[] | null;
}
export interface TypeViewTab extends TypeViewState {
  type: 'type-view';
  /** The type whose instances are shown (e.g. `book`). */
  typeId: string;
}

export type Tab = NoteTab | QueryTab | SourceTab | PdfTab | GraphTab | TypeViewTab | UnsupportedTab;

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

export function isNote(tab: Tab): tab is NoteTab { return tab.type === 'note'; }
export function isQuery(tab: Tab): tab is QueryTab { return tab.type === 'query'; }
export function isSource(tab: Tab): tab is SourceTab { return tab.type === 'source'; }
export function isPdf(tab: Tab): tab is PdfTab { return tab.type === 'pdf'; }
export function isGraph(tab: Tab): tab is GraphTab { return tab.type === 'graph'; }
export function isTypeView(tab: Tab): tab is TypeViewTab { return tab.type === 'type-view'; }
export function isUnsupported(tab: Tab): tab is UnsupportedTab { return tab.type === 'unsupported'; }
