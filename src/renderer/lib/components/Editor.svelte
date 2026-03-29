<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { search, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
  import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
  import { api } from '../ipc/client';

  interface Props {
    content: string;
    searchQuery?: string | null;
    onContentChange: (text: string) => void;
    onSave: () => void;
    onSearchQueryConsumed?: () => void;
  }

  let { content, searchQuery = null, onContentChange, onSave, onSearchQueryConsumed }: Props = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView;
  let ignoreNextUpdate = false;

  async function tagCompletion(context: CompletionContext): Promise<CompletionResult | null> {
    // Match # followed by word characters, triggered at the #
    const match = context.matchBefore(/#[\w-/]*/);
    if (!match) return null;
    // Only trigger if the # is at start of line or preceded by whitespace
    if (match.from > 0) {
      const charBefore = context.state.doc.sliceString(match.from - 1, match.from);
      if (charBefore !== ' ' && charBefore !== '\n' && match.from !== 0) return null;
    }

    const tags = await api.tags.allNames();
    const typed = match.text.slice(1); // remove the #

    return {
      from: match.from,
      options: tags
        .filter((t) => t.toLowerCase().startsWith(typed.toLowerCase()))
        .map((tag) => ({
          label: `#${tag}`,
          type: 'keyword',
          apply: `#${tag}`,
        })),
    };
  }

  onMount(() => {
    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSave();
          return true;
        },
      },
    ]);

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

    view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          markdown({ codeLanguages: languages }),
          oneDark,
          search({
            top: true,
            scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: 'center' }),
          }),
          saveKeymap,
          updateListener,
          tagAutocomplete,
          EditorView.lineWrapping,
        ],
      }),
      parent: editorContainer,
    });

    return () => view.destroy();
  });

  $effect(() => {
    if (view && content !== view.state.doc.toString()) {
      ignoreNextUpdate = true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      });
    }
  });

  $effect(() => {
    if (!view || !searchQuery) return;
    const q = searchQuery;

    // Defer so the content effect has time to dispatch first
    requestAnimationFrame(() => {
      if (!view) return;

      // Set the search query and open the panel
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: q })),
      });
      openSearchPanel(view);

      // Find first match, select it, and scroll centered
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
