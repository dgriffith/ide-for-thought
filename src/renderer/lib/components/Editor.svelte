<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { EditorState, Prec } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { search, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
  import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
  import { api } from '../ipc/client';
  import { toggleCase, joinLines, duplicateLine, sortLines } from '../editor/commands';

  interface Props {
    content: string;
    searchQuery?: string | null;
    /** Saved CM state JSON from a previous tab session */
    savedEditorState?: unknown;
    savedScrollTop?: number;
    onContentChange: (text: string) => void;
    onSave: () => void;
    onSearchQueryConsumed?: () => void;
    /** Called on unmount — parent should store the returned state */
    onEditorStateSave?: (stateJSON: unknown, scrollTop: number) => void;
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
  }: Props = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView;
  let ignoreNextUpdate = false;

  const extensions = [
    basicSetup,
    markdown({ codeLanguages: languages }),
    oneDark,
    search({
      top: true,
      scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: 'center' }),
    }),
    EditorView.lineWrapping,
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
    view.focus();
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
    ]));

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !ignoreNextUpdate) {
        onContentChange(update.state.doc.toString());
      }
      ignoreNextUpdate = false;
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
</style>
