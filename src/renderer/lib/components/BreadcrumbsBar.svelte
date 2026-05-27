<script lang="ts">
  /**
   * Thin clickable breadcrumbs bar above the editor pane (#476).
   *
   * Shows:
   *   - Folder segments derived from the active file's relative path —
   *     clicking a folder reveals + expands it in the left sidebar.
   *   - The note's leaf name (no click target — you're already there).
   *   - When `showHeadings` is on AND the cursor sits inside a heading,
   *     a `·` separator and the heading chain (clickable, jump-to-line).
   *
   * Hidden when there's no active file. Updates to the heading chain are
   *  debounced (60ms) so a flurry of keystrokes doesn't thrash the
   *  cursor-→-chain computation, but folder breadcrumb is instant —
   *  it only changes on tab switches.
   */
  import { extractHeadings, activeHeadingChain, type Heading } from '../markdown/headings';
  import { untrack } from 'svelte';

  interface Props {
    /** Active file's project-relative path, or null when no file is open. */
    filePath: string | null;
    /** Active file's content — drives the heading chain extraction. */
    content: string;
    /** 1-based line of the editor cursor. Plumbed from App.svelte's
     *  cursorInfo (already wired for StatusBar). */
    cursorLine: number;
    /** Toggle for the trailing heading chain. Stable bar when off. */
    showHeadings: boolean;
    /** Reveal a folder in the left sidebar — expands ancestors and
     *  scrolls the row into view. Passed up to App.svelte which routes
     *  to the Sidebar's exposed revealFolder(). */
    onRevealFolder: (folderPath: string) => void;
    /** Jump editor to a line (same callback used by OutlinePanel). */
    onScrollToLine: (line: number) => void;
  }

  let { filePath, content, cursorLine, showHeadings, onRevealFolder, onScrollToLine }: Props = $props();

  /** Folder segments + leaf name derived from filePath. Folder paths are
   *  absolute-from-root so the reveal handler doesn't have to reassemble
   *  them. Returns null when no file is open. */
  const pathSegments = $derived.by(() => {
    if (!filePath) return null;
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const leaf = parts[parts.length - 1].replace(/\.(md|ttl|csv|py)$/i, '');
    const folders: Array<{ name: string; path: string }> = [];
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      folders.push({ name: parts[i], path: acc });
    }
    return { folders, leaf };
  });

  /** Cursor-driven heading chain. Debounced so typing inside a paragraph
   *  doesn't recompute on every keystroke even though the result is
   *  identical until the cursor crosses a heading boundary. */
  let headings = $state<Heading[]>([]);
  let chain = $state<Heading[]>([]);
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  // Re-parse headings whenever the document changes. Cheap (O(n) lines)
  // but still worth not redoing on cursor moves.
  $effect(() => {
    if (!showHeadings || !filePath) {
      headings = [];
      chain = [];
      return;
    }
    headings = extractHeadings(content);
  });

  // Recompute the chain when the cursor moves or the heading list
  // changes. Debounced 60ms — the human eye can't resolve faster updates
  // anyway and the throttle lets a held arrow key cruise without
  // chain-rebuild overhead per row.
  $effect(() => {
    if (!showHeadings || !filePath) return;
    const line = cursorLine;
    const hs = headings;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      untrack(() => {
        chain = activeHeadingChain(hs, line);
      });
    }, 60);
  });
</script>

{#if pathSegments}
  <nav class="breadcrumbs" aria-label="File location">
    {#each pathSegments.folders as folder (folder.path)}
      <button
        type="button"
        class="crumb folder"
        onclick={() => onRevealFolder(folder.path)}
        title="Reveal {folder.path} in sidebar"
      >{folder.name}</button>
      <span class="sep" aria-hidden="true">›</span>
    {/each}
    <span class="crumb leaf" aria-current="page">{pathSegments.leaf}</span>

    {#if showHeadings && chain.length > 0}
      <span class="group-sep" aria-hidden="true">·</span>
      {#each chain as h, i (h.line)}
        <button
          type="button"
          class="crumb heading"
          onclick={() => onScrollToLine(h.line)}
          title="Jump to line {h.line}"
        >{h.text}</button>
        {#if i < chain.length - 1}
          <span class="sep" aria-hidden="true">›</span>
        {/if}
      {/each}
    {/if}
  </nav>
{/if}

<style>
  /* Compact, single line. Sits in the editor chrome — bg-toolbar binds
     it to the chrome above (tab bar) and below (status bar). Truncates
     middle folders first via min-width:0 on the leaf so root + leaf
     stay visible when space is tight. */
  .breadcrumbs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 14px;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-sans);
    font-size: 11.5px;
    color: var(--text-muted);
    overflow: hidden;
    flex-shrink: 0;
    white-space: nowrap;
    min-width: 0;
  }

  .crumb {
    flex-shrink: 1;
    min-width: 0;
    padding: 0 4px;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumb.folder:hover,
  .crumb.heading:hover {
    color: var(--text);
    background: color-mix(in oklch, var(--text) 6%, transparent);
  }

  /* Leaf is the current file — italic display-serif to echo the title
     bar's note-title treatment. Not clickable, doesn't shrink. */
  .crumb.leaf {
    color: var(--text);
    font-family: var(--font-display);
    font-style: italic;
    cursor: default;
    flex-shrink: 0;
  }
  .crumb.leaf:hover {
    background: none;
  }

  .sep {
    color: var(--text-faint);
    font-size: 11px;
    flex-shrink: 0;
  }
  /* `·` between the file location and the heading chain — slightly
     heavier so the two groups read as distinct. */
  .group-sep {
    color: var(--text-faint);
    margin: 0 4px;
    flex-shrink: 0;
  }

  /* Heading-chain leaf (the active heading at the cursor) gets a
     subtle accent so the user can tell where they are. */
  .crumb.heading:last-of-type {
    color: var(--accent);
  }
</style>
