<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { EditorState, Prec, Compartment } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { search, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
  import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
  import { api } from '../ipc/client';
  import { toggleCase, joinLines, duplicateLine, sortLines, extendSelection, shrinkSelection, selectionTracker } from '../editor/commands';
  import {
    toggleBold, toggleItalic, toggleCode, toggleStrikethrough,
    toggleH1, toggleH2, toggleH3, toggleQuote, toggleBulletList, toggleNumberedList, toggleTaskList,
    insertTable, insertHorizontalRule, insertFootnote, insertLink, insertImage,
    insertWikiLink, insertTypedLinks,
  } from '../editor/formatting';

  export interface CursorInfo {
    line: number;
    column: number;
    selectionLength: number;
    wordCount: number;
  }

  interface Props {
    content: string;
    searchQuery?: string | null;
    savedEditorState?: unknown;
    savedScrollTop?: number;
    onContentChange: (text: string) => void;
    onSave: () => void;
    onSearchQueryConsumed?: () => void;
    onEditorStateSave?: (stateJSON: unknown, scrollTop: number) => void;
    onCursorChange?: (info: CursorInfo) => void;
  }

  let {
    content,
    searchQuery = null,
    savedEditorState,
    savedScrollTop,
    onContentChange,
    onSave,
    onSearchQueryConsumed,
    onEditorStateSave,
    onCursorChange,
  }: Props = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView;
  let ignoreNextUpdate = false;
  let contextMenu = $state<{ x: number; y: number } | null>(null);

  const fontSizeCompartment = new Compartment();
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

  function showContextMenu(e: MouseEvent) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY };
    const close = () => {
      contextMenu = null;
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  function execCommand(cmd: string) {
    document.execCommand(cmd);
    view?.focus();
    contextMenu = null;
  }

  function runCmd(cmd: (v: EditorView) => boolean) {
    if (view) cmd(view);
    contextMenu = null;
  }

  const extensions = [
    basicSetup,
    markdown({ codeLanguages: languages }),
    oneDark,
    search({
      top: true,
      scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: 'center' }),
    }),
    selectionTracker,
    fontSizeCompartment.of(fontSizeTheme(getFontSize())),
    EditorView.lineWrapping,
    EditorView.domEventHandlers({
      contextmenu: (e) => {
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

  export function gotoOffset(offset: number) {
    if (!view) return;
    const clamped = Math.max(0, Math.min(offset, view.state.doc.length));
    view.dispatch({
      selection: { anchor: clamped },
      effects: EditorView.scrollIntoView(clamped, { y: 'center' }),
    });
    view.focus();
  }

  onMount(() => {
    const appKeymap = Prec.highest(keymap.of([
      { key: 'Mod-s', run: () => { onSave(); return true; } },
      { key: 'Mod-Shift-u', run: toggleCase },
      { key: 'Ctrl-Shift-j', run: joinLines },
      { key: 'Mod-d', run: duplicateLine },
      { key: 'Alt-ArrowUp', run: extendSelection },
      { key: 'Alt-ArrowDown', run: shrinkSelection },
      { key: 'Mod-b', run: toggleBold },
      { key: 'Mod-i', run: toggleItalic },
      { key: 'Mod-e', run: toggleCode },
      { key: 'Mod-Shift-x', run: toggleStrikethrough },
      { key: 'Mod-k', run: insertLink },
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

    const tagAutocomplete = autocompletion({
      override: [tagCompletion],
      activateOnTyping: true,
    });

    const allExtensions = [...extensions, appKeymap, updateListener, tagAutocomplete];

    let state: EditorState;
    try {
      state = savedEditorState
        ? EditorState.fromJSON(savedEditorState as any, { extensions: allExtensions })
        : EditorState.create({ doc: content, extensions: allExtensions });
    } catch {
      // Fallback if state deserialization fails
      state = EditorState.create({ doc: content, extensions: allExtensions });
    }

    view = new EditorView({ state, parent: editorContainer });

    if (savedEditorState && savedScrollTop != null) {
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = savedScrollTop!;
      });
    }

    return () => {
      // Save state before unmount so it can be restored on tab switch
      onEditorStateSave?.(view.state.toJSON(), view.scrollDOM.scrollTop);
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

<div class="editor-wrapper" bind:this={editorContainer}></div>

{#if contextMenu}
  <div
    class="context-menu"
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
  >
    <button onclick={() => execCommand('cut')}>Cut</button>
    <button onclick={() => execCommand('copy')}>Copy</button>
    <button onclick={() => execCommand('paste')}>Paste</button>
    <div class="separator"></div>
    <div class="submenu-item">
      <span class="submenu-trigger">Format &#x25B8;</span>
      <div class="submenu">
        <button onclick={() => runCmd(toggleBold)}>Bold</button>
        <button onclick={() => runCmd(toggleItalic)}>Italic</button>
        <button onclick={() => runCmd(toggleCode)}>Code</button>
        <button onclick={() => runCmd(toggleStrikethrough)}>Strikethrough</button>
      </div>
    </div>
    <div class="submenu-item">
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
    <div class="submenu-item">
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
