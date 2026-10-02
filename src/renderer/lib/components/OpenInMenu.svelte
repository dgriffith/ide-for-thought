<script lang="ts">
  /**
   * "Open In ▸" for a Notes-tree item, a folder, or the thoughtbase itself —
   * shared by FileTree's item menu and the root menu in Sidebar. `path`
   * undefined means the root: the shell handlers read a missing path as the
   * thoughtbase folder. Stateless OS side-effects, so `api.shell.*` is called
   * directly (CLAUDE.md, *Renderer data flow*).
   */
  import Icon from './Icon.svelte';
  import { api } from '../ipc/client';

  interface Props {
    /** Project-relative path; undefined for the thoughtbase root. */
    path?: string | undefined;
    /** Close the context menu once an action runs. */
    onDone: () => void;
  }
  let { path, onDone }: Props = $props();
</script>

<div class="submenu-item">
  <span class="submenu-trigger" tabindex="0" role="button" aria-haspopup="menu">Open In <Icon name="chevronRight" size={10} /></span>
  <div class="submenu" role="menu" aria-label="Open in">
    <button role="menuitem" onclick={() => { void api.shell.revealFile(path); onDone(); }}>Reveal in Finder</button>
    <button role="menuitem" onclick={() => { void api.shell.openInDefault(path ?? ''); onDone(); }}>Open in Default App</button>
    <button role="menuitem" onclick={() => { void api.shell.openInTerminal(path); onDone(); }}>Open in Terminal</button>
  </div>
</div>

<style>
  /* Matches the context menus' own submenu styling (their rules are scoped). */
  .submenu-item { position: relative; }
  .submenu-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; font-size: 12px; color: var(--text); cursor: default; }
  .submenu-trigger:hover, .submenu-trigger:focus-visible { background: var(--bg-button); outline: none; }
  .submenu { display: none; position: absolute; left: 100%; top: 0; background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 6px; padding: 4px 0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); min-width: 160px; }
  .submenu-item:hover .submenu, .submenu-item:focus-within .submenu { display: block; }
  .submenu button { display: flex; align-items: center; width: 100%; padding: 6px 12px; border: none; background: none; color: var(--text); font-size: 12px; text-align: left; cursor: pointer; white-space: nowrap; }
  .submenu button:hover, .submenu button:focus-visible { background: var(--bg-button); outline: none; }
</style>
