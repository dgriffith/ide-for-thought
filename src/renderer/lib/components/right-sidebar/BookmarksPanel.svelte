<script lang="ts">
  import { getBookmarksStore, collectNoteBookmarksWithFolder } from '../../stores/bookmarks.svelte';
  import type { Bookmark } from '../../../../shared/types';
  import Icon from '../Icon.svelte';

  interface Props {
    activeFilePath: string | null;
    onFileSelect: (relativePath: string) => void;
    /** Open + scroll to an anchor (`path#slug`) for section bookmarks.
     *  Works even when the file is already active (scrolls in place). */
    onNavigate?: (target: string) => void | Promise<void>;
    /** Open + jump to a character offset for line bookmarks (#756). */
    onOpenAtOffset?: (relativePath: string, offset: number) => void | Promise<void>;
  }

  let { activeFilePath, onFileSelect, onNavigate, onOpenAtOffset }: Props = $props();

  /** Route a bookmark click by kind: section (anchor) → scroll to heading;
   *  line (cursorOffset) → jump to offset; otherwise open the whole file. */
  function openBookmark(bm: Bookmark) {
    if (bm.anchor && onNavigate) void onNavigate(`${bm.relativePath}#${bm.anchor}`);
    else if (bm.cursorOffset != null && onOpenAtOffset) void onOpenAtOffset(bm.relativePath, bm.cursorOffset);
    else onFileSelect(bm.relativePath);
  }

  /** Icon distinguishing the three bookmark kinds. */
  function bmIcon(bm: Bookmark): 'outline' | 'dot' | 'bookmark' {
    if (bm.anchor) return 'outline';
    if (bm.cursorOffset != null) return 'dot';
    return 'bookmark';
  }

  const bookmarks = getBookmarksStore();

  // The bookmarks for the active note, each paired with its containing-folder
  // path so placement is visible here (this panel used to flatten the tree and
  // drop the folder entirely). Top-level bookmarks carry an empty folder.
  const forActiveNote = $derived(
    activeFilePath ? collectNoteBookmarksWithFolder(bookmarks.tree, activeFilePath) : [],
  );
</script>

<div class="bookmarks-panel">
  {#if !activeFilePath}
    <p class="empty">No active note</p>
  {:else if forActiveNote.length === 0}
    <p class="empty">No bookmarks for this note</p>
  {:else}
    <div class="bookmark-list">
      {#each forActiveNote as { bookmark: bm, folder } (bm.id)}
        <div class="bm-item">
          <button
            type="button"
            class="bm-open"
            onclick={() => openBookmark(bm)}
            title={folder ? `${folder} / ${bm.name}` : bm.name}
          >
            <Icon name={bmIcon(bm)} size={13} color="var(--text-faint)" />
            <span class="bm-text">
              <span class="bm-name">{bm.name}</span>
              {#if folder}
                <span class="bm-folder">
                  <Icon name="folder" size={10} color="var(--text-faint)" />
                  {folder}
                </span>
              {/if}
            </span>
          </button>
          <button
            type="button"
            class="bm-delete"
            onclick={() => bookmarks.remove(bm.id)}
            title="Delete bookmark"
            aria-label="Delete bookmark"
          >
            <Icon name="close" size={12} color="currentColor" />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bookmarks-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .empty {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    padding: 16px 12px;
  }

  .bookmark-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .bm-item {
    display: flex;
    align-items: center;
    border-left: 2px solid transparent;
  }
  .bm-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }

  .bm-open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px 5px 10px;
    border: none;
    background: none;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .bm-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .bm-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Containing-folder path — muted secondary line so placement is visible
     without competing with the bookmark name. */
  .bm-folder {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Delete affordance: muted by default, picks up the row's hover
     state and only lights up on its own hover. Sized to read as
     "small action" rather than "danger." */
  .bm-delete {
    flex-shrink: 0;
    padding: 4px 10px;
    border: none;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    opacity: 0;
  }
  .bm-item:hover .bm-delete { opacity: 1; }
  .bm-delete:hover { color: var(--text); }
</style>
