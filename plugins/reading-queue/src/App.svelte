<script lang="ts">
  /**
   * The Reading Queue panel (#2640): what's being read, then what's next.
   * A row opens its note, hovering or focusing it shows Minerva's preview,
   * and ✓ marks it read — the one write, on a note the query gave the view,
   * after which the graph changes and Minerva sends the queue again.
   */
  import type { MinervaPlugin, PluginQueryResults } from '/@minerva/plugin-api.js';
  import { markReadPatch, queueItems, type QueueItem } from './queue';

  interface Props { minerva: MinervaPlugin }
  let { minerva }: Props = $props();

  let results = $state<PluginQueryResults | null>(null);
  const items = $derived(results ? queueItems(results) : []);
  const reading = $derived(items.filter((i) => i.reading));
  const next = $derived(items.filter((i) => !i.reading));

  $effect(() => minerva.on('query', (r) => { results = r; }));

  function preview(item: QueueItem, el: HTMLElement, via: 'pointer' | 'focus'): void {
    const box = el.getBoundingClientRect();
    void minerva.ui.previewNote({ path: item.path, x: box.left, y: box.top, width: box.width, height: box.height, via }).catch(() => undefined);
  }

  function unpreview(item: QueueItem, via: 'pointer' | 'focus'): void {
    void minerva.ui.hidePreview({ path: item.path, via }).catch(() => undefined);
  }

  async function markRead(item: QueueItem): Promise<void> {
    try {
      await minerva.notes.setProperties({ path: item.path, properties: markReadPatch(item.kind) });
      await minerva.ui.announce({ text: `Marked ${item.title} read.` });
    } catch (e) {
      await minerva.ui.announce({ text: `Couldn't mark ${item.title} read: ${e instanceof Error ? e.message : String(e)}` }).catch(() => undefined);
    }
  }
</script>

{#snippet section(label: string, list: QueueItem[])}
  {#if list.length > 0}
    <h2>{label}</h2>
    <ul>
      {#each list as item (item.path)}
        <li>
          <button
            class="open"
            onclick={() => { void minerva.ui.openNote({ path: item.path }).catch(() => undefined); }}
            onpointerenter={(e) => preview(item, e.currentTarget, 'pointer')}
            onpointerleave={() => unpreview(item, 'pointer')}
            onfocus={(e) => preview(item, e.currentTarget, 'focus')}
            onblur={() => unpreview(item, 'focus')}
          >
            <span class="glyph" aria-hidden="true">{item.kind === 'book' ? '📖' : '📄'}</span>
            <span class="text">
              <span class="title">{item.title}</span>
              {#if item.author}<span class="author">{item.author}</span>{/if}
            </span>
          </button>
          <button class="done" title="Mark read" aria-label={`Mark ${item.title} read`} onclick={() => { void markRead(item); }}>✓</button>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<div class="queue">
  {#if results === null}
    <p class="quiet">Loading…</p>
  {:else if results.error}
    <p class="quiet">The queue's query failed: {results.error}</p>
  {:else if items.length === 0}
    <p class="quiet">Nothing to read. A book with status <em>to-read</em> or an article marked <em>unread</em> shows up here.</p>
  {:else}
    {@render section('Reading', reading)}
    {@render section('Up next', next)}
    {#if results.truncated}<p class="quiet">Showing the first {items.length}.</p>{/if}
  {/if}
</div>

<style>
  .queue { padding: 4px 6px 12px; overflow-y: auto; height: 100%; box-sizing: border-box; }
  h2 {
    margin: 10px 6px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; border-radius: 4px; }
  li:hover { background: var(--bg-button-hover); }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
  }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 4px; }
  .open { flex: 1; min-width: 0; display: flex; gap: 6px; align-items: flex-start; padding: 4px 6px; text-align: left; }
  .text { min-width: 0; display: flex; flex-direction: column; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .author { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .done { padding: 4px 8px; color: var(--text-faint); visibility: hidden; }
  li:hover .done, li:focus-within .done { visibility: visible; }
  .done:hover { color: var(--accent); }
  .quiet { margin: 10px 6px; color: var(--text-muted); line-height: 1.4; }
</style>
