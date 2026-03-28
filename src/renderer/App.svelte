<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Editor from './lib/components/Editor.svelte';
  import { getNotebaseStore } from './lib/stores/notebase.svelte';
  import { getEditorStore } from './lib/stores/editor.svelte';

  const notebase = getNotebaseStore();
  const editor = getEditorStore();

  async function handleFileSelect(relativePath: string) {
    await editor.openFile(relativePath);
  }
</script>

<div class="app">
  <TitleBar
    notebaseName={notebase.meta?.name ?? ''}
    fileName={editor.activeFileName}
    isDirty={editor.isDirty}
  />

  <div class="main">
    {#if notebase.meta}
      <Sidebar
        files={notebase.files}
        activeFilePath={editor.activeFilePath}
        onFileSelect={handleFileSelect}
        onOpenFolder={notebase.open}
      />
      <div class="editor-pane">
        {#if editor.activeFilePath}
          <Editor
            content={editor.content}
            onContentChange={editor.setContent}
            onSave={editor.save}
          />
        {:else}
          <div class="no-file">
            <p>Select a note from the sidebar</p>
          </div>
        {/if}
      </div>
    {:else}
      <div class="welcome">
        <h1>ide for thought</h1>
        <p>An experimental IDE for AI-assisted human thought.</p>
        <button onclick={notebase.open}>Open Folder</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .editor-pane {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .no-file {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .no-file p {
    color: var(--text-muted);
    font-size: 14px;
  }

  .welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .welcome h1 {
    font-size: 28px;
    font-weight: 300;
    color: var(--text);
  }

  .welcome p {
    color: var(--text-muted);
    font-size: 14px;
  }

  .welcome button {
    -webkit-app-region: no-drag;
    padding: 10px 24px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .welcome button:hover {
    background: var(--bg-button-hover);
  }
</style>
