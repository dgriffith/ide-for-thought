<script lang="ts">
  import type { TagInfo, TaggedNote, TaggedSource } from '../../../../shared/types';
  import { api } from '../../ipc/client';
  import { extractTagsFromContent } from '../../../../shared/refactor/auto-tag';
  import Ribbon from './Ribbon.svelte';
  import Icon from '../Icon.svelte';
  import {
    buildTagTree,
    flattenTagTree,
    subtreeMatches,
    type TagTreeNode,
  } from '../../tags';

  interface Props {
    /** Active note's content. The panel shows only this note's tags
     *  plus their hierarchical ancestors — the left-sidebar Tags panel
     *  covers the project-wide view, so duplicating it here adds no
     *  signal. Ancestors of a tag (e.g. `#foo` for a note tagged
     *  `#foo/bar/baz`) appear even if no other note uses them; unrelated
     *  siblings (e.g. `#foo/baz`) do not. */
    content: string;
    onFileSelect: (relativePath: string) => void;
    /** Selecting a source from the tagged-things list opens it in the
     *  same way the Sources panel does — host wires this through to
     *  the source-detail tab opener. */
    onSourceSelect?: (sourceId: string) => void;
  }

  let { content, onFileSelect, onSourceSelect }: Props = $props();

  let allTags = $state<TagInfo[]>([]);
  let activePath = $state<string | null>(null);
  /** Whether the active row resolved by exact tag (`leaf`) or by
   *  prefix subtree (`prefix`). Tracking it explicitly keeps the
   *  header and reload behaviour straight even when a prefix path
   *  also has its own tag. */
  let activeKind = $state<'leaf' | 'prefix' | null>(null);
  let activeNotes = $state<TaggedNote[]>([]);
  let activeSources = $state<TaggedSource[]>([]);
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

  /** Tags written literally in the active note — both body `#hashtag`
   *  syntax and YAML frontmatter `tags:` lists. Many notes carry tags
   *  only in frontmatter, so missing those left the panel blank. */
  const ACTIVE_TAG_RE = /(?:^|\s)#([a-zA-Z][\w/-]*)/g;
  const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g;
  const tagsInActiveNote = $derived.by<Set<string>>(() => {
    const found = new Set<string>();
    const stripped = content.replace(CODE_RE, '');
    ACTIVE_TAG_RE.lastIndex = 0;
    let m;
    while ((m = ACTIVE_TAG_RE.exec(stripped)) !== null) {
      const cleaned = m[1].replace(/\/+$/, '');
      if (cleaned) found.add(cleaned);
    }
    for (const t of extractTagsFromContent(content)) {
      if (t) found.add(t);
    }
    return found;
  });

  /** Project-wide TagInfo rows for the tags this note actually uses.
   *  `buildTagTree` will synthesize ancestor nodes from each tag's
   *  path segments — so `#foo/bar/baz` produces `foo` and `foo/bar`
   *  in the tree even when no project tag matches them literally. */
  const tagsForActiveNote = $derived<TagInfo[]>(
    allTags.filter((t) => tagsInActiveNote.has(t.tag)),
  );

  const tree = $derived<TagTreeNode[]>(buildTagTree(tagsForActiveNote));

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
      activeSources = [];
      return;
    }
    activePath = node.path;
    activeKind = 'leaf';
    const [notes, sources] = await Promise.all([
      api.tags.notesByTag(node.path),
      api.tags.sourcesByTag(node.path),
    ]);
    activeNotes = notes;
    activeSources = sources;
  }

  async function showPrefix(node: TagTreeNode): Promise<void> {
    if (activePath === node.path && activeKind === 'prefix') {
      activePath = null;
      activeKind = null;
      activeNotes = [];
      activeSources = [];
      return;
    }
    activePath = node.path;
    activeKind = 'prefix';
    // Sources don't yet have a prefix variant — collect them via a
    // client-side filter over the leaf endpoint for each at-or-under
    // tag. For typical thoughtbases this is a handful of tags; if it
    // grows hot we can add tags.sourcesByTagPrefix later.
    const notes = await api.tags.notesByTagPrefix(node.path);
    const prefix = node.path;
    const sourcesSeen = new Map<string, TaggedSource>();
    for (const t of allTags) {
      if (t.sourceCount === 0) continue;
      if (t.tag !== prefix && !t.tag.startsWith(`${prefix}/`)) continue;
      const got = await api.tags.sourcesByTag(t.tag);
      for (const s of got) {
        if (!sourcesSeen.has(s.sourceId)) sourcesSeen.set(s.sourceId, s);
      }
    }
    activeNotes = notes;
    activeSources = [...sourcesSeen.values()].sort((a, b) => a.title.localeCompare(b.title));
  }
</script>

<div class="tags-panel">
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find tag…"
  />
  {#if tagsForActiveNote.length === 0}
    <div class="empty">No tags in this note</div>
  {:else if visibleRows.length === 0}
    <div class="empty">No matches</div>
  {:else}
    <div class="tag-tree">
      {#each visibleRows as row (row.path)}
        <div
          class="row"
          class:active={activePath === row.path}
          class:in-active-note={tagsInActiveNote.has(row.path)}
          style:padding-left="{row.depth * 14 + 8}px"
        >
          {#if row.children.length > 0}
            <button
              type="button"
              class="chevron"
              onclick={() => toggle(row.path)}
              aria-label={isExpanded(row.path) ? 'Collapse' : 'Expand'}
            >
              <Icon name={isExpanded(row.path) ? 'chevronDown' : 'chevronRight'} size={11} color="var(--text-faint)" />
            </button>
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
          <span class="count" title={`${row.noteCount} notes · ${row.sourceCount} sources`}>
            {#if row.sourceCount > 0}
              <span class="count-n">{row.noteCount}</span>
              <span class="count-sep">·</span>
              <span class="count-s">{row.sourceCount}</span>
            {:else}
              {row.noteCount}
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}

  {#if activePath && (activeNotes.length > 0 || activeSources.length > 0)}
    <div class="notes-section">
      <div class="notes-header">
        <span class="notes-eyebrow">{activeKind === 'prefix' ? 'TAGGED UNDER' : 'TAGGED'} #{activePath}</span>
        <span class="notes-count">{activeNotes.length + activeSources.length}</span>
      </div>
      {#each activeNotes as note (note.relativePath)}
        <button class="note-item" onclick={() => onFileSelect(note.relativePath)}>
          <Icon name="notes" size={12} color="var(--text-faint)" />
          <span class="note-title">{note.title}</span>
        </button>
      {/each}
      {#each activeSources as source (source.sourceId)}
        <button class="note-item" onclick={() => onSourceSelect?.(source.sourceId)} title={`Source: ${source.sourceId}`}>
          <Icon name="sites" size={12} color="var(--text-faint)" />
          <span class="note-title">{source.title}</span>
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

  /* Hierarchical tree row (§13.4). Chevron · mono tag name · tabular
     count. Active row gets the 2px accent rail + tint shared with the
     file tree. Tags present in the active note get an accent dot
     marker before the name. */
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px 3px 0;
    border-left: 2px solid transparent;
  }
  .row:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
  }
  .row.active {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    border-left-color: var(--accent);
  }
  .row.in-active-note .tag-name {
    color: var(--accent);
  }

  .chevron,
  .chevron-spacer {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .chevron-spacer { cursor: default; }

  .tag-name {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.active .tag-name { color: var(--accent); }

  .count {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    padding-right: 4px;
    display: inline-flex;
    gap: 3px;
    align-items: baseline;
  }
  .row.active .count { color: var(--accent); }
  /* Note count vs source count distinction: notes look like a literal
     number (the count the panel always showed); the source bump after
     the dot picks up a slightly different hue so a glance can read
     "10 notes, 3 sources" without parsing the separator. */
  .count-sep { color: var(--text-faint); opacity: 0.6; }
  .count-s { color: var(--text-muted); }
  .row.active .count-sep,
  .row.active .count-s { color: var(--accent); }

  /* "NOTES WITH #..." section under the tree */
  .notes-section {
    border-top: 1px solid var(--border);
    max-height: 50%;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .notes-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 10px 14px 6px;
  }
  .notes-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.06em;
  }
  .notes-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .note-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 14px 5px 18px;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .note-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }
  .note-title {
    flex: 1;
    min-width: 0;
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
