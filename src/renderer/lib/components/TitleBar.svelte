<script lang="ts">
  interface Props {
    notebaseName: string;
    fileName: string;
    isDirty: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    onNavBack: () => void;
    onNavForward: () => void;
  }

  let { notebaseName, fileName, isDirty, canGoBack, canGoForward, onNavBack, onNavForward }: Props = $props();
</script>

<div class="titlebar">
  <div class="nav-arrows">
    <button
      class="nav-btn"
      disabled={!canGoBack}
      onclick={onNavBack}
      title="Back (Cmd+[)"
    >&#x2190;</button>
    <button
      class="nav-btn"
      disabled={!canGoForward}
      onclick={onNavForward}
      title="Forward (Cmd+])"
    >&#x2192;</button>
  </div>
  <span class="titlebar-text">
    {#if notebaseName}
      {notebaseName}
      {#if fileName}
        <span class="separator">/</span>
        {fileName}{#if isDirty}<span class="dirty">*</span>{/if}
      {/if}
    {:else}
      Minerva
    {/if}
  </span>
</div>

<style>
  .titlebar {
    -webkit-app-region: drag;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    padding-left: 80px;
    position: relative;
  }

  .nav-arrows {
    -webkit-app-region: no-drag;
    display: flex;
    gap: 2px;
    position: absolute;
    left: 80px;
  }

  .nav-btn {
    padding: 2px 6px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--titlebar-text);
    font-size: 14px;
    cursor: pointer;
    line-height: 1;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--titlebar-button);
  }

  .nav-btn:disabled {
    color: var(--titlebar-text-muted);
    opacity: 0.4;
    cursor: default;
  }

  .titlebar-text {
    font-size: 12px;
    color: var(--titlebar-text-muted);
    user-select: none;
  }

  .separator {
    margin: 0 4px;
    opacity: 0.5;
  }

  .dirty {
    color: var(--accent);
    margin-left: 2px;
  }
</style>
