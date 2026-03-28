<script lang="ts">
  import type { NoteFile } from '../../../shared/types';

  interface Props {
    files: NoteFile[];
    activeFilePath: string | null;
    depth?: number;
    onFileSelect: (relativePath: string) => void;
  }

  let { files, activeFilePath, depth = 0, onFileSelect }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});

  function toggleDir(path: string) {
    expanded[path] = !expanded[path];
  }
</script>

<ul class="file-tree" style:--depth={depth}>
  {#each files as file}
    <li>
      {#if file.isDirectory}
        <button
          class="tree-item dir"
          style:padding-left="{depth * 16 + 8}px"
          onclick={() => toggleDir(file.relativePath)}
        >
          <span class="icon">{expanded[file.relativePath] ? '▾' : '▸'}</span>
          {file.name}
        </button>
        {#if expanded[file.relativePath] && file.children}
          <svelte:self
            files={file.children}
            {activeFilePath}
            depth={depth + 1}
            {onFileSelect}
          />
        {/if}
      {:else}
        <button
          class="tree-item file"
          class:active={activeFilePath === file.relativePath}
          style:padding-left="{depth * 16 + 8}px"
          onclick={() => onFileSelect(file.relativePath)}
        >
          <span class="icon">📄</span>
          {file.name.replace(/\.md$/, '')}
        </button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .file-tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    margin: 0;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    border-radius: 4px;
  }

  .tree-item:hover {
    background: var(--bg-button);
  }

  .tree-item.active {
    background: var(--bg-button-hover);
    color: var(--accent);
  }

  .icon {
    font-size: 11px;
    width: 14px;
    flex-shrink: 0;
    text-align: center;
  }

  .dir .icon {
    font-size: 12px;
  }
</style>
