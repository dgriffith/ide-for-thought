<script lang="ts">
  import type { Backlink } from '../../../../shared/types';
  import { getLinkBundle } from '../../sidebar-link-bundle';
  import LinkBadge from './LinkBadge.svelte';
  import Ribbon from './Ribbon.svelte';
  import Icon from '../Icon.svelte';

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
        {@const collapsed = !!collapsedGroups[type]}
        <div class="type-group">
          {#if type !== ''}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <div class="type-header" onclick={() => toggleGroup(type)}>
              <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={11} color="var(--text-faint)" />
              <span class="type-square" style:background={typeLinks[0].linkColor} aria-hidden="true"></span>
              <span class="type-label">{typeLinks[0].linkLabel}</span>
              <span class="type-count">{typeLinks.length}</span>
            </div>
          {/if}
          {#if type === '' || !collapsed}
            {#each typeLinks as link}
              <button
                class="link-item"
                onclick={() => onFileSelect(link.source)}
                title={link.source}
              >
                <Icon name="notes" size={12} color="var(--text-faint)" />
                <span class="link-title">{link.sourceTitle}</span>
                {#if type === ''}
                  <LinkBadge label={link.linkLabel} color={link.linkColor} />
                {/if}
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
    padding: 6px 12px 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.04em;
  }
  .type-group { margin-bottom: 4px; }
  /* Group header (§13.3) — chevron + 7×7 color square + mono type label
     + tabular count on the right. */
  .type-header {
    padding: 5px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }
  .type-header:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
  }
  .type-square {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .type-label {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }
  .type-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .link-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 12px 5px 30px;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .link-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }
  .link-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty { padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center; }
</style>
