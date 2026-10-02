<script lang="ts">
  /**
   * The Notes panel's menu for the thoughtbase root — right-click the root
   * row or the empty space below the tree. It offers the folder actions that
   * make sense for the root (path ''): Paste, New Note/Folder, Copy Path, Open
   * In, View Objects, Label Version, View Local History. It leaves out the ones
   * that would act on every note at once (tags, properties, Format) or on the
   * thoughtbase itself (Rename, Delete). Sidebar positions and dismisses it.
   */
  import OpenInMenu from './OpenInMenu.svelte';
  import FolderViewObjectsMenu from './FolderViewObjectsMenu.svelte';
  import { getNotebaseStore } from '../stores/notebase.svelte';

  interface Props {
    canPaste: boolean;
    onPaste: () => void;
    onNewNote: () => void;
    onNewFolder: () => void;
    onLabelVersion?: (() => void) | undefined;
    onViewHistory?: (() => void) | undefined;
    /** Close the menu after an action. */
    onDone: () => void;
  }
  let { canPaste, onPaste, onNewNote, onNewFolder, onLabelVersion, onViewHistory, onDone }: Props = $props();

  const notebase = getNotebaseStore();
  const run = (fn: () => void) => () => { fn(); onDone(); };
</script>

{#if canPaste}
  <button onclick={run(onPaste)}>Paste</button>
  <div class="separator"></div>
{/if}
<button onclick={run(onNewNote)}>New Note</button>
<button onclick={run(onNewFolder)}>New Folder</button>
{#if notebase.meta}
  {@const meta = notebase.meta}
  <div class="separator"></div>
  <!-- Its relative path is empty, so Copy Path copies where it is on disk. -->
  <button onclick={run(() => { void navigator.clipboard.writeText(meta.rootPath); })}>Copy Path</button>
  <OpenInMenu {onDone} />
  <FolderViewObjectsMenu folder="" label={meta.name} {onDone} />
  {#if onLabelVersion || onViewHistory}
    <div class="separator"></div>
  {/if}
  {#if onLabelVersion}
    <button onclick={run(onLabelVersion)}>Label Version&hellip;</button>
  {/if}
  {#if onViewHistory}
    <button onclick={run(onViewHistory)}>View Local History&hellip;</button>
  {/if}
{/if}

<style>
  button {
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
  button:hover { background: var(--bg-button); }
  .separator { height: 1px; background: var(--border); margin: 4px 0; }
</style>
