<script lang="ts">
  /**
   * "View Objects ▸" on a folder's context menu (#2532, epic #2530): one entry
   * per object type under the folder (recursively), plus the types those
   * inherit from, each opening that type's view scoped to the folder. Renders
   * nothing for a folder with no objects. Its own component so FileTree's
   * context menu stays a list of actions.
   */
  import Icon from './Icon.svelte';
  import { objectTypesStore } from '../stores/object-types.svelte';
  import { getNotebaseStore } from '../stores/notebase.svelte';
  import { getEditorStore } from '../stores/editor.svelte';
  import { objectTypesInFolder } from '../objects/folder-object-types';
  import { flattenNotePaths } from '../app/text-helpers';

  interface Props {
    /** Project-relative folder; '' for the whole thoughtbase (the root menu). */
    folder: string;
    /** What to call it in the menu's accessible name — the folder path, or
     *  the thoughtbase's name for the root. */
    label?: string | undefined;
    /** Close the context menu once a view is opened. */
    onDone: () => void;
  }
  let { folder, label, onDone }: Props = $props();

  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const folderTypes = $derived(objectTypesInFolder(folder, flattenNotePaths(notebase.files), (p) => objectTypesStore.typeForNote(p), objectTypesStore.types));
</script>

{#if folderTypes.length > 0}
  <div class="submenu-item">
    <span class="submenu-trigger" tabindex="0" role="button" aria-haspopup="menu">View Objects <Icon name="chevronRight" size={10} /></span>
    <div class="submenu" role="menu" aria-label="View objects in {label ?? folder}">
      {#each folderTypes as ft (ft.type.id)}
        <button role="menuitem" onclick={() => { editor.openTypeView(ft.type.id, { folder, layout: 'table' }); onDone(); }}>
          <span class="submenu-label">{ft.type.label}</span><span class="submenu-count">{ft.count}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* Matches FileTree's own submenu (its rules are scoped there). */
  .submenu-item { position: relative; }
  .submenu-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; font-size: 12px; color: var(--text); cursor: default; }
  .submenu-trigger:hover, .submenu-trigger:focus-visible { background: var(--bg-button); outline: none; }
  .submenu { display: none; position: absolute; left: 100%; top: 0; background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 6px; padding: 4px 0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); min-width: 160px; }
  .submenu-item:hover .submenu, .submenu-item:focus-within .submenu { display: block; }
  .submenu button { display: flex; align-items: center; width: 100%; padding: 6px 12px; border: none; background: none; color: var(--text); font-size: 12px; text-align: left; cursor: pointer; }
  .submenu button:hover, .submenu button:focus-visible { background: var(--bg-button); outline: none; }
  .submenu-count { margin-left: auto; padding-left: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
</style>
