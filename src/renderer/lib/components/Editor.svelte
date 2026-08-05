<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import EditorContextMenu from './EditorContextMenu.svelte';
  import QuickFixMenu, { type QuickFix } from './QuickFixMenu.svelte';
  import { installDismissOnClickOutside } from '../dismiss-menu';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { EditorState, Prec, Compartment } from '@codemirror/state';
  import { cmTheme, minervaEditorTheme, fontSizeTheme, hiddenLineNumbersTheme } from '../editor/editor-theme';
  import { getEditorSettings, saveEditorSettings, type EditorSettings } from '../editor/settings';
  import { indentUnit, foldEffect, unfoldEffect, foldedRanges, foldService } from '@codemirror/language';
  import { highlightWhitespace } from '@codemirror/view';
  import { search, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
  import { autocompletion, acceptCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
  import { acceptCompletionEatTail, completionKeymapNoEnter } from '../editor/accept-completion-eat-tail';
  import { historyField } from '@codemirror/commands';
  import { api } from '../ipc/client';
  import {
    uploadImage,
    relativeAssetPathForNote,
    rejectionMessage,
    type UploadResult,
  } from '../editor/image-upload';
  import { sortLines, selectionTracker } from '../editor/commands';
  import { resolveKeyBindings } from '../editor/command-registry';
  import { toggleEditorDictation } from '../editor/dictation';
  import { linkDecorations, findLinkAt, type LinkRange } from '../editor/link-decorations';
  import { highlightDecorations } from '../editor/highlight-decorations';
  import { brokenLinkDecorations, brokenNoteLinkAt } from '../editor/broken-link-decorations';
  import { computeCellsExtension, type RunAllRef } from '../editor/compute-cells';
  import {
    bookmarkGutterExtension,
    applyBookmarkOffsets,
    resolveBookmarkOffsets,
    type BookmarkRef,
  } from '../editor/bookmark-gutter';
  import { footnotePreview } from '../editor/footnote-preview';
  import { linkPreview } from '../editor/link-preview';
  import { footnoteDecorations } from '../editor/footnote-decorations';
  import { linkCompletionSource } from '../editor/link-autocomplete';
  import { typeCreateCompletionSource } from '../editor/type-create-autocomplete';
  import type { TypeInfo } from '../../../shared/objects/type-def';
  import { planBlockLink } from '../editor/block-link';
  import { toHistorySnapshot, canRestoreHistory } from '../editor/history-snapshot';
  import { DEFAULT_FONT, clampFontSize, parseStoredFontSize } from '../editor/font-size';
  import { hasImageFiles, imageFilesFromTransfer, imageFilesFromClipboard } from '../editor/image-drop';
  import { dataTransferHasItem, draggedItemFromDataTransfer, wikiLinkForItem, insertWikiLinkAtPos } from '../editor/drag-link';
  import { formatPaste } from '../editor/paste-format';
  import { getFormatSettings } from '../formatter/settings';
  import { buildParseCache } from '../../../shared/formatter/parse-cache';
  import { findFrontmatterFoldRange } from '../editor/frontmatter';
  import { clampMenuToViewport, clampSubmenu } from '../utils/menuClamp';
  import { extractClaimUri } from '../../../shared/refactor/find-arguments';
  import type { EditorContextMenuState, EditorMenuOps } from '../editor/context-menu-ops';

  export interface CursorInfo {
    line: number;
    column: number;
    selectionLength: number;
    wordCount: number;
  }

  import { getToolInfosByCategory } from '../tools/tool-registry';
  import { isSourceScoped } from '../../../shared/tools/types';
  import { groupToolsByGroup } from '../../../shared/tools/grouping';

  interface Props {
    /**
     * The editor group this instance belongs to (#812). The parent sources
     * `filePath` / `content` / `initialHistory` from this group's active tab
     * and routes state-changing callbacks back to it, so multiple instances
     * (one per split pane, #813) stay independent. Surfaced as `data-group-id`
     * for identification.
     */
    groupId: string;
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
    /** Position-bearing bookmarks for the current file. The editor renders
     *  a filled-ribbon flag in the gutter on each resolved line (#756). */
    bookmarks?: readonly BookmarkRef[];
    onNavigate?: (target: string) => void;
    /** Click on a `[[cite::source-id]]` in the editor → open the source tab. */
    onOpenSource?: (sourceId: string) => void;
    /** Click on a `[[quote::excerpt-id]]` in the editor → open the source tab with excerpt highlighted. */
    onOpenExcerpt?: (excerptId: string) => void;
    /**
     * The host actions the right-click context menu fans out to, grouped into
     * one object (#1625). Replaces the ~20 one-shot `on*` forwarder props the
     * menu used to take. Every entry is optional — the menu shows an item only
     * when its op is supplied. Forwarded straight to `EditorContextMenu`.
     */
    menuOps?: EditorMenuOps;
    /** Live list of note paths for wiki-link autocomplete. */
    getNotePaths?: () => string[];
    /** Live list of Sources for `[[cite::…]]` autocomplete. */
    getSources?: () => readonly import('../../../shared/types').SourceMetadata[];
    /** Live list of frontmatter alias entries so wiki-link autocomplete
     *  can suggest aliases alongside note paths (#492). */
    getAliases?: () => readonly { alias: string; relativePath: string }[];
    /** Alt-Enter quick-fix "Create Note From Reference" (#1446 Phase 2): the
     *  raw wiki-link target under the cursor. The host creates the note beside
     *  this one (via note-ops) and opens it. */
    onCreateNoteFromReference?: (target: string) => void;
    /** Inline `/book` typed-creation (#1065): given the picked type, prompt for
     *  a title, create (or link an existing) typed note, and return the
     *  wiki-link target — or null if cancelled. Wired by the host to note-ops. */
    resolveInlineTypeCreate?: (type: TypeInfo) => Promise<string | null>;
    /**
     * Callback for image upload rejections — too-large, unsupported
     * MIME, etc. — so the host app can surface a toast / dialog (#455).
     * Errors that aren't user-facing (write-failed mid-stream) also
     * route through here.
     */
    onUploadError?: (message: string) => void;
    /**
     * Plain-text mode (#1130): a non-markdown text file. Turns OFF the
     * markdown-specific extensions — markdown language + syntax highlight,
     * frontmatter fold, wiki-link/tag autocomplete + decorations, compute
     * cells, footnote/highlight decorations, format-on-paste, image-paste
     * upload — leaving a plain editable/saveable code buffer. Default false
     * keeps every markdown caller unchanged.
     */
    plainText?: boolean;
    /**
     * Run-cell handler (#373). When supplied, replaces the direct
     * `api.compute.runCell` call. App.svelte injects a trust-gated
     * variant that prompts on first Python execution per thoughtbase.
     * Keeping it pluggable lets headless / test contexts run cells
     * without going through the dialog flow.
     */
    onRunCell?: (
      language: string,
      code: string,
      notePath: string,
    ) => Promise<import('../../../shared/compute/types').CellResult>;
  }

  let {
    groupId,
    filePath,
    content,
    searchQuery = null,
    onContentChange,
    onSave,
    onSearchQueryConsumed,
    onEditorStateSave,
    onCursorChange,
    bookmarks,
    onNavigate,
    onOpenSource,
    onOpenExcerpt,
    menuOps = {},
    getNotePaths,
    getSources,
    getAliases,
    onCreateNoteFromReference,
    resolveInlineTypeCreate,
    initialHistory,
    onUploadError,
    onRunCell,
    plainText = false,
  }: Props = $props();

  // Tools-for-Thought submenus, built to match the native main menu exactly
  // (menu.ts): same categories in the same order (Learning → Research →
  // Analysis), the same #525 thematic sub-grouping, sourced from the same
  // registry (which already reflects the user's menu-config order). Source-
  // scoped tools (#103) belong to the Source viewer, never this menu.
  // Snapshot at mount — matches the previous non-reactive behavior; reopen
  // the editor to pick up menu-config changes.
  const TOOL_MENU_LABELS = { learning: 'Learning', research: 'Research', analysis: 'Analysis' } as const;
  const toolMenus = (['learning', 'research', 'analysis'] as const)
    .map((id) => {
      const tools = getToolInfosByCategory(id).filter((t) => !isSourceScoped(t));
      return { id, label: TOOL_MENU_LABELS[id], tools, groups: groupToolsByGroup(tools) };
    })
    .filter((m) => m.tools.length > 0);

  let editorContainer: HTMLDivElement;
  let view: EditorView;
  // Populated by computeCellsExtension; lets the host trigger Run-all.
  const runAllRef: RunAllRef = { run: null };
  let ignoreNextUpdate = false;
  let contextMenu = $state<EditorContextMenuState | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();
  // Alt-Enter quick-fix popup (#1446 Phase 2): position + the fixes to offer.
  let quickFix = $state<{ x: number; y: number; fixes: QuickFix[] } | null>(null);
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

  export function updateTheme() {
    if (view) {
      view.dispatch({ effects: themeCompartment.reconfigure(cmTheme()) });
    }
  }
  function getFontSize(): number {
    return parseStoredFontSize(localStorage.getItem('editorFontSize'));
  }

  /** Clamp, persist, and reconfigure the editor to `px` — the one place font
   *  size is applied; the exports below are thin wrappers over it. */
  function applyFontSize(px: number): void {
    const next = clampFontSize(px);
    localStorage.setItem('editorFontSize', String(next));
    if (view) {
      view.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeTheme(next)) });
    }
  }

  export function changeFontSize(delta: number) { applyFontSize(getFontSize() + delta); }

  export function resetFontSize() { applyFontSize(DEFAULT_FONT); }

  /** Set the editor font size to an absolute px value (clamped) — the Settings
   *  panel's numeric control. */
  export function setFontSize(px: number) { applyFontSize(px); }

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
        lineNumbersCompartment.reconfigure(settings.lineNumbers ? [] : hiddenLineNumbersTheme()),
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
    return findFrontmatterFoldRange(view.state.doc);
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
    let claimUri: string | null = null;
    if (view) {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      docPos = pos ?? null;
      if (pos != null) link = findLinkAt(view.state, pos);
      const sel = view.state.selection.main;
      hasSelection = sel.from !== sel.to;
      // Resolve a thought:Claim URI from (1) the active selection, then
      // (2) the line under the right-click. Powers Find Supporting /
      // Opposing Arguments — those need a Claim node to link Grounds to.
      const selText = hasSelection ? view.state.sliceDoc(sel.from, sel.to) : '';
      claimUri = extractClaimUri(selText);
      if (!claimUri && pos != null) {
        const line = view.state.doc.lineAt(pos);
        claimUri = extractClaimUri(line.text);
      }
    }
    contextMenu = { x: e.clientX, y: e.clientY, link, hasSelection, docPos, claimUri };
    installDismissOnClickOutside(closeMenu);
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
    installDismissOnClickOutside(() => { gutterMenu = null; });
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

  function adjustSubmenu(event: MouseEvent) {
    clampSubmenu(event.currentTarget as HTMLElement);
  }

  const initSettings = getEditorSettings();

  // `plainText` is fixed for an Editor instance (a tab remounts on a md↔plain
  // switch), so the extensions below read it once at build time. `untrack`
  // expresses that intent and silences the `state_referenced_locally` warning.
  const plainTextOnce = untrack(() => plainText);
  const extensions = [
    basicSetup,
    // Give the `role="textbox"` content DOM an accessible name (#1005 a11y) —
    // CodeMirror's editable div is otherwise unlabeled (axe aria-input-field-name).
    EditorView.contentAttributes.of({ 'aria-label': plainTextOnce ? 'Text editor' : 'Note editor' }),
    // Mark plain-text editors so the drag-to-add-link machinery skips them —
    // a [[wiki-link]] doesn't resolve in a non-markdown file (#1129 / #1130).
    EditorView.editorAttributes.of(plainTextOnce ? { 'data-plaintext': 'true' } : {}),
    // Markdown language + frontmatter fold are markdown-only (#1130). A
    // plain-text file gets a plain editable buffer with no md syntax layer.
    ...(plainTextOnce ? [] : [
      markdown({ codeLanguages: languages }),
      // Pin the frontmatter fold's gutter arrow to line 1 by claiming the
      // foldable range there ourselves. Without this, the markdown
      // language's syntactic fold detection picks line 2 for the YAML
      // body, so toggling the fold makes the arrow jump between lines —
      // and a click-to-collapse from the expanded state leaves line 1 of
      // the YAML visible.
      foldService.of((state, lineStart) => {
        if (lineStart !== 0) return null;
        return findFrontmatterFoldRange(state.doc);
      }),
    ]),
    themeCompartment.of(cmTheme()),
    minervaEditorTheme(),
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
    lineNumbersCompartment.of(initSettings.lineNumbers ? [] : hiddenLineNumbersTheme()),
    whitespaceCompartment.of(initSettings.showWhitespace ? highlightWhitespace() : []),
    // Markdown-only rendering layers (#1130): wiki-link/URL decorations,
    // bookmark gutter, runnable compute cells, footnote + highlight decorations.
    ...(plainTextOnce ? [] : [
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
      bookmarkGutterExtension(),
      computeCellsExtension({
        runCell: (language, code) => (
          onRunCell
            ? onRunCell(language, code, filePath)
            : api.compute.runCell(language, code, filePath)
        ),
        runAllRef,
      }),
      footnotePreview(),
      linkPreview({
        getNotePaths: () => getNotePaths?.() ?? [],
        getAliases: () => getAliases?.() ?? [],
        readNote: (p) => api.notebase.readFile(p),
        // Broken-link hover lightbulb (#1446). Wrapped in a closure (not a bare
        // prop reference) so it stays current in the once-built extension list.
        onCreateNoteFromReference: (target: string) => onCreateNoteFromReference?.(target),
      }),
      brokenLinkDecorations({
        getNotePaths: () => getNotePaths?.() ?? [],
        getAliases: () => getAliases?.() ?? [],
      }),
      footnoteDecorations(),
      highlightDecorations(),
    ]),
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
      // Drag-and-drop image upload (#455). When the dataTransfer
      // carries one or more image files, intercept before CodeMirror's
      // default text-drop handler runs — copy each into
      // `.minerva/assets/inline/` and insert `![](relative-path)` at
      // the drop position. Non-image drops (text, urls, internal CM
      // moves) fall through to the default handler.
      //
      // Both handlers stopPropagation when they take the drop —
      // App.svelte's `.editor-pane` wrapper has its own ondrop that
      // routes to the project-import flow (PDFs, markdown imports).
      // Without stopPropagation an image drop fires both handlers and
      // the import path rejects the JPEG with "doesn't ingest *.jpeg".
      dragover: (e) => {
        if (plainText) return false; // no image-upload / wiki-link drop in plain text
        // Drag-to-add-link from an HTML5 source (file tree, bookmarks) — accept
        // the drop so `drop` fires (#1129).
        if (e.dataTransfer && dataTransferHasItem(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          return true;
        }
        if (e.dataTransfer && hasImageFiles(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          return true;
        }
        return false;
      },
      drop: (e, v) => {
        if (plainText) return false;
        // Internal item → insert a resolving wiki-link at the drop point (#1129).
        const item = e.dataTransfer && draggedItemFromDataTransfer(e.dataTransfer);
        if (item) {
          e.preventDefault();
          e.stopPropagation();
          const dropPos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
          insertWikiLinkAtPos(v, dropPos, wikiLinkForItem(item));
          return true;
        }
        if (!e.dataTransfer || !hasImageFiles(e.dataTransfer)) return false;
        e.preventDefault();
        e.stopPropagation();
        const dropPos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
        void handleImageUploads(imageFilesFromTransfer(e.dataTransfer), dropPos);
        return true;
      },
      // Paste-image upload (#455). Catches the macOS Cmd+Shift+Ctrl+4
      // → Cmd+V workflow and any other clipboard image source. Non-
      // image clipboard contents (text / html) fall through.
      paste: (e, v) => {
        if (plainText) return false; // native paste — no image upload, no markdown reformat
        const items = e.clipboardData?.items;
        if (items) {
          const files = imageFilesFromClipboard(items);
          if (files.length > 0) {
            e.preventDefault();
            void handleImageUploads(files, v.state.selection.main.head);
            return true;
          }
        }
        // Format-on-paste (#160): tidy the pasted text with the user's
        // enabled paste-safe formatter rules + the always-on paste fixups.
        const text = e.clipboardData?.getData('text/plain') ?? '';
        if (!text) return false;
        const pos = v.state.selection.main.from;
        // Never reformat content pasted into a code fence / math / inline
        // code — let the native paste insert it verbatim.
        if (buildParseCache(v.state.doc.toString()).isProtected(pos)) return false;
        const line = v.state.doc.lineAt(pos);
        const lineBeforeCursor = line.text.slice(0, pos - line.from);
        const out = formatPaste(text, getFormatSettings(), {
          lineBeforeCursor,
          inBlockquote: /^\s*>/.test(line.text),
        });
        if (out === text) return false; // unchanged → native paste
        e.preventDefault();
        v.dispatch(v.state.replaceSelection(out));
        return true;
      },
    }),
  ];

  /**
   * Run the image-upload pipeline for each file, accumulate the
   * resulting `![](…)` snippets, and insert them at the requested
   * editor position in one transaction so undo collapses the whole
   * batch into a single step.
   */
  async function handleImageUploads(files: File[], insertPos: number): Promise<void> {
    if (!view || files.length === 0) return;
    const snippets: string[] = [];
    for (const file of files) {
      const result: UploadResult = await uploadImage(file, { filename: file.name, mimeHint: file.type });
      if (!result.ok) {
        onUploadError?.(rejectionMessage(result));
        continue;
      }
      const rel = relativeAssetPathForNote(filePath, result.relativePath);
      const alt = (result.alt ?? '').replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');
      snippets.push(`![${alt}](${rel})`);
    }
    if (snippets.length === 0) return;
    // Surround with newlines when the drop target isn't at the start
    // of a line — most usefully, matches what a paste of a screenshot
    // mid-paragraph produces in Obsidian / Bear / Notion.
    const insert = '\n' + snippets.join('\n') + '\n';
    view.dispatch({
      changes: { from: insertPos, to: insertPos, insert },
      selection: { anchor: insertPos + insert.length },
    });
  }

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

  /**
   * Re-run every runnable code fence in the note, top to bottom
   * (the "Recompute all" toolbar action). Sequential, halts on the
   * first error — see `runAll` in compute-cells.ts.
   */
  export async function runAllCells(): Promise<void> {
    if (!view || !runAllRef.run) return;
    await runAllRef.run(view);
  }

  export function getSelectionRange(): { from: number; to: number } | null {
    if (!view) return null;
    const main = view.state.selection.main;
    if (main.from === main.to) return null;
    return { from: main.from, to: main.to };
  }

  /** Selected text (empty string if no selection). Used by the
   *  snippet flow (#475) so a `{{selection}}` placeholder picks up
   *  whatever the user had highlighted at the trigger moment. */
  export function getSelectedText(): string {
    if (!view) return '';
    const main = view.state.selection.main;
    if (main.from === main.to) return '';
    return view.state.doc.sliceString(main.from, main.to);
  }

  /**
   * Replace the current selection (or insert at the caret if there
   * is no selection) with `text`. If `caretWithin` is non-null, the
   * cursor lands at that offset inside the inserted text — used by
   * the snippet flow to honour a `{{cursor}}` marker. Returns true
   * if an edit was applied.
   */
  export function insertText(text: string, caretWithin: number | null = null): boolean {
    if (!view) return false;
    const main = view.state.selection.main;
    const insertPos = main.from;
    const finalCaret = caretWithin !== null
      ? insertPos + caretWithin
      : insertPos + text.length;
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: text },
      selection: { anchor: finalCaret },
    });
    view.focus();
    return true;
  }

  /**
   * Resolve a thought:Claim URI from the active selection, then the
   * line under the cursor. Returns null when nothing matches. Used by
   * Find Supporting / Opposing Arguments to identify their target.
   *
   * Prefers the right-click context (savedSelection / contextMenu) when
   * one is open, since the menu may have moved focus off the editor by
   * the time the App handler runs.
   */
  export function getClaimUriAtCursor(): string | null {
    if (!view) return null;
    if (contextMenu?.claimUri) return contextMenu.claimUri;
    const sel = view.state.selection.main;
    if (sel.from !== sel.to) {
      const hit = extractClaimUri(view.state.sliceDoc(sel.from, sel.to));
      if (hit) return hit;
    }
    const line = view.state.doc.lineAt(sel.head);
    return extractClaimUri(line.text);
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

  /** Alt-Enter quick-fix (#1446 Phase 2). When the cursor sits on a broken note
   *  wiki-link and the host wired a create-note handler, open the quick-fix menu
   *  at the cursor with "Create Note From Reference". Returns false otherwise so
   *  Alt-Enter falls through. */
  function openQuickFix(v: EditorView): boolean {
    if (!onCreateNoteFromReference) return false;
    const pos = v.state.selection.main.head;
    const link = brokenNoteLinkAt(v.state, pos, {
      getNotePaths: () => getNotePaths?.() ?? [],
      getAliases: () => getAliases?.() ?? [],
    });
    if (!link) return false;
    const coords = v.coordsAtPos(pos);
    if (!coords) return false;
    const target = link.href;
    quickFix = {
      x: coords.left,
      y: coords.bottom + 2,
      fixes: [{
        label: 'Create Note From Reference',
        apply: () => onCreateNoteFromReference?.(target),
      }],
    };
    return true;
  }

  onMount(() => {
    const resolved = resolveKeyBindings();
    const appKeymap = Prec.highest(keymap.of([
      { key: 'Mod-s', run: () => { onSave(); return true; } },
      { key: 'Alt-Enter', run: openQuickFix },
      // Tab accepts the active completion; acceptCompletion returns false
      // when no completion panel is open, so Tab-for-indent still works
      // everywhere else.
      { key: 'Tab', run: acceptCompletion },
      // Enter accepts the active completion and eats the half-typed word tail
      // (#206) — only word chars, so `[[No|te]]` → `[[Notebook]]` keeps its
      // brackets. Returns false with no popup open, so Enter stays a newline /
      // list-continuation. completionKeymapNoEnter restores arrow-nav and
      // Escape that defaultKeymap:false (below) removes.
      { key: 'Enter', run: acceptCompletionEatTail },
      ...completionKeymapNoEnter,
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
      getAliases: () => getAliases?.() ?? [],
      readNote: (p) => api.notebase.readFile(p),
    });

    // Inline `/book` typed creation (#1065). The apply removes the `/partial`,
    // then the host prompt+create runs async and its target is linked at the
    // same spot — type, template, and link in one gesture.
    const typeCreateCompletion = typeCreateCompletionSource({
      loadTypes: () => api.types.list().then((c) => c.types),
      onPick: (type, view, from, to) => {
        view.dispatch({ changes: { from, to, insert: '' } });
        void resolveInlineTypeCreate?.(type).then((target) => {
          if (!target || !view.dom.isConnected) return;
          const link = `[[${target}]]`;
          const at = Math.min(from, view.state.doc.length);
          view.dispatch({ changes: { from: at, insert: link }, selection: { anchor: at + link.length } });
        });
      },
    });

    const completion = autocompletion({
      override: [tagCompletion, linkCompletion, typeCreateCompletion],
      activateOnTyping: true,
      closeOnBlur: true,
      // Our Enter binding (acceptCompletionEatTail) owns accept-on-Enter; the
      // built-in one would win the tie otherwise (#206).
      defaultKeymap: false,
    });

    // Wiki-link / tag autocomplete is markdown-only (#1130).
    const allExtensions = [...extensions, appKeymap, updateListener, ...(plainText ? [] : [completion])];

    // When the caller passes a history snapshot AND its serialised doc
    // still matches the current content, restore the undo/redo stacks
    // into the fresh view. If the content has drifted (file reloaded from
    // disk, programmatic rewrite, etc.) we fall back to a clean state —
    // undoing to a document that no longer matches reality is worse than
    // losing history.
    const snapshot = toHistorySnapshot(initialHistory);
    const canRestore = canRestoreHistory(snapshot, content);
    const state = canRestore
      ? EditorState.fromJSON(
          snapshot,
          { extensions: allExtensions },
          { history: historyField },
        )
      : EditorState.create({ doc: content, extensions: allExtensions });
    view = new EditorView({ state, parent: editorContainer });

    // Initial bookmark flags — the reactive $effect below only fires on
    // subsequent changes (view isn't $state, so it can't re-run on mount).
    applyBookmarkOffsets(view, resolveBookmarkOffsets(content, bookmarks ?? []));

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

  // Push bookmark gutter flags whenever the file's bookmarks change. Keyed
  // on `filePath` too so a tab-switch (same Editor instance isn't reused —
  // the `{#key}` recreates it — but guard anyway) re-resolves cleanly.
  // Resolved against the live doc; the field maps offsets forward on edits,
  // so we deliberately don't depend on `content` (no per-keystroke churn).
  $effect(() => {
    const refs = bookmarks ?? [];
    void filePath;
    if (!view) return;
    applyBookmarkOffsets(view, resolveBookmarkOffsets(view.state.doc.toString(), refs));
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
<div class="editor-wrapper" data-group-id={groupId} bind:this={editorContainer} oncontextmenu={handleWrapperContextMenu}></div>

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
  <EditorContextMenu
    menu={contextMenu}
    bind:menuEl={contextMenuEl}
    {filePath}
    {toolMenus}
    ops={menuOps}
    onExec={execCommand}
    onRunCmd={runCmd}
    onCopyBlockLink={copyBlockLink}
    onOpenLink={openLink}
    onEditLink={editLink}
    onAdjustSubmenu={adjustSubmenu}
    onMenuAction={handleMenuAction}
    onClose={closeMenu}
    onDictate={() => void toggleEditorDictation(view)}
  />
{/if}

{#if quickFix}
  <QuickFixMenu
    x={quickFix.x}
    y={quickFix.y}
    fixes={quickFix.fixes}
    onClose={() => { quickFix = null; view?.focus(); }}
  />
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

  /* Bookmark-flag gutter (#756). Kept in sync with `bookmarkGutterStyles`
     in src/renderer/lib/editor/bookmark-gutter.ts — inlined for the same
     scoped-CSS :global() reason as the compute gutter above. min-width 0
     lets the column collapse on notes with no bookmarks. */
  .editor-wrapper :global(.cm-bookmark-gutter) { min-width: 0; }
  .editor-wrapper :global(.cm-bookmark-flag) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    color: var(--accent);
    line-height: 1;
  }

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

  /* The gutter menu (right-click in the line-number gutter) reuses the
     `.context-menu` base above; its own tweaks stay here. The submenu /
     separator / typed-link-dot styles moved to EditorContextMenu.svelte
     along with the menu markup (#1625). */
  .gutter-menu { min-width: 180px; }
  .gutter-menu button { display: flex; align-items: center; gap: 8px; }
  .gutter-menu .check { width: 12px; text-align: center; color: var(--accent); }
</style>
