<script lang="ts">
  /**
   * Shared secondary toolbar for right-sidebar panels. Each panel owns
   * its own search / sort / expand-collapse state and passes callbacks
   * in; the ribbon is just compact chrome.
   *
   * Every prop is optional so a panel can opt into just the affordances
   * it actually has — a sort selector without sort options would be
   * noise, same for expand/collapse on a flat list.
   */

  interface SortOption {
    id: string;
    label: string;
  }

  interface Props {
    search?: string;
    onSearch?: (q: string) => void;
    searchPlaceholder?: string;
    sortOptions?: SortOption[];
    sortId?: string;
    onSort?: (id: string) => void;
    onExpandAll?: () => void;
    onCollapseAll?: () => void;
  }

  let {
    search = '',
    onSearch,
    searchPlaceholder = 'Filter…',
    sortOptions,
    sortId,
    onSort,
    onExpandAll,
    onCollapseAll,
  }: Props = $props();
</script>

<div class="ribbon">
  {#if onSearch}
    <input
      type="text"
      class="search"
      value={search}
      placeholder={searchPlaceholder}
      oninput={(e) => onSearch?.(e.currentTarget.value)}
    />
  {/if}
  {#if sortOptions && sortOptions.length > 0 && onSort}
    <select
      class="sort"
      value={sortId}
      onchange={(e) => onSort?.(e.currentTarget.value)}
      title="Sort"
    >
      {#each sortOptions as opt}
        <option value={opt.id}>{opt.label}</option>
      {/each}
    </select>
  {/if}
  {#if onCollapseAll}
    <button class="icon-btn" onclick={onCollapseAll} title="Collapse all">&#x2303;</button>
  {/if}
  {#if onExpandAll}
    <button class="icon-btn" onclick={onExpandAll} title="Expand all">&#x2304;</button>
  {/if}
</div>

<style>
  .ribbon {
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .search {
    flex: 1;
    min-width: 40px;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
    font-size: 11px;
    outline: none;
  }
  .search:focus { border-color: var(--accent); }
  .sort {
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
    font-size: 11px;
    outline: none;
    cursor: pointer;
  }
  .icon-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .icon-btn:hover { background: var(--bg-button); color: var(--text); }
</style>
