<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import { getConversationsStore, type TabRuntime } from '../../stores/conversations.svelte';
  import { getVoiceStore } from '../../voice/voice.svelte';
  import { voiceSettings } from '../../voice/voice-settings.svelte';
  import { getSlashCommands } from '../../tools/tool-registry';
  import { slashQueryFromComposer, buildSlashMenu, type SlashMenuItem } from '../../conversations/slash-commands';
  import { costBadgeFor } from '../../conversations/conversation-cost';

  interface Props {
    /** The active conversation tab (non-null: the panel renders the composer
     *  only inside `{#if store.activeTab}`). */
    tab: TabRuntime;
    /** Active editor note, forwarded into each user-turn payload on send. */
    currentNotePath: string | null;
    /** Invoke a skill by id from the `/` launcher (#648). */
    onInvokeSkill?: ((toolId: string) => void) | undefined;
  }

  let { tab, currentNotePath, onInvokeSkill }: Props = $props();

  const store = getConversationsStore();
  const voice = getVoiceStore();

  let composerEl = $state<HTMLTextAreaElement>();

  const costBadge = $derived(costBadgeFor(tab.conversation.messages));

  /** Focus the composer textarea. Called by the panel after opening a new tab. */
  export function focus(): void {
    composerEl?.focus();
  }

  async function handleSend() {
    const text = tab.composer;
    await store.send(text, currentNotePath ?? undefined);
  }

  // ── Dictation (#voice) ──────────────────────────────────────────────────
  // The mic toggles recording; stopping transcribes the clip locally (Whisper
  // in a renderer worker) and appends the text to the composer. Audio never
  // leaves the process — only the model weights are fetched, once.
  async function toggleDictation() {
    if (voice.recording) {
      const text = await voice.stopAndTranscribe();
      if (text) {
        const sep = tab.composer && !/\s$/.test(tab.composer) ? ' ' : '';
        store.setComposer(tab.composer + sep + text);
        await tick();
        composerEl?.focus();
      }
    } else {
      await voice.start();
    }
  }

  // ── Slash-command launcher (#648, #822) ─────────────────────────────────
  // Typing a single leading `/token` in the composer opens a filtered menu of
  // reserved built-in commands (#822) and skills that declared a slashCommand.
  // Built-ins resolve first and route to an app-level handler; skills invoke
  // exactly like the menu entry (host's onInvokeSkill → handleToolInvoke). The
  // skill list is a snapshot of the registry (populated at startup, before the
  // panel mounts).
  let slashOpen = $state(false);
  let slashIndex = $state(0);
  let slashItems = $state<SlashMenuItem[]>([]);

  function refreshSlash(text: string) {
    const q = slashQueryFromComposer(text);
    if (q === null) { slashOpen = false; return; }
    // Read the registry lazily — skills register at app startup, which may race
    // this panel's mount; reading on open guarantees the populated list.
    slashItems = buildSlashMenu(getSlashCommands(), q);
    slashIndex = 0;
    slashOpen = slashItems.length > 0;
  }

  function selectSlash(item: SlashMenuItem) {
    slashOpen = false;
    store.setComposer('');
    if (item.kind === 'builtin') {
      void store.runBuiltinCommand(item.command.name);
    } else {
      onInvokeSkill?.(item.tool.id);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (slashOpen && slashItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashIndex = (slashIndex + 1) % slashItems.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashIndex = (slashIndex - 1 + slashItems.length) % slashItems.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectSlash(slashItems[slashIndex]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        slashOpen = false;
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handleComposerInput(e: Event) {
    const value = (e.currentTarget as HTMLTextAreaElement).value;
    store.setComposer(value);
    refreshSlash(value);
  }
</script>

<div class="composer">
  <div class="composer-card">
    {#if slashOpen}
      <div class="slash-menu" role="listbox">
        {#each slashItems as item, si (item.kind === 'builtin' ? `b:${item.command.name}` : `s:${item.tool.id}`)}
          <button
            type="button"
            role="option"
            aria-selected={si === slashIndex}
            class="slash-item"
            class:active={si === slashIndex}
            onmousedown={(e) => { e.preventDefault(); selectSlash(item); }}
            onmouseenter={() => (slashIndex = si)}
          >
            {#if item.kind === 'builtin'}
              <span class="slash-cmd">{item.command.slashCommand}</span>
              <span class="slash-name">built-in</span>
              <span class="slash-desc">{item.command.description}</span>
            {:else}
              <span class="slash-cmd">{item.tool.slashCommand}</span>
              <span class="slash-name">{item.tool.name}</span>
              <span class="slash-desc">{item.tool.description}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
    <textarea
      bind:this={composerEl}
      value={tab.composer}
      oninput={handleComposerInput}
      onkeydown={handleKeydown}
      placeholder={tab.conversation.contextBundle.notePath ? 'Ask about this note, or type / for skills…' : 'Ask anything, or type / for skills…'}
      rows="2"
      disabled={tab.streaming}
    ></textarea>
    <div class="composer-footer">
      {#if tab.conversation.contextBundle.notePath}
        <Icon name="notes" size={12} color="var(--text-faint)" />
        <span class="composer-context">{tab.conversation.contextBundle.notePath}</span>
      {/if}
      <span class="composer-spacer"></span>
      {#if voiceSettings.enabled}
        {#if voice.surface === 'composer'}
          {#if voice.status === 'transcribing'}
            <span class="composer-voice">Transcribing…</span>
          {:else if voice.modelProgress}
            <span class="composer-voice">{voice.modelProgress}</span>
          {:else if voice.error}
            <span class="composer-voice" title={voice.error}>Mic unavailable</span>
          {:else if voice.recording}
            <span class="composer-voice">Listening…</span>
          {/if}
        {/if}
        <button
          type="button"
          class="mic-btn"
          class:recording={voice.recording && voice.surface === 'composer'}
          onclick={toggleDictation}
          disabled={tab.streaming || voice.status === 'transcribing' || (voice.busy && voice.surface !== 'composer')}
          title={voice.recording ? 'Stop & transcribe' : 'Dictate'}
          aria-label={voice.recording ? 'Stop dictation and transcribe' : 'Start dictation'}
        >
          <Icon name="mic" size={13} />
        </button>
      {/if}
      {#if costBadge}
        <span
          class="composer-cost"
          title={costBadge.title}
        >{costBadge.text}</span>
      {/if}
      <span class="composer-hint">⏎ send · ⇧⏎ newline</span>
      {#if tab.streaming}
        <button type="button" class="send-btn" onclick={() => store.cancel()}>Cancel</button>
      {:else}
        <button type="button" class="send-btn" onclick={handleSend} disabled={!tab.composer.trim()}>
          <Icon name="send" size={11} />
          Send
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .composer {
    display: flex;
    padding: 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  /* Composer card (§9.3) — bordered card with the textarea + a
     context-chip row + Send button (accent, with leading send icon). */
  .composer-card {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .composer-card:focus-within {
    border-color: var(--accent);
  }

  /* Slash-command launcher (#648) — floats above the composer. */
  .slash-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    max-height: 220px;
    overflow-y: auto;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 12;
  }
  .slash-item {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: "cmd name" "cmd desc";
    column-gap: 8px;
    align-items: baseline;
    text-align: left;
    padding: 6px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .slash-item.active { background: var(--bg-button); }
  .slash-cmd {
    grid-area: cmd;
    align-self: center;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--accent);
    white-space: nowrap;
  }
  .slash-name { grid-area: name; font-size: 13px; }
  .slash-desc {
    grid-area: desc;
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .composer textarea {
    padding: 10px 12px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-sans);
    resize: none;
    outline: none;
    min-height: 40px;
  }
  .composer-footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 12px;
    border-top: 1px solid var(--border);
  }
  .composer-context {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .composer-spacer {
    flex: 1;
  }
  .composer-hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .composer-cost {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    margin-right: 10px;
    cursor: default;
  }

  .composer-voice {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
    margin-right: 8px;
  }
  .mic-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    margin-right: 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .mic-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-button); }
  .mic-btn:disabled { opacity: 0.4; cursor: default; }
  /* Recording: tint with the accent and breathe so it's clearly live —
     no red/danger styling, per the house rules. */
  .mic-btn.recording {
    color: var(--accent);
    animation: mic-pulse 1.4s ease-in-out infinite;
  }
  @keyframes mic-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  .send-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 12px;
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .send-btn:hover { opacity: 0.9; }
  .send-btn:disabled { opacity: 0.4; cursor: default; }
</style>
