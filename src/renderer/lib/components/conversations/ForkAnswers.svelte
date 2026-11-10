<script lang="ts">
  /**
   * An "Ask in parallel" join (#2974): each branch's answer side by side, as
   * many columns as fit, each with Open to continue in that branch. Continuing
   * here, in the conversation that asked, is the composer below.
   */
  import { getConversationsStore } from '../../stores/conversations.svelte';
  import { renderMarkdownCached } from '../../conversations/markdown-render';
  import type { ForkAnswer } from '../../../../shared/conversation';

  interface Props {
    answers: ForkAnswer[];
  }

  let { answers }: Props = $props();

  const store = getConversationsStore();
</script>

<ul class="fork-answers" aria-label="Answers side by side">
  {#each answers as a, i (i)}
    <li class="fork-answer" aria-label="{a.title}{a.status === 'done' ? '' : `, ${a.status}`}">
      <div class="fork-answer-head">
        <span class="fork-answer-title">{a.title}</span>
        {#if a.status !== 'done'}<span class="fork-answer-state">{a.note ?? a.status}</span>{/if}
        {#if a.conversationId}
          <button
            type="button"
            class="fork-answer-open"
            aria-label="Continue in branch {a.title}"
            onclick={() => void store.openBranchTab(a.conversationId)}
          >Open</button>
        {/if}
      </div>
      {#if a.answer.trim()}
        <div class="fork-answer-body">{@html renderMarkdownCached(a.answer)}</div>
      {:else}
        <p class="fork-answer-empty">No answer.</p>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .fork-answers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
  }
  .fork-answer {
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-inset);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fork-answer-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12px;
  }
  .fork-answer-title {
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .fork-answer-state { color: var(--text-muted); }
  .fork-answer-open {
    margin-left: auto;
    padding: 2px 8px;
    background: var(--bg-button);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11.5px;
    cursor: pointer;
  }
  .fork-answer-open:hover { background: var(--bg-button-hover); }
  .fork-answer-body {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
    word-wrap: break-word;
  }
  .fork-answer-body :global(p) { margin: 0.4em 0; }
  .fork-answer-body :global(p:first-child) { margin-top: 0; }
  .fork-answer-body :global(ol),
  .fork-answer-body :global(ul) { padding-left: 1.6em; margin: 0.4em 0; }
  .fork-answer-body :global(a) { color: var(--accent); text-decoration: underline; }
  .fork-answer-empty { margin: 0; font-size: 12px; color: var(--text-muted); }
</style>
