<script lang="ts">
  import type { Tab } from '../stores/editor.svelte';
  import type { SourceMetadata } from '../../../shared/types';
  import { displaySourceTitle } from '../../../shared/source-display';
  import { api } from '../ipc/client';
  import { clampMenuToViewport } from '../utils/menuClamp';
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
    /** Trailing `+` button — opens a new note at the project root. */
    onNewTab?: () => void;
  }

  let { tabs, activeIndex, sources, onSwitch, onClose, onCloseOthers, onCloseAll, onReveal, onOpenConversation, onBookmark, onNewTab }: Props = $props();

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
    const close = () => {
      contextMenu = null;
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
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
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab"
      class:active={i === activeIndex}
      class:dirty
      onclick={() => onSwitch(i)}
      onauxclick={(e) => handleMiddleClick(e, i)}
      oncontextmenu={(e) => handleContextMenu(e, i)}
      title={tab.type === 'note' ? tab.relativePath : tab.type === 'query' ? tab.title : `Source: ${sourceTabLabel(tab.sourceId)}`}
      role="tab"
      tabindex="0"
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
        {:else}
          <Icon name="notes" size={13} color="var(--text-faint)" />
        {/if}
      </span>
      <span class="tab-name">
        {#if tab.type === 'note'}{tab.fileName.replace(/\.md$/, '')}
        {:else if tab.type === 'query'}{tab.title}
        {:else}{sourceTabLabel(tab.sourceId)}{/if}
      </span>
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
    {#if tabs[contextMenu.index]?.type === 'note'}
      <div class="separator"></div>
      <button onclick={() => { const t = tabs[contextMenu!.index]; if (t.type === 'note') onReveal(t.relativePath); contextMenu = null; }}>Reveal in Sidebar</button>
      <button onclick={() => { onSwitch(contextMenu!.index); contextMenu = null; onOpenConversation?.(); }}>Ask About This...</button>
      <button onclick={() => { const t = tabs[contextMenu!.index]; if (t.type === 'note') onBookmark?.(t.relativePath); contextMenu = null; }}>Bookmark This Note</button>
      <div class="submenu-item">
        <span class="submenu-trigger">Open In <Icon name="chevronRight" size={10} /></span>
        <div class="submenu">
          <button onclick={() => { const t = tabs[contextMenu!.index]; if (t.type === 'note') void api.shell.revealFile(t.relativePath); contextMenu = null; }}>Reveal in Finder</button>
          <button onclick={() => { const t = tabs[contextMenu!.index]; if (t.type === 'note') void api.shell.openInDefault(t.relativePath); contextMenu = null; }}>Open in Default App</button>
          <button onclick={() => { const t = tabs[contextMenu!.index]; if (t.type === 'note') void api.shell.openInTerminal(t.relativePath); contextMenu = null; }}>Open in Terminal</button>
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
    padding: 0 8px 0 14px;
    border: none;
    border-right: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
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
