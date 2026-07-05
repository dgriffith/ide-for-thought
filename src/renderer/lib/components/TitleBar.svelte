<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    notebaseName: string;
    /** Project-relative path of the active file (e.g.
     *  `essays/on-the-trust-principle.md`). The breadcrumb chain is
     *  derived from the path segments — folder · folder · italic note
     *  title — so the title bar reads as a real location, not just a
     *  filename. `null` when no file is open. */
    filePath: string | null;
    isDirty: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    onNavBack: () => void;
    onNavForward: () => void;
    /** Opens the Quick Open palette — fuzzy match across notes,
     *  sources, and saved queries. Bound to Cmd+P (matches the
     *  Navigate › Quick Open menu entry). */
    onOpenGotoNote: () => void;
    /** Opens Settings. Triggered by the cog button at the far right. */
    onOpenSettings: () => void;
  }

  let {
    notebaseName, filePath, isDirty,
    canGoBack, canGoForward,
    onNavBack, onNavForward,
    onOpenGotoNote, onOpenSettings,
  }: Props = $props();

  /** Split the active file's path into folder segments and a leaf.
   *  The leaf renders in italic display-serif; the folders in muted
   *  sans. Strips the `.md`/`.ttl`/`.csv` extension off the leaf so
   *  the title bar shows the human title, not the file name. */
  const segments = $derived.by(() => {
    if (!filePath) return null;
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const leaf = parts[parts.length - 1]!.replace(/\.(md|ttl|csv)$/, '');
    return { folders: parts.slice(0, -1), leaf };
  });
</script>

<div class="titlebar">
  <div class="nav-arrows">
    <button
      class="nav-btn"
      disabled={!canGoBack}
      onclick={onNavBack}
      title="Back (Cmd+[)"
    ><Icon name="back" size={15} /></button>
    <button
      class="nav-btn"
      disabled={!canGoForward}
      onclick={onNavForward}
      title="Forward (Cmd+])"
    ><Icon name="forward" size={15} /></button>
  </div>

  <span class="nav-divider" aria-hidden="true"></span>

  <div class="breadcrumb">
    <span class="brand"><Icon name="minervaMark" size={14} color="var(--accent)" /></span>
    {#if notebaseName}
      <span class="crumb">{notebaseName}</span>
    {/if}
    {#if segments}
      {#each segments.folders as folder}
        <span class="chev" aria-hidden="true">›</span>
        <span class="crumb">{folder}</span>
      {/each}
      <span class="chev" aria-hidden="true">›</span>
      <span class="leaf">{segments.leaf}</span>
      {#if isDirty}<span class="dirty" title="Unsaved changes">•</span>{/if}
    {/if}
  </div>

  <div class="right-cluster">
    <button class="search-box" onclick={onOpenGotoNote} title="Quick Open (Cmd+P) — fuzzy-match notes, sources, queries">
      <Icon name="search" size={13} color="var(--text-muted)" />
      <span class="search-placeholder">Quick Open…</span>
      <span class="search-kbd">⌘ P</span>
    </button>
    <button class="icon-btn" onclick={onOpenSettings} title="Settings">
      <Icon name="settings" size={15} color="var(--text-muted)" />
    </button>
  </div>
</div>

<style>
  .titlebar {
    -webkit-app-region: drag;
    height: 42px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    padding-left: 80px;
    padding-right: 14px;
    position: relative;
  }

  /* Nav cluster — back/forward arrows */
  .nav-arrows {
    -webkit-app-region: no-drag;
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .nav-btn {
    -webkit-app-region: no-drag;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--titlebar-text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .nav-btn:hover:not(:disabled) {
    background: color-mix(in oklch, var(--text) 8%, transparent);
    color: var(--titlebar-text);
  }
  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .nav-divider {
    width: 1px;
    height: 18px;
    background: var(--border);
    flex-shrink: 0;
  }

  /* Breadcrumb chain — mark · folder · folder · italic title · dirty-dot */
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--titlebar-text);
    min-width: 0;
    overflow: hidden;
    user-select: none;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  .crumb {
    color: var(--titlebar-text-muted);
    font-family: var(--font-sans);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev {
    color: var(--text-faint);
    font-size: 11px;
    flex-shrink: 0;
  }
  .leaf {
    color: var(--titlebar-text);
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .dirty {
    color: var(--accent);
    font-size: 16px;
    line-height: 1;
    flex-shrink: 0;
  }

  /* Right cluster — search affordance + settings cog */
  .right-cluster {
    -webkit-app-region: no-drag;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .search-box {
    -webkit-app-region: no-drag;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    cursor: text;
    font-family: var(--font-sans);
  }
  .search-box:hover {
    border-color: var(--border-strong);
  }
  .search-placeholder {
    color: var(--text-muted);
    font-size: 12px;
  }
  .search-kbd {
    margin-left: 16px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .icon-btn {
    -webkit-app-region: no-drag;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--titlebar-text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover {
    background: color-mix(in oklch, var(--text) 8%, transparent);
    color: var(--titlebar-text);
  }
</style>
