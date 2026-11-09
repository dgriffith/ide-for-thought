<script lang="ts">
  import { forkCardsFor, stopAllBranches, stopBranch, type ForkCard } from '../../stores/fork-cards.svelte';
  import { getConversationsStore, type TabRuntime } from '../../stores/conversations.svelte';
  import { formatElapsed } from '../../conversations/turn-status';
  import { formatUSD } from '../../conversations/conversation-cost';
  import { renderMarkdownCached } from '../../conversations/markdown-render';
  import type { ForkBranchState, ForkCardBranch } from '../../../../shared/conversation';

  interface Props {
    /** The conversation whose forks we render. */
    tab: TabRuntime;
    /** Message index these cards are anchored to; `null` renders the ones past
     *  the current message list (a fork in the turn still running). */
    index: number | null;
  }

  let { tab, index }: Props = $props();

  const store = getConversationsStore();

  const picked = $derived(forkCardsFor(tab.id).filter((c) =>
    index === null ? c.afterMessageIndex >= tab.conversation.messages.length : c.afterMessageIndex === index));

  const active = (b: ForkCardBranch) => b.state === 'starting' || b.state === 'running';

  // A one-second clock for the elapsed times, only while a branch is going.
  let now = $state(Date.now());
  const ticking = $derived(picked.some((c) => c.branches.some(active)));
  $effect(() => {
    if (!ticking) return;
    now = Date.now();
    const id = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(id);
  });

  const STATE_WORD: Record<ForkBranchState, string> = {
    starting: 'starting', running: 'running', done: 'finished', stopped: 'stopped', failed: 'failed',
  };
  const GLYPH: Record<ForkBranchState, string> = {
    starting: '○', running: '◐', done: '●', stopped: '◌', failed: '⊘',
  };

  function costLine(card: ForkCard): string {
    const estimate = card.estimateUSD > 0 ? `estimated ${formatUSD(card.estimateUSD)}` : '';
    if (!card.joined) return estimate ? `${estimate[0]!.toUpperCase()}${estimate.slice(1)}` : '';
    return `Cost ${formatUSD(card.costUSD)}${estimate ? ` (${estimate})` : ''}`;
  }
</script>

{#each picked as card (card.forkId)}
  {@const going = card.branches.filter(active).length}
  <section class="fork-card" aria-label="Fork into {card.branches.length} branches">
    <div class="fork-head">
      <span class="fork-title">🌿 Forked into {card.branches.length} branch{card.branches.length === 1 ? '' : 'es'}{card.joined ? ' — joined' : ''}</span>
      {#if costLine(card)}<span class="fork-cost">{costLine(card)}</span>{/if}
      {#if going > 0}
        <button type="button" class="fork-btn" onclick={() => void stopAllBranches(card.forkId)}>Stop all</button>
      {/if}
    </div>
    <ul class="fork-branches">
      {#each card.branches as b, i (i)}
        <li class="fork-branch" aria-label="{b.title}, {STATE_WORD[b.state]}">
          <div class="fork-row">
            <span class="fork-glyph state-{b.state}" aria-hidden="true">{GLYPH[b.state]}</span>
            <span class="fork-branch-title">{b.title}</span>
            <span class="fork-meta">
              {STATE_WORD[b.state]} · {formatElapsed((b.endedAt ?? now) - b.startedAt)}{#if b.costUSD}{' · '}{formatUSD(b.costUSD)}{/if}
            </span>
            <button
              type="button"
              class="fork-btn"
              disabled={!b.conversationId}
              aria-label="Open branch {b.title}"
              onclick={() => void store.openBranchTab(b.conversationId)}
            >Open</button>
            {#if b.state === 'running'}
              <button type="button" class="fork-btn" aria-label="Stop branch {b.title}" onclick={() => void stopBranch(b.conversationId)}>Stop</button>
            {/if}
          </div>
          {#if active(b)}
            {#if card.previews[b.conversationId]}
              <details class="fork-fold">
                <summary>Preview</summary>
                <div class="fork-preview">{card.previews[b.conversationId]}</div>
              </details>
            {/if}
          {:else if b.answer?.trim()}
            <details class="fork-fold">
              <summary>{b.state === 'done' ? 'Answer' : 'What it had written'}</summary>
              <div class="fork-answer">{@html renderMarkdownCached(b.answer)}</div>
            </details>
          {:else if b.note}
            <p class="fork-note">{b.note}</p>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/each}

<style>
  .fork-card {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-inset);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fork-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12px;
  }
  .fork-title { font-weight: 600; color: var(--text); }
  .fork-cost {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    flex: 1;
  }
  .fork-head .fork-btn { margin-left: auto; }
  .fork-branches {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fork-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
  }
  .fork-glyph { color: var(--accent); width: 1em; text-align: center; }
  .fork-glyph.state-stopped,
  .fork-glyph.state-failed { color: var(--text-muted); }
  .fork-branch-title {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .fork-meta {
    flex: 1;
    color: var(--text-muted);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .fork-btn {
    padding: 2px 8px;
    background: var(--bg-button);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11.5px;
    cursor: pointer;
  }
  .fork-btn:hover:not(:disabled) { background: var(--bg-button-hover); }
  .fork-btn:disabled { opacity: 0.5; cursor: default; }
  .fork-fold { margin: 2px 0 0 1.6em; font-size: 12px; }
  .fork-fold summary { color: var(--text-muted); cursor: pointer; }
  .fork-preview {
    white-space: pre-wrap;
    color: var(--text-muted);
    max-height: 8em;
    overflow-y: auto;
    margin-top: 4px;
  }
  .fork-answer {
    color: var(--text);
    line-height: 1.5;
    margin-top: 4px;
  }
  .fork-answer :global(p) { margin: 0.4em 0; }
  .fork-note { margin: 2px 0 0 1.6em; font-size: 12px; color: var(--text-muted); }
</style>
