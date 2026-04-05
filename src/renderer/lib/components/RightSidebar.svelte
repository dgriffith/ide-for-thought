<script lang="ts">
  import OutlinePanel from './right-sidebar/OutlinePanel.svelte';
  import OutgoingLinksPanel from './right-sidebar/OutgoingLinksPanel.svelte';
  import BacklinksPanel from './right-sidebar/BacklinksPanel.svelte';
  import TagsPanel from './right-sidebar/TagsPanel.svelte';
  import BookmarksPanel from './right-sidebar/BookmarksPanel.svelte';
  import ProposalsPanel from './right-sidebar/ProposalsPanel.svelte';

  type PanelType = 'outline' | 'outgoing' | 'backlinks' | 'tags' | 'bookmarks' | 'proposals';

  interface Props {
    activeFilePath: string | null;
    content: string;
    onFileSelect: (relativePath: string) => void;
    onScrollToLine: (line: number) => void;
    onShowPrompt: (message: string) => Promise<string | null>;
  }

  let { activeFilePath, content, onFileSelect, onScrollToLine, onShowPrompt }: Props = $props();

  let activePanel = $state<PanelType>('outline');
  let revision = $state(0);

  export function refresh() {
    revision++;
  }
</script>

<aside class="right-sidebar">
  <div class="panel-tabs">
    <button
      class="panel-tab"
      class:active={activePanel === 'outline'}
      onclick={() => activePanel = 'outline'}
      title="Outline"
    >&#x2630;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'outgoing'}
      onclick={() => activePanel = 'outgoing'}
      title="Outgoing Links"
    >&#x2192;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'backlinks'}
      onclick={() => activePanel = 'backlinks'}
      title="Backlinks"
    >&#x2190;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'tags'}
      onclick={() => activePanel = 'tags'}
      title="Tags"
    >#</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'bookmarks'}
      onclick={() => activePanel = 'bookmarks'}
      title="Bookmarks"
    >&#x2606;</button>
    <button
      class="panel-tab"
      class:active={activePanel === 'proposals'}
      onclick={() => activePanel = 'proposals'}
      title="Proposals"
    >&#x2713;</button>
  </div>

  <div class="panel-content">
    {#if activePanel === 'outline'}
      <OutlinePanel {content} {onScrollToLine} />
    {:else if activePanel === 'outgoing'}
      <OutgoingLinksPanel {activeFilePath} {revision} {onFileSelect} />
    {:else if activePanel === 'backlinks'}
      <BacklinksPanel {activeFilePath} {revision} {onFileSelect} />
    {:else if activePanel === 'tags'}
      <TagsPanel {content} {onFileSelect} />
    {:else if activePanel === 'bookmarks'}
      <BookmarksPanel {onFileSelect} {onShowPrompt} />
    {:else if activePanel === 'proposals'}
      <ProposalsPanel {revision} />
    {/if}
  </div>
</aside>

<style>
  .right-sidebar {
    width: 250px;
    min-width: 180px;
    background: var(--bg-sidebar);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-tabs {
    display: flex;
    justify-content: center;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .panel-tab {
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
  }

  .panel-tab:hover {
    background: var(--bg-button);
  }

  .panel-tab.active {
    background: var(--bg-button-hover);
    color: var(--text);
  }

  .panel-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
