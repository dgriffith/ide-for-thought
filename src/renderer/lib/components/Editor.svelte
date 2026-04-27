<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { EditorState, Prec, Compartment, type Extension } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { getEffectiveTheme, getThemeMode } from '../theme';
  import { getEditorSettings, saveEditorSettings, type EditorSettings } from '../editor/settings';
  import { indentUnit, foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language';
  import { highlightWhitespace } from '@codemirror/view';
  import { search, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
  import { autocompletion, acceptCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
  import { historyField } from '@codemirror/commands';
  import { api } from '../ipc/client';
  import { sortLines, selectionTracker } from '../editor/commands';
  import {
    toggleBold, toggleItalic, toggleCode, toggleStrikethrough,
    toggleH1, toggleH2, toggleH3, toggleQuote, toggleBulletList, toggleNumberedList, toggleTaskList,
    insertTable, insertHorizontalRule, insertFootnote, insertLink, insertImage,
    insertWikiLink, insertTypedLinks,
  } from '../editor/formatting';
  import { resolveKeyBindings } from '../editor/command-registry';
  import { linkDecorations, findLinkAt, type LinkRange } from '../editor/link-decorations';
  import { computeCellsExtension } from '../editor/compute-cells';
  import { linkCompletionSource } from '../editor/link-autocomplete';
  import { planBlockLink } from '../editor/block-link';
  import { clampMenuToViewport } from '../utils/menuClamp';

  export interface CursorInfo {
    line: number;
    column: number;
    selectionLength: number;
    wordCount: number;
  }

  import { getToolInfosByCategory } from '../tools/tool-registry';

  interface Props {
    filePath: string;
    content: string;
    searchQuery?: string | null;
    onContentChange: (text: string) => void;
    onSave: () => void;
    onSearchQueryConsumed?: () => void;
    onEditorStateSave?: (
      filePath: string,
      cursorOffset: number,
      scrollTop: number,
      historyJson: unknown,
    ) => void;
    /**
     * Snapshot from a prior lifecycle (tab-switch unmount) to restore the
     * undo/redo stacks into the fresh EditorView. Ignored when the doc
     * inside the snapshot doesn't match the current `content` — stale
     * history would let the user undo to a state the file no longer shows.
     */
    initialHistory?: unknown;
    onCursorChange?: (info: CursorInfo) => void;
    onToolInvoke?: (toolId: string) => void;
    onOpenConversation?: () => void;
    onBookmark?: () => void;
    onInsertQueryList?: () => void;
    onNavigate?: (target: string) => void;
    /** Click on a `[[cite::source-id]]` in the editor → open the source tab. */
    onOpenSource?: (sourceId: string) => void;
    /** Click on a `[[quote::excerpt-id]]` in the editor → open the source tab with excerpt highlighted. */
    onOpenExcerpt?: (excerptId: string) => void;
    onExtractSelection?: () => void;
    onSplitHere?: () => void;
    onSplitByHeading?: () => void;
    onRename?: () => void;
    onMove?: () => void;
    onCopyFile?: () => void;
    onAutoTag?: () => void;
    onAutoLink?: () => void;
    onAutoLinkInbound?: () => void;
    onDecompose?: () => void;
    onDecomposeClaims?: () => void;
    onFormatCurrentNote?: () => void;
    /** Live list of note paths for wiki-link autocomplete. */
    getNotePaths?: () => string[];
    /** Live list of Sources for `[[cite::…]]` autocomplete. */
    getSources?: () => readonly import('../../../shared/types').SourceMetadata[];
  }

  let {
    filePath,
    content,
    searchQuery = null,
    onContentChange,
    onSave,
    onSearchQueryConsumed,
    onEditorStateSave,
    onCursorChange,
    onToolInvoke,
    onOpenConversation,
    onBookmark,
    onInsertQueryList,
    onNavigate,
    onOpenSource,
    onOpenExcerpt,
    onExtractSelection,
    onSplitHere,
    onSplitByHeading,
    onRename,
    onMove,
    onCopyFile,
    onAutoTag,
    onAutoLink,
    onAutoLinkInbound,
    onDecompose,
    onDecomposeClaims,
    onFormatCurrentNote,
    getNotePaths,
    getSources,
    initialHistory,
  }: Props = $props();

  const analysisTools = getToolInfosByCategory('analysis');
  const learningTools = getToolInfosByCategory('learning');

  let editorContainer: HTMLDivElement;
  let view: EditorView;
  let ignoreNextUpdate = false;
  let contextMenu = $state<{ x: number; y: number; link: LinkRange | null; hasSelection: boolean; docPos: number | null } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();
  // Separate from the main context menu: right-click anywhere in the
  // gutter opens a tiny toggle for line-number visibility. Keeps the
  // content-area menu from growing a gutter-only option that'd only
  // make sense in some click locations.
  let gutterMenu = $state<{ x: number; y: number; lineNumbers: boolean } | null>(null);
  let gutterMenuEl = $state<HTMLDivElement | undefined>();
  // Snapshot of the selection taken when the context menu opens, so
  // commands from the menu can run against what the user had selected
  // regardless of what the right-click and menu focus do in between.
  let savedSelection: { anchor: number; head: number } | null = null;

  const fontSizeCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const tabSizeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const lineNumbersCompartment = new Compartment();
  const whitespaceCompartment = new Compartment();

  /**
   * Sanity-check a stored history snapshot before handing it to
   * `EditorState.fromJSON`. CM's JSON is an opaque blob to us; we just
   * need `doc` (string) for the drift check. Anything that doesn't match
   * that minimum shape is treated as "no snapshot, start fresh."
   */
  function toHistorySnapshot(raw: unknown): { doc: string } & Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.doc !== 'string') return null;
    return obj as { doc: string } & Record<string, unknown>;
  }

  function cmTheme(): Extension {
    return getEffectiveTheme(getThemeMode()) === 'dark' ? oneDark : [];
  }

  export function updateTheme() {
    if (view) {
      view.dispatch({ effects: themeCompartment.reconfigure(cmTheme()) });
    }
  }
  const MIN_FONT = 10;
  const MAX_FONT = 24;
  const DEFAULT_FONT = 14;

  function getFontSize(): number {
    return parseInt(localStorage.getItem('editorFontSize') ?? String(DEFAULT_FONT), 10);
  }

  function fontSizeTheme(size: number) {
    return EditorView.theme({
      '.cm-content': { fontSize: `${size}px` },
      '.cm-gutters': { fontSize: `${size}px` },
    });
  }

  export function changeFontSize(delta: number) {
    const current = getFontSize();
    const next = Math.max(MIN_FONT, Math.min(MAX_FONT, current + delta));
    localStorage.setItem('editorFontSize', String(next));
    if (view) {
      view.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeTheme(next)) });
    }
  }

  export function resetFontSize() {
    localStorage.setItem('editorFontSize', String(DEFAULT_FONT));
    if (view) {
      view.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeTheme(DEFAULT_FONT)) });
    }
  }

  export function currentFontSize(): number {
    return getFontSize();
  }

  export function applySettings(settings: EditorSettings) {
    if (!view) return;
    saveEditorSettings(settings);
    view.dispatch({
      effects: [
        tabSizeCompartment.reconfigure([
          EditorState.tabSize.of(settings.tabSize),
          indentUnit.of(' '.repeat(settings.tabSize)),
        ]),
        wrapCompartment.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
        lineNumbersCompartment.reconfigure(settings.lineNumbers ? [] : EditorView.theme({
          // Must win against @codemirror/view's built-in theme which
          // declares `.cm-gutter { display: flex !important }`.
          '.cm-gutter.cm-lineNumbers': { display: 'none !important' },
        })),
        whitespaceCompartment.reconfigure(settings.showWhitespace ? highlightWhitespace() : []),
      ],
    });
    if (settings.alwaysCollapseFrontmatter) {
      foldFrontmatter();
    } else {
      unfoldFrontmatter();
    }
  }

  function findFrontmatterRange(): { from: number; to: number } | null {
    if (!view) return null;
    const doc = view.state.doc;
    if (doc.lines < 2) return null;
    const firstLine = doc.line(1);
    if (firstLine.text.trim() !== '---') return null;
    for (let i = 2; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.text.trim() === '---') {
        // Fold range spans the content between the --- markers, keeping
        // both fences visible as "---" lines in the gutter-collapsed view.
        return { from: firstLine.to, to: line.to };
      }
    }
    return null;
  }

  function foldFrontmatter() {
    if (!view) return;
    const range = findFrontmatterRange();
    if (!range) return;
    // Avoid dispatching if already folded at that range.
    const existing = foldedRanges(view.state);
    let alreadyFolded = false;
    existing.between(range.from, range.to, (from, to) => {
      if (from === range.from && to === range.to) alreadyFolded = true;
    });
    if (alreadyFolded) return;
    view.dispatch({ effects: foldEffect.of(range) });
  }

  function unfoldFrontmatter() {
    if (!view) return;
    const range = findFrontmatterRange();
    if (!range) return;
    view.dispatch({ effects: unfoldEffect.of(range) });
  }

  function showContextMenu(e: MouseEvent) {
    e.preventDefault();
    let link: LinkRange | null = null;
    let hasSelection = false;
    let docPos: number | null = null;
    if (view) {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      docPos = pos ?? null;
      if (pos != null) link = findLinkAt(view.state, pos);
      const sel = view.state.selection.main;
      hasSelection = sel.from !== sel.to;
    }
    contextMenu = { x: e.clientX, y: e.clientY, link, hasSelection, docPos };
    const close = () => {
      closeMenu();
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  function closeMenu() {
    contextMenu = null;
    savedSelection = null;
  }

  function handleWrapperContextMenu(e: MouseEvent) {
    // Intercept only gutter right-clicks; the content area routes
    // through CM's domEventHandlers.contextmenu to showContextMenu().
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.cm-gutters')) return;
    e.preventDefault();
    e.stopPropagation();
    const current = getEditorSettings();
    gutterMenu = { x: e.clientX, y: e.clientY, lineNumbers: current.lineNumbers };
    const close = () => {
      gutterMenu = null;
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  function toggleLineNumbers() {
    const current = getEditorSettings();
    applySettings({ ...current, lineNumbers: !current.lineNumbers });
    gutterMenu = null;
  }

  /** Restore the selection we snapshotted on right-click and refocus the
   * editor, so menu-triggered commands operate on the original selection
   * regardless of what happened to focus/selection in between. */
  function restoreSelection(): void {
    if (!view) return;
    if (savedSelection) {
      view.dispatch({ selection: savedSelection });
    }
    view.focus();
  }

  function openLink(link: LinkRange) {
    if (link.kind === 'wiki') {
      if (link.linkType === 'cite') {
        onOpenSource?.(link.href);
      } else if (link.linkType === 'quote') {
        onOpenExcerpt?.(link.href);
      } else {
        onNavigate?.(link.href);
      }
    } else {
      void api.shell.openExternal(link.href);
    }
    closeMenu();
  }

  function editLink(link: LinkRange) {
    if (!view) return;
    view.dispatch({
      selection: { anchor: link.editFrom, head: link.editTo },
    });
    view.focus();
    closeMenu();
  }

  /** Run an inline menu action with selection restored and focus in the
   * editor. Use this for the onclick handlers on template menu buttons. */
  function handleMenuAction(action: () => void) {
    restoreSelection();
    closeMenu();
    action();
  }

  function execCommand(cmd: string) {
    restoreSelection();
    document.execCommand(cmd);
    closeMenu();
  }

  function runCmd(cmd: (v: EditorView) => boolean) {
    restoreSelection();
    if (view) cmd(view);
    closeMenu();
  }

  /**
   * Right-click action: anchor the paragraph under the cursor with a
   * `^block-id` marker (reusing any existing one) and copy the canonical
   * `[[note#^block-id]]` link to the clipboard. Blank lines and notes
   * with no path yet (unsaved buffers) are silently skipped.
   */
  async function copyBlockLink(): Promise<void> {
    if (!view || !contextMenu || contextMenu.docPos == null || !filePath) {
      closeMenu();
      return;
    }
    const plan = planBlockLink(view.state.doc.toString(), contextMenu.docPos);
    if (!plan) { closeMenu(); return; }
    if (plan.edit) {
      view.dispatch({ changes: { from: plan.edit.at, insert: plan.edit.text } });
    }
    const relPath = filePath.replace(/\.md$/, '');
    await navigator.clipboard.writeText(`[[${relPath}#^${plan.blockId}]]`);
    closeMenu();
  }

  // Flip a submenu up/left if its default position (right of + below the parent
  // item) would extend past the viewport. Called on submenu-item hover.
  function adjustSubmenu(event: MouseEvent) {
    const item = event.currentTarget as HTMLElement;
    const submenu = item.querySelector<HTMLElement>(':scope > .submenu');
    if (!submenu) return;

    // Reset any prior inline overrides so we measure the default CSS position.
    submenu.style.top = '';
    submenu.style.bottom = '';
    submenu.style.left = '';
    submenu.style.right = '';

    requestAnimationFrame(() => {
      const rect = submenu.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const MARGIN = 8;

      if (rect.bottom > vh - MARGIN) {
        submenu.style.top = 'auto';
        submenu.style.bottom = '-4px';
      }
      if (rect.right > vw - MARGIN) {
        submenu.style.left = 'auto';
        submenu.style.right = '100%';
      }
    });
  }

  const initSettings = getEditorSettings();

  const extensions = [
    basicSetup,
    markdown({ codeLanguages: languages }),
    themeCompartment.of(cmTheme()),
    search({
      top: true,
      scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: 'center' }),
    }),
    selectionTracker,
    fontSizeCompartment.of(fontSizeTheme(getFontSize())),
    tabSizeCompartment.of([
      EditorState.tabSize.of(initSettings.tabSize),
      indentUnit.of(' '.repeat(initSettings.tabSize)),
    ]),
    wrapCompartment.of(initSettings.wordWrap ? EditorView.lineWrapping : []),
    lineNumbersCompartment.of(initSettings.lineNumbers ? [] : EditorView.theme({
      // See applySettings — overriding the default theme's !important
      // flex rule needs our own !important.
      '.cm-gutter.cm-lineNumbers': { display: 'none !important' },
    })),
    whitespaceCompartment.of(initSettings.showWhitespace ? highlightWhitespace() : []),
    linkDecorations({
      onOpenNote: (target: string) => {
        if (onNavigate) onNavigate(target);
      },
      onOpenSource: (sourceId: string) => {
        if (onOpenSource) onOpenSource(sourceId);
      },
      onOpenExcerpt: (excerptId: string) => {
        if (onOpenExcerpt) onOpenExcerpt(excerptId);
      },
      onOpenExternal: (url: string) => {
        void api.shell.openExternal(url);
      },
    }),
    computeCellsExtension({
      runCell: (language, code) => api.compute.runCell(language, code, filePath),
    }),
    EditorView.domEventHandlers({
      // Snapshot the selection at the very start of a right-click, before
      // any built-in handling can collapse it. Then, when the click is
      // inside the selection, preventDefault so CM's own mousedown doesn't
      // move the caret and visually wipe the highlight.
      mousedown: (e, view) => {
        if (e.button !== 2) return false;
        const sel = view.state.selection.main;
        savedSelection = sel.from !== sel.to
          ? { anchor: sel.anchor, head: sel.head }
          : null;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        if (sel.from !== sel.to && pos >= sel.from && pos <= sel.to) {
          e.preventDefault();
          return true;
        }
        return false;
      },
      contextmenu: (e) => {
        // Backup snapshot — covers the context-menu keyboard shortcut,
        // where no right-click mousedown fires.
        if (!savedSelection && view) {
          const sel = view.state.selection.main;
          if (sel.from !== sel.to) {
            savedSelection = { anchor: sel.anchor, head: sel.head };
          }
        }
        showContextMenu(e);
        return true;
      },
    }),
  ];

  async function tagCompletion(context: CompletionContext): Promise<CompletionResult | null> {
    const match = context.matchBefore(/#[\w-/]*/);
    if (!match) return null;
    if (match.from > 0) {
      const charBefore = context.state.doc.sliceString(match.from - 1, match.from);
      if (charBefore !== ' ' && charBefore !== '\n' && match.from !== 0) return null;
    }
    const tags = await api.tags.allNames();
    const typed = match.text.slice(1);
    return {
      from: match.from,
      options: tags
        .filter((t) => t.toLowerCase().startsWith(typed.toLowerCase()))
        .map((tag) => ({ label: `#${tag}`, type: 'keyword', apply: `#${tag}` })),
    };
  }

  export function runSortLines() {
    if (view) sortLines(view);
  }

  export function openFind() {
    if (!view) return;
    openSearchPanel(view);
  }

  export function openFindReplace() {
    if (!view) return;
    openSearchPanel(view);
    // The panel renders synchronously but focus lands on the search input —
    // hop to the replace field so Cmd+H lands where the user expects.
    requestAnimationFrame(() => {
      const replaceInput = view?.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]');
      replaceInput?.focus();
      replaceInput?.select();
    });
  }

  export function gotoLineColumn(line: number, col: number) {
    if (!view) return;
    const maxLine = view.state.doc.lines;
    const clampedLine = Math.max(1, Math.min(line, maxLine));
    const lineObj = view.state.doc.line(clampedLine);
    const maxCol = lineObj.length + 1;
    const clampedCol = Math.max(1, Math.min(col, maxCol));
    const pos = lineObj.from + clampedCol - 1;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    // Defer focus so the Enter keyup from the dialog doesn't fire in CM
    requestAnimationFrame(() => view.focus());
  }

  export function getCursorPosition(): { line: number; column: number } {
    if (!view) return { line: 1, column: 1 };
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    return { line: line.number, column: pos - line.from + 1 };
  }

  export function getOffset(): number {
    if (!view) return 0;
    return view.state.selection.main.head;
  }

  export function getView(): EditorView | undefined {
    return view;
  }

  export function getSelectionRange(): { from: number; to: number } | null {
    if (!view) return null;
    const main = view.state.selection.main;
    if (main.from === main.to) return null;
    return { from: main.from, to: main.to };
  }

  export function gotoOffset(offset: number) {
    if (!view) return;
    const clamped = Math.max(0, Math.min(offset, view.state.doc.length));
    view.dispatch({
      selection: { anchor: clamped },
      effects: EditorView.scrollIntoView(clamped, { y: 'center' }),
    });
    view.focus();
  }

  export function insertText(text: string) {
    if (!view) return;
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length },
    });
    view.focus();
  }

  export function restorePosition(offset: number, scrollTop?: number) {
    if (!view) return;
    const clamped = Math.max(0, Math.min(offset, view.state.doc.length));
    if (scrollTop && scrollTop > 0) {
      view.dispatch({ selection: { anchor: clamped } });
      view.scrollDOM.scrollTop = scrollTop;
    } else if (clamped > 0) {
      view.dispatch({
        selection: { anchor: clamped },
        effects: EditorView.scrollIntoView(clamped, { y: 'center' }),
      });
    }
    view.focus();
  }

  onMount(() => {
    const resolved = resolveKeyBindings();
    const appKeymap = Prec.highest(keymap.of([
      { key: 'Mod-s', run: () => { onSave(); return true; } },
      // Tab accepts the active completion; acceptCompletion returns false
      // when no completion panel is open, so Tab-for-indent still works
      // everywhere else.
      { key: 'Tab', run: acceptCompletion },
      ...resolved.map(({ key: k, command: run }) => ({ key: k, run })),
    ]));

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !ignoreNextUpdate) {
        onContentChange(update.state.doc.toString());
      }
      ignoreNextUpdate = false;

      if (update.selectionSet || update.docChanged) {
        const { state } = update;
        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const sel = state.selection.main;
        const docText = state.doc.toString();
        onCursorChange?.({
          line: line.number,
          column: pos - line.from + 1,
          selectionLength: Math.abs(sel.to - sel.from),
          wordCount: docText.trim() ? docText.trim().split(/\s+/).length : 0,
        });
      }
    });

    const linkCompletion = linkCompletionSource({
      getNotePaths: () => getNotePaths?.() ?? [],
      getSources: () => getSources?.() ?? [],
      readNote: (p) => api.notebase.readFile(p),
    });

    const completion = autocompletion({
      override: [tagCompletion, linkCompletion],
      activateOnTyping: true,
      closeOnBlur: true,
    });

    const allExtensions = [...extensions, appKeymap, updateListener, completion];

    // When the caller passes a history snapshot AND its serialised doc
    // still matches the current content, restore the undo/redo stacks
    // into the fresh view. If the content has drifted (file reloaded from
    // disk, programmatic rewrite, etc.) we fall back to a clean state —
    // undoing to a document that no longer matches reality is worse than
    // losing history.
    const snapshot = toHistorySnapshot(initialHistory);
    const canRestore = snapshot !== null && snapshot.doc === content;
    const state = canRestore
      ? EditorState.fromJSON(
          snapshot,
          { extensions: allExtensions },
          { history: historyField },
        )
      : EditorState.create({ doc: content, extensions: allExtensions });
    view = new EditorView({ state, parent: editorContainer });

    if (initSettings.alwaysCollapseFrontmatter) {
      // Defer so the folding extension is active before we dispatch
      requestAnimationFrame(() => foldFrontmatter());
    }

    // Track scrollTop continuously — by cleanup time the DOM may already be detached
    let lastScrollTop = 0;
    const onScroll = () => { lastScrollTop = view.scrollDOM.scrollTop; };
    view.scrollDOM.addEventListener('scroll', onScroll);

    const mountedFilePath = filePath;
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll);
      const historySnapshot = view.state.toJSON({ history: historyField }) as Record<string, unknown>;
      onEditorStateSave?.(
        mountedFilePath,
        view.state.selection.main.head,
        lastScrollTop,
        historySnapshot,
      );
      view.destroy();
    };
  });

  // Handle external content changes within the same tab (e.g. file reloaded from disk)
  $effect(() => {
    if (view && content !== view.state.doc.toString()) {
      ignoreNextUpdate = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
  });

  // Keep the context menu inside the viewport — flip it up/left when it
  // would otherwise extend past the bottom or right edge.
  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });

  $effect(() => {
    if (!gutterMenu || !gutterMenuEl) return;
    const next = clampMenuToViewport(gutterMenu.x, gutterMenu.y, gutterMenuEl);
    if (next.x !== gutterMenu.x || next.y !== gutterMenu.y) {
      gutterMenu = { ...gutterMenu, ...next };
    }
  });

  $effect(() => {
    if (!view || !searchQuery) return;
    const q = searchQuery;

    requestAnimationFrame(() => {
      if (!view) return;
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: q })),
      });
      openSearchPanel(view);

      const doc = view.state.doc.toString();
      const idx = doc.toLowerCase().indexOf(q.toLowerCase());
      if (idx !== -1) {
        view.dispatch({
          selection: { anchor: idx, head: idx + q.length },
          effects: EditorView.scrollIntoView(idx, { y: 'center' }),
        });
      }
    });

    onSearchQueryConsumed?.();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor-wrapper" bind:this={editorContainer} oncontextmenu={handleWrapperContextMenu}></div>

{#if gutterMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="context-menu gutter-menu"
    bind:this={gutterMenuEl}
    style:left="{gutterMenu.x}px"
    style:top="{gutterMenu.y}px"
    onmousedown={(e) => e.preventDefault()}
  >
    <button onclick={toggleLineNumbers}>
      <span class="check">{gutterMenu.lineNumbers ? '✓' : ''}</span>
      Show Line Numbers
    </button>
  </div>
{/if}

{#if contextMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="context-menu"
    bind:this={contextMenuEl}
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
    onmousedown={(e) => e.preventDefault()}
  >
    {#if contextMenu.link}
      <button onclick={() => openLink(contextMenu!.link!)}>Open Link</button>
      <button onclick={() => editLink(contextMenu!.link!)}>Edit Link</button>
      <div class="separator"></div>
    {/if}
    <button onclick={() => execCommand('cut')}>Cut</button>
    <button onclick={() => execCommand('copy')}>Copy</button>
    <button onclick={() => execCommand('paste')}>Paste</button>
    {#if filePath}
      <button onclick={() => copyBlockLink()}>Copy Block Link</button>
    {/if}
    <div class="separator"></div>
    <div class="submenu-item" onmouseenter={adjustSubmenu}>
      <span class="submenu-trigger">Format &#x25B8;</span>
      <div class="submenu">
        <button onclick={() => runCmd(toggleBold)}>Bold</button>
        <button onclick={() => runCmd(toggleItalic)}>Italic</button>
        <button onclick={() => runCmd(toggleCode)}>Code</button>
        <button onclick={() => runCmd(toggleStrikethrough)}>Strikethrough</button>
      </div>
    </div>
    <div class="submenu-item" onmouseenter={adjustSubmenu}>
      <span class="submenu-trigger">Paragraph &#x25B8;</span>
      <div class="submenu">
        <button onclick={() => runCmd(toggleH1)}>Heading 1</button>
        <button onclick={() => runCmd(toggleH2)}>Heading 2</button>
        <button onclick={() => runCmd(toggleH3)}>Heading 3</button>
        <button onclick={() => runCmd(toggleQuote)}>Quote</button>
        <button onclick={() => runCmd(toggleBulletList)}>Bulleted List</button>
        <button onclick={() => runCmd(toggleNumberedList)}>Numbered List</button>
        <button onclick={() => runCmd(toggleTaskList)}>Task List</button>
      </div>
    </div>
    <div class="submenu-item" onmouseenter={adjustSubmenu}>
      <span class="submenu-trigger">Insert &#x25B8;</span>
      <div class="submenu">
        <button onclick={() => runCmd(insertWikiLink)}>Wiki Link</button>
        <button onclick={() => runCmd(insertLink)}>URL Link</button>
        <button onclick={() => runCmd(insertImage)}>Image</button>
        <button onclick={() => runCmd(insertTable)}>Table</button>
        <button onclick={() => runCmd(insertHorizontalRule)}>Horizontal Rule</button>
        <button onclick={() => runCmd(insertFootnote)}>Footnote</button>
        <div class="submenu-separator"></div>
        {#each insertTypedLinks as { linkType, command }}
          <button onclick={() => runCmd(command)}>
            <span class="typed-link-dot" style:background={linkType.color}></span>
            {linkType.label} Link
          </button>
        {/each}
        <div class="submenu-separator"></div>
        <button onclick={() => handleMenuAction(() => onInsertQueryList?.())}>Link List for Tag...</button>
      </div>
    </div>
    {#if onToolInvoke && (analysisTools.length > 0 || learningTools.length > 0)}
      <div class="separator"></div>
      {#if learningTools.length > 0}
        <div class="submenu-item" onmouseenter={adjustSubmenu}>
          <span class="submenu-trigger">Learning &#x25B8;</span>
          <div class="submenu">
            {#each learningTools.filter((t) => contextMenu!.hasSelection || !t.requiresSelection) as tool}
              <button onclick={() => handleMenuAction(() => onToolInvoke?.(tool.id))}>{tool.name}</button>
            {/each}
          </div>
        </div>
      {/if}
      {#if analysisTools.length > 0}
        <div class="submenu-item" onmouseenter={adjustSubmenu}>
          <span class="submenu-trigger">Analysis &#x25B8;</span>
          <div class="submenu">
            {#each analysisTools as tool}
              <button onclick={() => handleMenuAction(() => onToolInvoke?.(tool.id))}>{tool.name}</button>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
    {#if onDecomposeClaims}
      <div class="submenu-item" onmouseenter={adjustSubmenu}>
        <span class="submenu-trigger">Research &#x25B8;</span>
        <div class="submenu">
          <button onclick={() => handleMenuAction(() => onDecomposeClaims?.())}>Decompose into Claims</button>
        </div>
      </div>
    {/if}
    <div class="separator"></div>
    {#if onExtractSelection || onSplitHere || onSplitByHeading || onRename || onMove || onCopyFile || onAutoTag || onAutoLink || onAutoLinkInbound || onDecompose}
      <div class="submenu-item" onmouseenter={adjustSubmenu}>
        <span class="submenu-trigger">Refactor &#x25B8;</span>
        <div class="submenu">
          {#if onRename}
            <button onclick={() => handleMenuAction(() => onRename?.())}>Rename&hellip;</button>
          {/if}
          {#if onMove}
            <button onclick={() => handleMenuAction(() => onMove?.())}>Move&hellip;</button>
          {/if}
          {#if onCopyFile}
            <button onclick={() => handleMenuAction(() => onCopyFile?.())}>Copy&hellip;</button>
          {/if}
          {#if onRename || onMove || onCopyFile}
            <div class="separator"></div>
          {/if}
          {#if onExtractSelection}
            <button
              onclick={() => handleMenuAction(() => onExtractSelection?.())}
              disabled={!contextMenu.hasSelection}
            >Extract Selection to New Note</button>
          {/if}
          {#if onSplitHere}
            <button onclick={() => handleMenuAction(() => onSplitHere?.())}>Split Note Here</button>
          {/if}
          {#if onSplitByHeading}
            <button onclick={() => handleMenuAction(() => onSplitByHeading?.())}>Split by Heading&hellip;</button>
          {/if}
          {#if onAutoTag || onAutoLink || onAutoLinkInbound || onDecompose}
            {#if onExtractSelection || onSplitHere || onSplitByHeading}
              <div class="separator"></div>
            {/if}
            {#if onAutoTag}
              <button onclick={() => handleMenuAction(() => onAutoTag?.())}>Auto-tag</button>
            {/if}
            {#if onAutoLink}
              <button onclick={() => handleMenuAction(() => onAutoLink?.())}>Auto-link outbound&hellip;</button>
            {/if}
            {#if onAutoLinkInbound}
              <button onclick={() => handleMenuAction(() => onAutoLinkInbound?.())}>Auto-link inbound&hellip;</button>
            {/if}
            {#if onDecompose}
              <button onclick={() => handleMenuAction(() => onDecompose?.())}>Decompose Note&hellip;</button>
            {/if}
          {/if}
          {#if onFormatCurrentNote}
            <div class="separator"></div>
            <button onclick={() => handleMenuAction(() => onFormatCurrentNote?.())}>Format Note</button>
          {/if}
        </div>
      </div>
      <div class="separator"></div>
    {/if}
    <button onclick={() => handleMenuAction(() => onOpenConversation?.())}>Ask About This...</button>
    <button onclick={() => handleMenuAction(() => onBookmark?.())}>Bookmark This Note</button>
    <div class="separator"></div>
    <div class="submenu-item" onmouseenter={adjustSubmenu}>
      <span class="submenu-trigger">Open In &#x25B8;</span>
      <div class="submenu">
        <button onclick={() => { void api.shell.revealFile(filePath); closeMenu(); }}>Reveal in Finder</button>
        <button onclick={() => { void api.shell.openInDefault(filePath); closeMenu(); }}>Open in Default App</button>
        <button onclick={() => { void api.shell.openInTerminal(filePath); closeMenu(); }}>Open in Terminal</button>
      </div>
    </div>
    <div class="separator"></div>
    <button onclick={() => execCommand('selectAll')}>Select All</button>
  </div>
{/if}

<style>
  .editor-wrapper {
    flex: 1;
    overflow: hidden;
  }

  .editor-wrapper :global(.cm-editor) {
    height: 100%;
  }

  .editor-wrapper :global(.cm-scroller) {
    overflow: auto;
  }

  /* Center the fold-gutter arrows (▸ / ▾) in their column. CM's fold
     column shrink-wraps to the glyph width (~14px), so we widen the
     column first, then make the inner span fill it and center its text.
     text-align on the .cm-gutterElement alone doesn't work because the
     arrow is wrapped in an inline-block span that shrinks to glyph width. */
  .editor-wrapper :global(.cm-foldGutter) {
    min-width: 20px;
    padding: 0;
  }
  .editor-wrapper :global(.cm-foldGutter .cm-gutterElement) {
    padding: 0;
    width: 100%;
  }
  .editor-wrapper :global(.cm-foldGutter span) {
    display: block;
    padding: 0;
    text-align: center;
  }

  /* Compute-cells run-icon gutter (#238). Styles kept in sync with
     `computeCellsStyles` in src/renderer/lib/editor/compute-cells.ts —
     inlined here because Svelte's scoped-CSS model requires :global()
     wrappers at the component level. */
  /* min-width 0: column collapses to zero when the note has no
     runnable fences. See the matching comment in compute-cells.ts. */
  .editor-wrapper :global(.cm-compute-gutter) { min-width: 0; }
  .editor-wrapper :global(.cm-compute-run) {
    display: inline-block;
    width: 14px;
    text-align: center;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    font-size: 10px;
    line-height: 1;
  }
  .editor-wrapper :global(.cm-compute-run:hover) { color: var(--accent); }
  .editor-wrapper :global(.cm-compute-running) {
    color: var(--accent);
    animation: cm-compute-pulse 1s infinite;
  }
  @keyframes cm-compute-pulse { 50% { opacity: 0.4; } }

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

  .context-menu button:hover {
    background: var(--bg-button);
  }

  .gutter-menu { min-width: 180px; }
  .gutter-menu button { display: flex; align-items: center; gap: 8px; }
  .gutter-menu .check { width: 12px; text-align: center; color: var(--accent); }

  .submenu-item {
    position: relative;
  }

  .submenu-trigger {
    display: block;
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
  }

  .submenu-item:hover > .submenu {
    display: block;
  }

  .submenu-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .typed-link-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: middle;
  }

  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
</style>
