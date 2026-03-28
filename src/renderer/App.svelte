<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Editor from './lib/components/Editor.svelte';
  import Preview from './lib/components/Preview.svelte';
  import { getNotebaseStore } from './lib/stores/notebase.svelte';
  import { getEditorStore } from './lib/stores/editor.svelte';

  type ViewMode = 'source' | 'preview' | 'split';

  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  let viewMode = $state<ViewMode>('source');

  async function handleFileSelect(relativePath: string) {
    await editor.openFile(relativePath);
  }

  function handleNavigate(target: string) {
    const path = target.endsWith('.md') ? target : `${target}.md`;
    editor.openFile(path);
  }

  function cycleViewMode() {
    if (viewMode === 'source') viewMode = 'preview';
    else if (viewMode === 'preview') viewMode = 'split';
    else viewMode = 'source';
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
      e.preventDefault();
      cycleViewMode();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

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
          <div class="toolbar">
            <div class="view-toggle">
              <button
                class:active={viewMode === 'source'}
                onclick={() => viewMode = 'source'}
                title="Source (Cmd+Shift+P to cycle)"
              >Source</button>
              <button
                class:active={viewMode === 'split'}
                onclick={() => viewMode = 'split'}
                title="Split view"
              >Split</button>
              <button
                class:active={viewMode === 'preview'}
                onclick={() => viewMode = 'preview'}
                title="Preview"
              >Preview</button>
            </div>
          </div>
          <div class="editor-content" class:split={viewMode === 'split'}>
            {#if viewMode === 'source' || viewMode === 'split'}
              <div class="editor-panel">
                <Editor
                  content={editor.content}
                  onContentChange={editor.setContent}
                  onSave={editor.save}
                />
              </div>
            {/if}
            {#if viewMode === 'preview' || viewMode === 'split'}
              <div class="preview-panel">
                <Preview
                  content={editor.content}
                  onNavigate={handleNavigate}
                />
              </div>
            {/if}
          </div>
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
    flex-direction: column;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 8px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .view-toggle {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .view-toggle button {
    padding: 3px 12px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    border-right: 1px solid var(--border);
  }

  .view-toggle button:last-child {
    border-right: none;
  }

  .view-toggle button.active {
    background: var(--bg-button-hover);
    color: var(--text);
  }

  .view-toggle button:hover:not(.active) {
    background: var(--bg-button);
  }

  .editor-content {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-content.split {
    gap: 1px;
    background: var(--border);
  }

  .editor-panel {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .preview-panel {
    flex: 1;
    display: flex;
    overflow: hidden;
    background: var(--bg);
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
