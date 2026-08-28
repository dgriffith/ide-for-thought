<script lang="ts">
  /**
   * Command palette (#463). Fuzzy-matches across the host-supplied
   * command registry; renders results with recently-used floated
   * to the top.
   *
   * No background dim (per spec). The editor stays visible behind
   * the input so the user can keep their place.
   */
  import type { Command } from '../command-palette/types';
  import { scoreCommand } from '../command-palette/scoring';
  import { loadRecent, recordRecent } from '../command-palette/recent';
  import { trapFocus } from '../trap-focus';
  import Icon from './Icon.svelte';
  import Kbd from './ui/Kbd.svelte';

  interface Props {
    commands: Command[];
    onClose: () => void;
  }

  let { commands, onClose }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement>();

  /** Recently-used ids snapshot at open time. Pinned to the top
   *  when no query, then receive a small ranking boost while the
   *  user is typing. */
  const recentIds = $state<string[]>(loadRecent());
  const recentSet = $derived(new Set(recentIds));

  /** Per-command score + recency bonus, sorted desc. */
  const results = $derived.by(() => {
    const q = query.trim();
    if (!q) {
      // No query → show every command, recent first (in
      // most-recently-used order), then the rest alphabetically.
      const recents: Command[] = [];
      for (const id of recentIds) {
        const c = commands.find((x) => x.id === id);
        if (c) recents.push(c);
      }
      const remaining = commands
        .filter((c) => !recentSet.has(c.id))
        .sort((a, b) => a.title.localeCompare(b.title));
      return [...recents, ...remaining];
    }
    const scored: { cmd: Command; score: number }[] = [];
    for (const cmd of commands) {
      let score = scoreCommand(cmd.title, cmd.category, q);
      if (score === 0) continue;
      // Small recency bonus so commonly-used commands surface
      // ahead of equally-matching siblings.
      if (recentSet.has(cmd.id)) score += 5;
      scored.push({ cmd, score });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.cmd.title.localeCompare(b.cmd.title);
    });
    return scored.map((s) => s.cmd);
  });

  $effect(() => {
    results;
    selectedIndex = 0;
  });

  $effect(() => { inputEl?.focus(); });
  $effect(() => {
    const el = document.querySelector('.cp-results .selected');
    el?.scrollIntoView({ block: 'nearest' });
  });

  async function pick(cmd: Command): Promise<void> {
    if (!cmd.enabled) return;
    recordRecent(cmd.id);
    onClose();
    // Run after closing so the underlying editor focus returns
    // immediately — matches Obsidian / VS Code feel.
    try { await cmd.run(); }
    catch (err) { console.error(`[command-palette] command "${cmd.id}" failed:`, err); }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, Math.max(0, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[selectedIndex];
      if (picked) void pick(picked);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  /** Whether the row at the given index should render as the
   *  "recent" subhead — true for the first row when no query and
   *  recents exist. We don't render a heading per-row; just a
   *  border between the recent block and the rest. */
  function isFirstNonRecent(i: number): boolean {
    if (query.trim() || recentIds.length === 0) return false;
    return i === recentIds.filter((id) => commands.some((c) => c.id === id)).length;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay"
  onkeydown={handleKeydown}
  onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Command palette" use:trapFocus>
    <div class="input-row">
      <Icon name="search" size={14} color="var(--text-muted)" />
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        class="input"
        placeholder="Type a command…"
      />
      <Kbd>⌘ ⇧ P</Kbd>
    </div>

    {#if results.length > 0}
      <ul class="cp-results">
        {#each results as cmd, i (cmd.id)}
          <li class:divider-above={isFirstNonRecent(i)}>
            <button
              type="button"
              class="result-item"
              class:selected={i === selectedIndex}
              class:disabled={!cmd.enabled}
              disabled={!cmd.enabled}
              onclick={() => pick(cmd)}
              onmouseenter={() => { selectedIndex = i; }}
            >
              <span class="result-body">
                <span class="result-title">{cmd.title}</span>
                <span class="result-category">{cmd.category}</span>
              </span>
              {#if cmd.keybinding}
                <Kbd>{cmd.keybinding}</Kbd>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="no-results">No commands match "{query}"</div>
    {/if}

    <footer class="palette-footer">
      <span class="kbd-hint">↑↓ navigate · ↵ run · esc close</span>
      <span class="result-count">
        {#if results.length > 0}
          <span class="nums">{results.length}</span>
          {results.length === 1 ? 'command' : 'commands'}
        {/if}
      </span>
    </footer>
  </div>
</div>

<style>
  /* Per spec: no background dim. The overlay catches mouse-outside
     clicks but doesn't darken the editor behind it — keeps the user's
     place visible while the palette is open. */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 15vh 32px 32px;
    pointer-events: auto;
  }
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    width: 640px;
    max-width: 100%;
    max-height: 60vh;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    color: var(--text);
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 16px;
    outline: none;
    padding: 0;
  }
  .input::placeholder { color: var(--text-muted); }
  .cp-results {
    list-style: none;
    overflow-y: auto;
    padding: 4px 0;
    margin: 0;
    flex: 1;
  }
  .cp-results li.divider-above {
    border-top: 1px solid var(--border);
    margin-top: 4px;
    padding-top: 4px;
  }
  .result-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 16px;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .result-item.selected {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    border-left-color: var(--accent);
  }
  .result-item.disabled {
    color: var(--text-faint);
    cursor: default;
  }
  .result-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
    overflow: hidden;
  }
  .result-title {
    font-size: 13.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-item.disabled .result-title { color: var(--text-faint); }
  .result-item.selected .result-title { font-weight: 500; }
  .result-category {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .no-results {
    padding: 24px;
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
    font-style: italic;
  }
  .palette-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .kbd-hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .result-count { font-size: 10.5px; color: var(--text-faint); }
  .nums {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
</style>
