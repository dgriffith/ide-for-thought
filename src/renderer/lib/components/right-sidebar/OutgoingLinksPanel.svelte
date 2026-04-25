<script lang="ts">
  import type { OutgoingLink } from '../../../../shared/types';
  import { getLinkBundle } from '../../sidebar-link-bundle';
  import LinkBadge from './LinkBadge.svelte';
  import Ribbon from './Ribbon.svelte';

  interface Props {
    activeFilePath: string | null;
    revision: number;
    onFileSelect: (relativePath: string) => void;
  }

  let { activeFilePath, revision, onFileSelect }: Props = $props();
  let links = $state<OutgoingLink[]>([]);
  let search = $state('');
  let sortId = $state<'type' | 'title'>('type');
  let collapsedGroups = $state<Record<string, boolean>>({});

  $effect(() => {
    if (activeFilePath) {
      // Coalesced fetch (#351) — the sibling BacklinksPanel reads the
      // same bundle, so siblings on a tab switch share one IPC.
      getLinkBundle(activeFilePath, revision).then((b) => { links = b.outgoing; });
    } else {
      links = [];
    }
  });

  const filtered = $derived(() => {
    const q = search.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => l.targetTitle.toLowerCase().includes(q) || l.target.toLowerCase().includes(q));
  });

  // "title" sort flattens into one group — users who want a flat
  // alphabetical list are saying they don't care about the type axis.
  const grouped = $derived((): Map<string, OutgoingLink[]> => {
    const map = new Map<string, OutgoingLink[]>();
    if (sortId === 'title') {
      const flat = [...filtered()].sort((a, b) => a.targetTitle.localeCompare(b.targetTitle));
      map.set('', flat);
      return map;
    }
    for (const link of filtered()) {
      const list = map.get(link.linkType) ?? [];
      list.push(link);
      map.set(link.linkType, list);
    }
    return map;
  });

  function toggleGroup(key: string) {
    collapsedGroups[key] = !collapsedGroups[key];
  }

  function collapseAll() {
    const next: Record<string, boolean> = {};
    for (const key of grouped().keys()) next[key] = true;
    collapsedGroups = next;
  }

  function expandAll() {
    collapsedGroups = {};
  }
</script>

<div class="links-panel">
  <Ribbon
    {search}
    onSearch={(q) => { search = q; }}
    searchPlaceholder="Find link…"
    sortOptions={[
      { id: 'type', label: 'By type' },
      { id: 'title', label: 'Alphabetical' },
    ]}
    {sortId}
    onSort={(id) => { sortId = id as 'type' | 'title'; }}
    onExpandAll={sortId === 'type' ? expandAll : undefined}
    onCollapseAll={sortId === 'type' ? collapseAll : undefined}
  />
  <div class="scroll">
    {#if filtered().length === 0}
      <div class="empty">{links.length === 0 ? 'No outgoing links' : 'No matches'}</div>
    {:else}
      <div class="link-count">{filtered().length} outgoing link{filtered().length !== 1 ? 's' : ''}</div>
      {#each [...grouped()] as [type, typeLinks]}
        <div class="type-group">
          {#if type !== ''}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <div class="type-header" style:color={typeLinks[0].linkColor} onclick={() => toggleGroup(type)}>
              <span class="caret">{collapsedGroups[type] ? '▸' : '▾'}</span>
              {typeLinks[0].linkLabel} ({typeLinks.length})
            </div>
          {/if}
          {#if type === '' || !collapsedGroups[type]}
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
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .links-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .link-count {
    padding: 4px 12px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .type-group { margin-bottom: 4px; }
  .type-header {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .caret { font-size: 10px; color: var(--text-muted); }
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
  .link-item:hover { background: var(--bg-button); }
  .link-item.dead { opacity: 0.4; cursor: default; font-style: italic; }
  .link-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center; }
</style>
