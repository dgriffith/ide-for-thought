<script lang="ts">
  interface Props {
    notebaseName: string;
    fileName: string;
    isDirty: boolean;
  }

  let { notebaseName, fileName, isDirty }: Props = $props();
</script>

<div class="titlebar">
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
  }

  .titlebar-text {
    font-size: 12px;
    color: var(--text-muted);
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
