<script lang="ts">
  import type { TagInfo, TaggedNote } from '../../../../shared/types';
  import { api } from '../../ipc/client';
  import Ribbon from './Ribbon.svelte';
  import {
    buildTagTree,
    flattenTagTree,
    subtreeMatches,
    type TagTreeNode,
  } from '../../tags';

  interface Props {
    /** Active note's content. Tags from this note are highlighted in
     *  the tree but the panel shows project-wide tags now (#466). */
    content: string;
    onFileSelect: (relativePath: string) => void;
  }

  let { content, onFileSelect }: Props = $props();

  let allTags = $state<TagInfo[]>([]);
  let activePath = $state<string | null>(null);
  /** Whether the active row resolved by exact tag (`leaf`) or by
   *  prefix subtree (`prefix`). Tracking it explicitly keeps the
   *  header and reload behaviour straight even when a prefix path
   *  also has its own tag. */
  let activeKind = $state<'leaf' | 'prefix' | null>(null);
  let activeNotes = $state<TaggedNote[]>([]);
  let search = $state('');

  // Expand state — persisted per-project would be nicer, but the panel
  // re-renders the same set of tags within a session and `localStorage`
  // is the same convention we use for sidebar widths. Project-scoped
  // expand state can be a follow-up if anyone notices.
  const STORAGE_KEY = 'minerva.tagsPanel.expanded';
  let expanded = $state<Record<string, boolean>>(loadExpanded());

  function loadExpanded(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'boolean') out[k] = v;
        }
        return out;
      }
    } catch { /* fall through */ }
    return {};
  }
  function persistExpanded(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
    } catch { /* localStorage full / disabled — non-fatal */ }
  }

  // Refresh on mount and whenever the active note's content changes
  // (a save in this note may have added or removed a tag).
  $effect(() => {
    void content; // track as dependency
    void refresh();
  });

  export async function refresh(): Promise<void> {
    allTags = await api.tags.list();
  }

  const tree = $derived<TagTreeNode[]>(buildTagTree(allTags));

  /** Tags present in the active note — used to give those rows a
   *  subtle highlight without filtering the project-wide tree. */
  const ACTIVE_TAG_RE = /(?:^|\s)#([a-zA-Z][\w/-]*)/g;
  const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g;
  const tagsInActiveNote = $derived.by<Set<string>>(() => {
    const stripped = content.replace(CODE_RE, '');
    const found = new Set<string>();
    ACTIVE_TAG_RE.lastIndex = 0;
    let m;
    while ((m = ACTIVE_TAG_RE.exec(stripped)) !== null) {
      const cleaned = m[1].replace(/\/+$/, '');
      if (cleaned) found.add(cleaned);
    }
    return found;
  });

  /**
   * Visible nodes after applying the search filter. A subtree-level
   * match keeps every ancestor visible so the user can see where the
   * hit lives. When no search is active, every node is visible
   * (collapse state still controls render via `flattenTagTree`).
   */
  const visibleTree = $derived.by<TagTreeNode[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tree;
    const filter = (nodes: TagTreeNode[]): TagTreeNode[] => {
      const out: TagTreeNode[] = [];
      for (const n of nodes) {
        if (!subtreeMatches(n, q)) continue;
        out.push({ ...n, children: filter(n.children) });
      }
      return out;
    };
    return filter(tree);
  });

  /**
   * Search collapses the expand state — when filtering, every match's
   * ancestor chain should be visible regardless of saved state. We
   * compute this on the fly via a synthetic isExpanded function.
   */
  function isExpanded(path: string): boolean {
    if (search.trim().length > 0) return true;
    return !!expanded[path];
  }

  const visibleRows = $derived(flattenTagTree(visibleTree, isExpanded));

  function toggle(path: string): void {
    expanded = { ...expanded, [path]: !expanded[path] };
    persistExpanded();
  }

  async function showLeaf(node: TagTreeNode): Promise<void> {
    if (activePath === node.path && activeKind === 'leaf') {
      activePath = null;
      activeKind = null;
      activeNotes = [];
      return;
    }
    activePath = node.path;
    activeKind = 'leaf';
    activeNotes = await api.tags.notesByTag(node.path);
  }

  async function showPrefix(node: TagTreeNode): Promise<void> {
    if (activePath === node.path && activeKind === 'prefix') {
      activePath = null;
      activeKind = null;
      activeNotes = [];
      return;
    }
    activePath = node.path;
    activeKind = 'prefix';
    activeNotes = await api.tags.notesByTagPrefix(node.path);
  }
</script>

<div class="tags-panel">
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find tag…"
  />
  {#if allTags.length === 0}
    <div class="empty">No tags in project</div>
  {:else if visibleRows.length === 0}
    <div class="empty">No matches</div>
  {:else}
    <div class="tag-tree">
      {#each visibleRows as row (row.path)}
        <div
          class="row"
          class:active={activePath === row.path}
          class:in-active-note={tagsInActiveNote.has(row.path)}
          style:padding-left="{row.depth * 14 + 6}px"
        >
          {#if row.children.length > 0}
            <button
              type="button"
              class="chevron"
              onclick={() => toggle(row.path)}
              aria-label={isExpanded(row.path) ? 'Collapse' : 'Expand'}
            >{isExpanded(row.path) ? '▾' : '▸'}</button>
          {:else}
            <span class="chevron-spacer"></span>
          {/if}
          <button
            type="button"
            class="tag-name"
            title={row.children.length > 0
              ? `Show notes tagged at-or-under #${row.path}`
              : `Show notes tagged exactly #${row.path}`}
            onclick={() => row.children.length > 0
              ? void showPrefix(row)
              : void showLeaf(row)
            }
          >
            #{row.segment}{#if !row.hasOwnTag && row.children.length > 0}/{/if}
          </button>
          <span class="count">{row.count}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if activePath && activeNotes.length > 0}
    <div class="notes-section">
      <div class="notes-header">
        {activeKind === 'prefix' ? 'Under' : 'Tagged'} #{activePath}
      </div>
      {#each activeNotes as note (note.relativePath)}
        <button class="note-item" onclick={() => onFileSelect(note.relativePath)}>
          {note.title}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tags-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .tag-tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 0;
    font-size: 12px;
    border-radius: 3px;
  }
  .row:hover {
    background: var(--bg-button);
  }
  .row.active {
    background: var(--bg-button);
  }
  .row.in-active-note .tag-name {
    color: var(--accent);
    font-weight: 600;
  }

  .chevron,
  .chevron-spacer {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 10px;
    text-align: center;
    cursor: pointer;
    padding: 0;
  }
  .chevron-spacer { cursor: default; }

  .tag-name {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row:hover .tag-name { color: var(--text); }

  .count {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-muted);
    padding-right: 2px;
  }

  .notes-section {
    border-top: 1px solid var(--border);
    max-height: 50%;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .notes-header {
    padding: 6px 12px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .note-item {
    display: block;
    width: 100%;
    padding: 4px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .note-item:hover {
    background: var(--bg-button);
  }

  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
