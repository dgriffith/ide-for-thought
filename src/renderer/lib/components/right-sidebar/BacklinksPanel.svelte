<script lang="ts">
  import type { Backlink } from '../../../../shared/types';
  import { api } from '../../ipc/client';
  import LinkBadge from './LinkBadge.svelte';

  interface Props {
    activeFilePath: string | null;
    revision: number;
    onFileSelect: (relativePath: string) => void;
  }

  let { activeFilePath, revision, onFileSelect }: Props = $props();
  let links = $state<Backlink[]>([]);

  $effect(() => {
    const _ = revision;
    if (activeFilePath) {
      api.links.backlinks(activeFilePath).then((r) => { links = r; });
    } else {
      links = [];
    }
  });

  let grouped = $derived(() => {
    const map = new Map<string, Backlink[]>();
    for (const link of links) {
      const list = map.get(link.linkType) ?? [];
      list.push(link);
      map.set(link.linkType, list);
    }
    return map;
  });
</script>

<div class="links-panel">
  {#if links.length === 0}
    <div class="empty">No backlinks found</div>
  {:else}
    <div class="link-count">{links.length} linked mention{links.length !== 1 ? 's' : ''}</div>
    {#each [...grouped()] as [type, typeLinks]}
      <div class="type-group">
        <div class="type-header" style:color={typeLinks[0].linkColor}>
          {typeLinks[0].linkLabel} ({typeLinks.length})
        </div>
        {#each typeLinks as link}
          <button
            class="link-item"
            onclick={() => onFileSelect(link.source)}
            title={link.source}
          >
            <LinkBadge label={link.linkLabel} color={link.linkColor} />
            <span class="link-title">{link.sourceTitle}</span>
          </button>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<style>
  .links-panel {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .link-count {
    padding: 4px 12px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .type-group {
    margin-bottom: 4px;
  }

  .type-header {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
  }

  .link-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 12px 3px 20px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .link-item:hover {
    background: var(--bg-button);
  }

  .link-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
