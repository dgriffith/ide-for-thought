<script lang="ts">
  import type { Backlink } from '../../../../shared/types';
  import { getLinkBundle } from '../../sidebar-link-bundle';
  import LinkBadge from './LinkBadge.svelte';
  import Ribbon from './Ribbon.svelte';

  interface Props {
    activeFilePath: string | null;
    revision: number;
    onFileSelect: (relativePath: string) => void;
  }

  let { activeFilePath, revision, onFileSelect }: Props = $props();
  let links = $state<Backlink[]>([]);
  let search = $state('');
  let sortId = $state<'type' | 'title'>('type');
  let collapsedGroups = $state<Record<string, boolean>>({});

  $effect(() => {
    if (activeFilePath) {
      // Coalesced fetch (#351) — siblings on the same tab switch share one IPC.
      void getLinkBundle(activeFilePath, revision).then((b) => { links = b.backlinks; });
    } else {
      links = [];
    }
  });

  const filtered = $derived(() => {
    const q = search.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => l.sourceTitle.toLowerCase().includes(q) || l.source.toLowerCase().includes(q));
  });

  const grouped = $derived((): Map<string, Backlink[]> => {
    const map = new Map<string, Backlink[]>();
    if (sortId === 'title') {
      const flat = [...filtered()].sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle));
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
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find mention…"
    sortOptions={[
      { id: 'type', label: 'By type' },
      { id: 'title', label: 'Alphabetical' },
    ]}
    {sortId}
    onSort={(id: string) => { sortId = id as 'type' | 'title'; }}
    onExpandAll={sortId === 'type' ? expandAll : undefined}
    onCollapseAll={sortId === 'type' ? collapseAll : undefined}
  />
  <div class="scroll">
    {#if filtered().length === 0}
      <div class="empty">{links.length === 0 ? 'No backlinks found' : 'No matches'}</div>
    {:else}
      <div class="link-count">{filtered().length} linked mention{filtered().length !== 1 ? 's' : ''}</div>
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
                onclick={() => onFileSelect(link.source)}
                title={link.source}
              >
                <LinkBadge label={link.linkLabel} color={link.linkColor} />
                <span class="link-title">{link.sourceTitle}</span>
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
  .link-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center; }
</style>
