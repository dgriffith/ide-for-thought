<script lang="ts">
  import type { Tab } from '../stores/editor.svelte';
  import type { SourceMetadata } from '../../../shared/types';
  import { displaySourceTitle } from '../../../shared/source-display';
  import { api } from '../ipc/client';
  import { clampMenuToViewport } from '../utils/menuClamp';
  import { installDismissOnClickOutside } from '../dismiss-menu';
  import Icon from './Icon.svelte';

  interface Props {
    tabs: Tab[];
    activeIndex: number;
    /** Project's full source list. Used to resolve a human-readable
     *  label for source tabs (the canonical id like `url-abc123` is
     *  filesystem-only and must never reach the user). */
    sources?: SourceMetadata[];
    onSwitch: (index: number) => void;
    onClose: (index: number) => void;
    onCloseOthers: (index: number) => void;
    onCloseAll: () => void;
    onReveal: (relativePath: string) => void;
    onOpenConversation?: () => void;
    onBookmark?: (relativePath: string) => void;
    /** "Close All In Group" — empties + collapses this pane. Shown only when
     *  there's more than one group (i.e. `otherGroups` is non-empty) (#870). */
    onCloseAllInGroup?: () => void;
    /** Other editor groups this tab can be moved to, in visual order (#870).
     *  Empty when this is the only group. */
    otherGroups?: { id: string; label: string }[];
    /** Move the tab at `index` into the group `targetGroupId` (#870). */
    onMoveToGroup?: (index: number, targetGroupId: string) => void;
    /** Trailing `+` button — opens a new note at the project root. */
    onNewTab?: () => void;
    /** Drag-tab-to-split (#817): pointer pressed on the tab at `index`. The
     *  parent decides (past a movement threshold) whether it becomes a drag.
     *  Pointer-based rather than HTML5 DnD because a macOS native drag suspends
     *  the page's reactivity loop, breaking the reactive drop overlay. */
    onTabPointerDown?: (index: number, e: PointerEvent) => void;
  }

  let { tabs, activeIndex, sources, onSwitch, onClose, onCloseOthers, onCloseAll, onReveal, onOpenConversation, onBookmark, onNewTab, onTabPointerDown, onCloseAllInGroup, otherGroups, onMoveToGroup }: Props = $props();

  /** Map sourceId → metadata for label lookups. Rebuilds whenever the
   *  parent's `sources` array changes. */
  const sourcesById = $derived(() => {
    const m = new Map<string, SourceMetadata>();
    for (const s of sources ?? []) m.set(s.sourceId, s);
    return m;
  });

  /** Best-effort display label for a source tab. When the metadata
   *  hasn't loaded yet, fall back to "Source" (still better than the
   *  raw canonical id). */
  function sourceTabLabel(sourceId: string): string {
    const meta = sourcesById().get(sourceId);
    return meta ? displaySourceTitle(meta) : 'Source';
  }

  let contextMenu = $state<{ x: number; y: number; index: number } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | undefined>();

  /** Per-tab element refs, indexed by tab position. Used to scroll the active
   *  tab into view when it lands off-screen (too many tabs open). */
  let tabEls = $state<(HTMLElement | undefined)[]>([]);

  /** Keep the active tab visible: opening or switching to a tab that has
   *  scrolled off either edge of the strip scrolls it just into view. Uses
   *  `inline: 'nearest'`, so a tab that's already visible doesn't move, and
   *  `block: 'nearest'` so this never nudges the page vertically. */
  $effect(() => {
    const el = tabEls[activeIndex];
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  $effect(() => {
    if (!contextMenu || !contextMenuEl) return;
    const next = clampMenuToViewport(contextMenu.x, contextMenu.y, contextMenuEl);
    if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
      contextMenu = { ...contextMenu, ...next };
    }
  });

  function handleContextMenu(e: MouseEvent, index: number) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, index };
    installDismissOnClickOutside(() => { contextMenu = null; });
  }

  function handleMiddleClick(e: MouseEvent, index: number) {
    if (e.button === 1) {
      e.preventDefault();
      onClose(index);
    }
  }
</script>

<div class="tab-bar">
  {#each tabs as tab, i}
    {@const dirty = tab.type === 'note' && tab.content !== tab.savedContent}
    <!-- Presentational wrapper: carries the drag / middle-click / context-menu
         gestures for the whole tab. The switch and close controls live inside
         as siblings so no interactive element nests another (a11y #1005). The
         wrapper's mouse gestures all have UI equivalents (context menu, close
         button), so it needs no role of its own. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab"
      class:active={i === activeIndex}
      class:dirty
      bind:this={tabEls[i]}
      onpointerdown={(e) => { if (e.button === 0) onTabPointerDown?.(i, e); }}
      onauxclick={(e) => handleMiddleClick(e, i)}
      oncontextmenu={(e) => handleContextMenu(e, i)}
    >
      <!-- The tab proper: a plain button (Enter/Space switch natively). The
           full ARIA tabs widget wants owned tabpanels the editor doesn't model,
           so this is a button labelled by its text with aria-current marking the
           open one — not a role="tab". -->
      <button
        class="tab-switch"
        aria-current={i === activeIndex ? 'page' : undefined}
        onclick={() => onSwitch(i)}
        title={tab.type === 'note'
          ? tab.relativePath
          : tab.type === 'query'
            ? tab.title
            : tab.type === 'pdf'
              ? `PDF: ${sourceTabLabel(tab.sourceId)}`
              : tab.type === 'graph'
                ? `Graph: ${tab.relativePath}`
                : tab.type === 'type-view'
                  ? `Type: ${tab.typeId}`
                  : tab.type === 'unsupported'
                    ? tab.relativePath
                    : `Source: ${sourceTabLabel(tab.sourceId)}`}
      >
        <!-- Leading slot: dirty pip OR type icon. The pip wins when the
             note is dirty so the visual cue can't be missed (§7.2). -->
        <span class="tab-lead">
          {#if dirty}
            <span class="dirty-dot" aria-label="Unsaved changes"></span>
          {:else if tab.type === 'query'}
            <Icon name="query" size={13} color="var(--text-faint)" />
          {:else if tab.type === 'source'}
            <Icon name="source" size={13} color="var(--text-faint)" />
          {:else if tab.type === 'pdf'}
            <Icon name="source" size={13} color="var(--text-faint)" />
          {:else if tab.type === 'graph'}
            <Icon name="graph" size={13} color="var(--text-faint)" />
          {:else if tab.type === 'type-view'}
            <Icon name="objects" size={13} color="var(--text-faint)" />
          {:else}
            <Icon name="notes" size={13} color="var(--text-faint)" />
          {/if}
        </span>
        <span class="tab-name">
          {#if tab.type === 'note'}{tab.fileName.replace(/\.md$/, '')}
          {:else if tab.type === 'query'}{tab.title}
          {:else if tab.type === 'pdf'}{sourceTabLabel(tab.sourceId)} (PDF)
          {:else if tab.type === 'graph'}{(tab.relativePath.split('/').pop() ?? tab.relativePath).replace(/\.md$/, '')} (Graph)
          {:else if tab.type === 'type-view'}{tab.typeId.charAt(0).toUpperCase() + tab.typeId.slice(1)}
          {:else if tab.type === 'unsupported'}{tab.fileName}
          {:else}{sourceTabLabel(tab.sourceId)}{/if}
        </span>
      </button>
      <button
        class="close-btn"
        onclick={(e) => { e.stopPropagation(); onClose(i); }}
        title="Close"
      ><Icon name="close" size={11} /></button>
    </div>
  {/each}
  {#if onNewTab}
    <button class="new-tab-btn" onclick={onNewTab} title="New note">
      <Icon name="plus" size={13} color="var(--text-muted)" />
    </button>
  {/if}
</div>

{#if contextMenu}
  <div
    class="context-menu"
    bind:this={contextMenuEl}
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
  >
    <button onclick={() => { onClose(contextMenu!.index); contextMenu = null; }}>Close</button>
    <button onclick={() => { onCloseOthers(contextMenu!.index); contextMenu = null; }}>Close Others</button>
    <button onclick={() => { onCloseAll(); contextMenu = null; }}>Close All</button>
    {#if onCloseAllInGroup && (otherGroups?.length ?? 0) > 0}
      <button onclick={() => { onCloseAllInGroup?.(); contextMenu = null; }}>Close All In Group</button>
    {/if}
    {#if otherGroups && otherGroups.length === 1}
      <button onclick={() => { onMoveToGroup?.(contextMenu!.index, otherGroups[0]!.id); contextMenu = null; }}>Move to Other Group</button>
    {:else if otherGroups && otherGroups.length > 1}
      <div class="submenu-item">
        <span class="submenu-trigger">Move to Group <Icon name="chevronRight" size={10} /></span>
        <div class="submenu">
          {#each otherGroups as g (g.id)}
            <button onclick={() => { onMoveToGroup?.(contextMenu!.index, g.id); contextMenu = null; }}>{g.label}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if tabs[contextMenu.index]?.type === 'note'}
      <div class="separator"></div>
      <button onclick={() => { const t = tabs[contextMenu!.index]; if (t?.type === 'note') onReveal(t.relativePath); contextMenu = null; }}>Reveal in Sidebar</button>
      <button onclick={() => { onSwitch(contextMenu!.index); contextMenu = null; onOpenConversation?.(); }}>Ask About This...</button>
      <button onclick={() => { const t = tabs[contextMenu!.index]; if (t?.type === 'note') onBookmark?.(t.relativePath); contextMenu = null; }}>Bookmark This Note</button>
      <div class="submenu-item">
        <span class="submenu-trigger">Open In <Icon name="chevronRight" size={10} /></span>
        <div class="submenu">
          <button onclick={() => { const t = tabs[contextMenu!.index]; if (t?.type === 'note') void api.shell.revealFile(t.relativePath); contextMenu = null; }}>Reveal in Finder</button>
          <button onclick={() => { const t = tabs[contextMenu!.index]; if (t?.type === 'note') void api.shell.openInDefault(t.relativePath); contextMenu = null; }}>Open in Default App</button>
          <button onclick={() => { const t = tabs[contextMenu!.index]; if (t?.type === 'note') void api.shell.openInTerminal(t.relativePath); contextMenu = null; }}>Open in Terminal</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: var(--bg-tabbar);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
    height: 36px;
    scrollbar-width: none;
  }

  .tab-bar::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 8px;
    border-right: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 13px;
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
  }

  /* The switch control fills the tab's leading area; native button chrome is
     reset so it reads as plain tab text. Sibling of .close-btn so no
     interactive element nests another (a11y #1005). */
  .tab-switch {
    display: flex;
    align-items: center;
    gap: 8px;
    align-self: stretch;
    padding: 0 0 0 14px;
    border: none;
    background: none;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
    appearance: none;
  }

  .tab-switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .tab:hover {
    color: var(--text);
  }

  .tab.active {
    background: var(--bg);
    color: var(--text);
  }

  /* Active-tab indicator: a 2px accent rail along the bottom (§7.2).
     Rendered as a pseudo-element so it sits at -1px and overlaps the
     1px tab-bar bottom border for a flush look. */
  .tab.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: var(--accent);
  }

  .tab-lead {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    flex-shrink: 0;
  }

  .tab-name {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-faint);
    line-height: 1;
    cursor: pointer;
    padding: 0;
    opacity: 0;
  }

  .tab:hover .close-btn,
  .tab.active .close-btn {
    opacity: 0.8;
  }

  .close-btn:hover {
    background: color-mix(in oklch, var(--text) 8%, transparent);
    color: var(--text);
    opacity: 1;
  }

  .new-tab-btn {
    align-self: center;
    margin: 0 6px 0 4px;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .new-tab-btn:hover {
    background: color-mix(in oklch, var(--text) 8%, transparent);
    color: var(--text);
  }

  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 140px;
  }

  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .context-menu button:hover {
    background: var(--bg-button);
  }

  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .submenu-item {
    position: relative;
  }

  .submenu-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text);
    cursor: default;
  }

  .submenu-trigger:hover {
    background: var(--bg-button);
  }

  .submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: 0;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 160px;
  }

  .submenu-item:hover .submenu {
    display: block;
  }
</style>
