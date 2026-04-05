<script lang="ts">
  import type { Tab } from '../stores/editor.svelte';

  interface Props {
    tabs: Tab[];
    activeIndex: number;
    onSwitch: (index: number) => void;
    onClose: (index: number) => void;
    onCloseOthers: (index: number) => void;
    onCloseAll: () => void;
    onReveal: (relativePath: string) => void;
  }

  let { tabs, activeIndex, onSwitch, onClose, onCloseOthers, onCloseAll, onReveal }: Props = $props();

  let contextMenu = $state<{ x: number; y: number; index: number } | null>(null);

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
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab"
      class:active={i === activeIndex}
      class:dirty={tab.type === 'note' && tab.content !== tab.savedContent}
      onclick={() => onSwitch(i)}
      onauxclick={(e) => handleMiddleClick(e, i)}
      oncontextmenu={(e) => handleContextMenu(e, i)}
      title={tab.type === 'note' ? tab.relativePath : tab.title}
      role="tab"
      tabindex="0"
    >
      {#if tab.type === 'query'}<span class="tab-icon">&#x25B7;</span>{/if}
      <span class="tab-name">{tab.type === 'note' ? tab.fileName.replace(/\.md$/, '') : tab.title}</span>
      {#if tab.type === 'note' && tab.content !== tab.savedContent}
        <span class="dirty-dot"></span>
      {/if}
      <button
        class="close-btn"
        onclick={(e) => { e.stopPropagation(); onClose(i); }}
        title="Close"
      >&times;</button>
    </div>
  {/each}
</div>

{#if contextMenu}
  <div
    class="context-menu"
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
  >
    <button onclick={() => { onClose(contextMenu!.index); contextMenu = null; }}>Close</button>
    <button onclick={() => { onCloseOthers(contextMenu!.index); contextMenu = null; }}>Close Others</button>
    <button onclick={() => { onCloseAll(); contextMenu = null; }}>Close All</button>
    {#if tabs[contextMenu.index]?.type === 'note'}
      <div class="separator"></div>
      <button onclick={() => { const t = tabs[contextMenu!.index]; if (t.type === 'note') onReveal(t.relativePath); contextMenu = null; }}>Reveal in Sidebar</button>
    {/if}
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    background: var(--bg-tabbar);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
    scrollbar-width: none;
  }

  .tab-bar::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px 5px 12px;
    border: none;
    border-right: 1px solid var(--border);
    background: none;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tab:hover {
    background: var(--bg-button);
  }

  .tab.active {
    background: var(--bg);
    color: var(--text);
  }

  .tab-icon {
    font-size: 10px;
    flex-shrink: 0;
  }

  .tab-name {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    opacity: 0;
  }

  .tab:hover .close-btn,
  .tab.active .close-btn {
    opacity: 1;
  }

  .close-btn:hover {
    background: var(--bg-button-hover);
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
</style>
