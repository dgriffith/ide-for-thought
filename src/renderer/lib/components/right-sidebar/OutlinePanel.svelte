<script lang="ts">
  interface Props {
    content: string;
    onScrollToLine: (line: number) => void;
  }

  let { content, onScrollToLine }: Props = $props();

  interface Heading {
    level: number;
    text: string;
    line: number;
  }

  let collapsed = $state<Record<number, boolean>>({});

  let headings = $derived(extractHeadings(content));

  function extractHeadings(text: string): Heading[] {
    const result: Heading[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        result.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
      }
    }
    return result;
  }

  function hasChildren(index: number): boolean {
    if (index >= headings.length - 1) return false;
    return headings[index + 1].level > headings[index].level;
  }

  function isVisible(index: number): boolean {
    // Check if any ancestor heading is collapsed
    for (let i = index - 1; i >= 0; i--) {
      if (headings[i].level < headings[index].level) {
        if (collapsed[i]) return false;
        // Check this ancestor's ancestors too
      }
    }
    return true;
  }

  function toggleCollapse(index: number) {
    collapsed[index] = !collapsed[index];
  }
</script>

<div class="outline-panel">
  {#if headings.length === 0}
    <div class="empty">No headings</div>
  {:else}
    <ul class="outline-list">
      {#each headings as heading, i}
        {#if isVisible(i)}
          <li>
            <button
              class="outline-item"
              style:padding-left="{(heading.level - 1) * 14 + 8}px"
              onclick={() => onScrollToLine(heading.line)}
            >
              {#if hasChildren(i)}
                <span
                  class="collapse-toggle"
                  onclick={(e) => { e.stopPropagation(); toggleCollapse(i); }}
                  role="button"
                  tabindex="-1"
                >{collapsed[i] ? '▸' : '▾'}</span>
              {:else}
                <span class="collapse-spacer"></span>
              {/if}
              <span class="heading-text">{heading.text}</span>
            </button>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</div>

<style>
  .outline-panel {
    flex: 1;
    overflow-y: auto;
  }

  .outline-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .outline-item {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    border-radius: 3px;
  }

  .outline-item:hover {
    background: var(--bg-button);
  }

  .collapse-toggle {
    font-size: 10px;
    width: 12px;
    text-align: center;
    flex-shrink: 0;
    cursor: pointer;
    color: var(--text-muted);
  }

  .collapse-spacer {
    width: 12px;
    flex-shrink: 0;
  }

  .heading-text {
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
