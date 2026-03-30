<script lang="ts">
  import type { OutgoingLink } from '../../../../shared/types';
  import { api } from '../../ipc/client';
  import LinkBadge from './LinkBadge.svelte';

  interface Props {
    activeFilePath: string | null;
    revision: number;
    onFileSelect: (relativePath: string) => void;
  }

  let { activeFilePath, revision, onFileSelect }: Props = $props();
  let links = $state<OutgoingLink[]>([]);

  $effect(() => {
    // Track both activeFilePath and revision to refresh after saves
    const _ = revision;
    if (activeFilePath) {
      api.links.outgoing(activeFilePath).then((r) => { links = r; });
    } else {
      links = [];
    }
  });

  // Group by link type
  let grouped = $derived(() => {
    const map = new Map<string, OutgoingLink[]>();
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
    <div class="empty">No outgoing links</div>
  {:else}
    <div class="link-count">{links.length} outgoing link{links.length !== 1 ? 's' : ''}</div>
    {#each [...grouped()] as [type, typeLinks]}
      <div class="type-group">
        <div class="type-header" style:color={typeLinks[0].linkColor}>
          {typeLinks[0].linkLabel} ({typeLinks.length})
        </div>
        {#each typeLinks as link}
          <button
            class="link-item"
            class:dead={!link.exists}
            onclick={() => link.exists && onFileSelect(link.target)}
            title={link.target}
          >
            <LinkBadge label={link.linkLabel} color={link.linkColor} />
            <span class="link-title">{link.targetTitle}</span>
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

  .link-item.dead {
    opacity: 0.4;
    cursor: default;
    font-style: italic;
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
