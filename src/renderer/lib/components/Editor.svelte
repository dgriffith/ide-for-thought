<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';

  interface Props {
    content: string;
    onContentChange: (text: string) => void;
    onSave: () => void;
  }

  let { content, onContentChange, onSave }: Props = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView;
  let ignoreNextUpdate = false;

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

    view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          markdown({ codeLanguages: languages }),
          oneDark,
          saveKeymap,
          updateListener,
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
