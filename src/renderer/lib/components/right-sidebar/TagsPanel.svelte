<script lang="ts">
  import type { TaggedNote } from '../../../../shared/types';
  import { api } from '../../ipc/client';

  interface Props {
    content: string;
    onFileSelect: (relativePath: string) => void;
  }

  let { content, onFileSelect }: Props = $props();

  let expandedTag = $state<string | null>(null);
  let taggedNotes = $state<TaggedNote[]>([]);

  // Extract tags from current note content (client-side)
  const TAG_RE = /(?:^|\s)#([a-zA-Z][\w-/]*)/g;
  const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g;

  let tags = $derived(() => {
    const stripped = content.replace(CODE_RE, '');
    const found = new Set<string>();
    let match;
    TAG_RE.lastIndex = 0;
    while ((match = TAG_RE.exec(stripped)) !== null) {
      found.add(match[1]);
    }
    return [...found].sort();
  });

  async function toggleTag(tag: string) {
    if (expandedTag === tag) {
      expandedTag = null;
      taggedNotes = [];
    } else {
      expandedTag = tag;
      taggedNotes = await api.tags.notesByTag(tag);
    }
  }
</script>

<div class="tags-panel">
  {#if tags().length === 0}
    <div class="empty">No tags in this note</div>
  {:else}
    <div class="tag-list">
      {#each tags() as tag}
        <button
          class="tag-item"
          class:expanded={expandedTag === tag}
          onclick={() => toggleTag(tag)}
        >
          <span class="tag-name">#{tag}</span>
        </button>
        {#if expandedTag === tag && taggedNotes.length > 0}
          <ul class="tagged-notes">
            {#each taggedNotes as note}
              <li>
                <button class="note-link" onclick={() => onFileSelect(note.relativePath)}>
                  {note.title}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .tags-panel {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .tag-list {
    padding: 0 4px;
  }

  .tag-item {
    display: block;
    width: 100%;
    padding: 4px 8px;
    border: none;
    background: none;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    border-radius: 3px;
  }

  .tag-item:hover {
    background: var(--bg-button);
  }

  .tag-item.expanded {
    background: var(--bg-button);
  }

  .tagged-notes {
    list-style: none;
    padding: 0 0 4px 16px;
  }

  .note-link {
    display: block;
    width: 100%;
    padding: 3px 8px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    border-radius: 3px;
  }

  .note-link:hover {
    background: var(--bg-button);
  }

  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
