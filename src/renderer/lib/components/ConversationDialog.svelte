<script lang="ts">
  import { getConversationStore } from '../stores/conversation.svelte';
  import { api } from '../ipc/client';
  import { onMount } from 'svelte';
  import { getSlashCommands } from '../tools/tool-registry';
  import type { ThinkingToolInfo } from '../../../shared/tools/types';
  import { MODEL_OPTIONS, modelLabel } from '../../../shared/tools/models';

  interface Props {
    onClose: () => void;
    onNavigate?: (target: string) => void;
  }

  let { onClose, onNavigate }: Props = $props();

  const conv = getConversationStore();
  let input = $state('');
  let streaming = $state(false);
  let streamedChunks = $state('');
  let messagesEl = $state<HTMLDivElement>();
  let crystallizing = $state(false);
  let crystallizeResult = $state<{ componentCount: number } | null>(null);
  let groundingCache = new Map<string, { grounded: boolean; label?: string; type?: string }>();
  let defaultModel = $state<string | null>(null);

  onMount(async () => {
    try {
      const s = await api.tools.getSettings();
      defaultModel = s.model ?? null;
    } catch { /* settings unavailable — picker still works, "Default" just won't show a name */ }
  });

  async function handleModelChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    await conv.setModel(value || undefined);
  }

  // Parse [[claim: ...]] annotations in assistant output
  function renderAnnotatedContent(text: string): string {
    return text.replace(/\[\[claim:\s*(.+?)\]\]/g, (_match, claim) => {
      const escaped = claim.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<span class="llm-claim" data-claim="${escaped}" title="Checking grounding...">${escaped}</span>`;
    });
  }

  async function checkGrounding(el: HTMLElement) {
    const claim = el.dataset.claim;
    if (!claim) return;

    const cached = groundingCache.get(claim);
    if (cached) {
      applyGroundingState(el, cached);
      return;
    }

    try {
      const results = await api.graph.groundCheck(claim);
      const match = (results as any[])?.[0];
      const state = match
        ? { grounded: true, label: match.label, type: match.type }
        : { grounded: false };
      groundingCache.set(claim, state);
      applyGroundingState(el, state);
    } catch {
      el.title = 'Grounding check failed';
    }
  }

  function applyGroundingState(el: HTMLElement, state: { grounded: boolean; label?: string; type?: string }) {
    if (state.grounded) {
      el.classList.add('grounded');
      el.title = `Grounded: matches "${state.label}" (${state.type})`;
    } else {
      el.classList.add('ungrounded');
      el.title = 'Ungrounded LLM assertion — not found in your knowledge base';
    }
  }
  let showSlashMenu = $state(false);
  let slashFilter = $state('');
  let selectedSlashIndex = $state(0);

  const allSlashCommands = getSlashCommands();

  let filteredCommands = $derived(
    slashFilter
      ? allSlashCommands.filter(t =>
          t.slashCommand!.toLowerCase().includes(slashFilter.toLowerCase()) ||
          t.name.toLowerCase().includes(slashFilter.toLowerCase())
        )
      : allSlashCommands
  );

  function updateSlashMenu() {
    if (input.startsWith('/')) {
      const spaceIdx = input.indexOf(' ');
      if (spaceIdx === -1) {
        slashFilter = input.slice(1);
        showSlashMenu = true;
        selectedSlashIndex = 0;
      } else {
        showSlashMenu = false;
      }
    } else {
      showSlashMenu = false;
    }
  }

  function selectSlashCommand(tool: ThinkingToolInfo) {
    input = tool.slashCommand + ' ';
    showSlashMenu = false;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  onMount(() => {
    api.conversations.onStream((chunk) => {
      streamedChunks += chunk;
      scrollToBottom();
    });
  });

  // Run grounding checks on claim annotations after messages render
  $effect(() => {
    conv.messages; // track dependency
    requestAnimationFrame(() => {
      const claims = messagesEl?.querySelectorAll('.llm-claim:not(.grounded):not(.ungrounded)');
      claims?.forEach((el) => checkGrounding(el as HTMLElement));
    });
  });

  function hostOfUrl(url: string): string {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !conv.active || streaming) return;

    input = '';
    showSlashMenu = false;
    streaming = true;
    streamedChunks = '';

    // Slash command dispatch
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const cmd = spaceIdx >= 0 ? text.slice(0, spaceIdx) : text;
      const argText = spaceIdx >= 0 ? text.slice(spaceIdx + 1).trim() : '';
      try {
        await api.conversations.slashCommand(conv.active.id, cmd, argText);
        await conv.resumeConversation(conv.active.id);
      } catch (e) {
        if (String(e).includes('abort')) return;
        console.error('[conversation] slash command error:', e);
      } finally {
        streaming = false;
        streamedChunks = '';
        scrollToBottom();
      }
      return;
    }

    try {
      const ctx = conv.active.contextBundle;
      let system = 'You are a thoughtful epistemic partner helping the user analyze and develop ideas in their knowledge base. When you make a substantive claim, assertion, or finding, wrap it in [[claim: your claim here]] notation so it can be checked against the knowledge base.';
      if (ctx.noteContent) {
        system += `\n\nCurrent note content:\n${ctx.noteContent}`;
      }
      if (ctx.triggerNode) {
        system += `\n\nThis conversation was triggered by: ${ctx.triggerNode.label} (${ctx.triggerNode.type})`;
      }

      await api.conversations.send(conv.active.id, text, system);
      // Reload the conversation to get the persisted assistant message
      await conv.resumeConversation(conv.active.id);
    } catch (e) {
      if (String(e).includes('abort')) return; // cancelled
      console.error('[conversation] send error:', e);
    } finally {
      streaming = false;
      streamedChunks = '';
      scrollToBottom();
    }
  }

  async function handleCancel() {
    await api.conversations.cancel();
    streaming = false;
    streamedChunks = '';
  }

  async function handleResolve() {
    await conv.resolve();
    onClose();
  }

  async function handleAbandon() {
    await conv.abandon();
    onClose();
  }

  async function handleCrystallize(text: string) {
    if (!conv.active || crystallizing) return;
    crystallizing = true;
    crystallizeResult = null;
    try {
      const result = await api.conversations.crystallize(text, conv.active.id);
      crystallizeResult = result;
      if (result.componentCount > 0) {
        // Brief notification, then clear
        setTimeout(() => { crystallizeResult = null; }, 4000);
      }
    } catch (e) {
      console.error('[crystallize] error:', e);
    } finally {
      crystallizing = false;
    }
  }

  async function handleCrystallizeSelection() {
    const selection = window.getSelection()?.toString()?.trim();
    if (selection && conv.active) {
      await handleCrystallize(selection);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); selectedSlashIndex = Math.min(selectedSlashIndex + 1, filteredCommands.length - 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); selectedSlashIndex = Math.max(selectedSlashIndex - 1, 0); return; }
      if ((e.key === 'Tab' || e.key === 'Enter') && filteredCommands.length > 0) {
        e.preventDefault();
        if (filteredCommands[selectedSlashIndex]) selectSlashCommand(filteredCommands[selectedSlashIndex]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); showSlashMenu = false; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

{#if conv.active}
  <div class="conversation-dialog">
    <div class="conv-header">
      <div class="conv-title">
        {#if conv.active.contextBundle.triggerNode}
          <span class="conv-trigger">{conv.active.contextBundle.triggerNode.label}</span>
        {:else if conv.active.contextBundle.notePath}
          <span class="conv-trigger">{conv.active.contextBundle.notePath}</span>
        {:else}
          <span class="conv-trigger">Conversation</span>
        {/if}
        <span class="conv-status">{conv.active.status}</span>
      </div>
      <div class="conv-actions">
        <select
          class="conv-model"
          value={conv.active.model ?? ''}
          onchange={handleModelChange}
          title="Model used for this conversation"
        >
          <option value="">{defaultModel ? `Default (${modelLabel(defaultModel)})` : 'Default'}</option>
          {#each MODEL_OPTIONS.filter((m) => m.value !== defaultModel) as m}
            <option value={m.value}>{m.label}</option>
          {/each}
        </select>
        <button class="conv-btn" onclick={handleCrystallizeSelection} disabled={crystallizing} title="File selected text as thought components">File Selection</button>
        <button class="conv-btn" onclick={handleResolve} title="Resolve — file results to graph">Resolve</button>
        <button class="conv-btn" onclick={handleAbandon} title="Abandon — close without filing">Abandon</button>
        <button class="conv-btn close" onclick={onClose} title="Hide (conversation stays active)">&#x2715;</button>
      </div>
    </div>

    {#if conv.active.contextBundle.neighborhood && conv.active.contextBundle.neighborhood.length > 0}
      <div class="context-rail">
        <span class="context-label">Context:</span>
        {#each conv.active.contextBundle.neighborhood as node}
          <button
            class="context-chip"
            onclick={() => onNavigate?.(node.uri)}
            title="{node.relation}: {node.label}"
          >{node.label}</button>
        {/each}
      </div>
    {/if}

    <div class="conv-messages" bind:this={messagesEl}>
      {#each conv.messages as msg}
        <div class="conv-msg {msg.role}">
          <div class="msg-header">
            <span class="msg-role">{msg.role}</span>
          </div>
          {#if msg.role === 'assistant'}
            <div class="msg-content">{@html renderAnnotatedContent(msg.content)}</div>
            {#if msg.citations && msg.citations.length > 0}
              <ol class="citations">
                {#each msg.citations as cite, i}
                  <li>
                    <button
                      class="citation-link"
                      onclick={() => api.shell.openExternal(cite.url)}
                      title={cite.citedText}
                    >
                      <span class="citation-num">[{i + 1}]</span>
                      <span class="citation-title">{cite.title ?? hostOfUrl(cite.url)}</span>
                      <span class="citation-host">{hostOfUrl(cite.url)}</span>
                    </button>
                  </li>
                {/each}
              </ol>
            {/if}
            <div class="msg-actions">
              <button class="msg-action-btn" onclick={() => { input = 'Tell me more about this.'; handleSend(); }} title="Continue exploring this topic">Explore Further</button>
              <button class="msg-action-btn" onclick={() => handleCrystallize(msg.content)} disabled={crystallizing} title="Extract thought components">{crystallizing ? 'Filing...' : 'File This'}</button>
              <button class="msg-action-btn" onclick={() => handleCrystallize(msg.content)} disabled={crystallizing} title="Flag for later review">Flag for Later</button>
            </div>
          {:else}
            <div class="msg-content">{msg.content}</div>
          {/if}
        </div>
      {/each}
      {#if streaming && streamedChunks}
        <div class="conv-msg assistant streaming">
          <span class="msg-role">assistant</span>
          <div class="msg-content">{streamedChunks}</div>
        </div>
      {/if}
      {#if crystallizeResult}
        <div class="crystallize-notice">
          Filed {crystallizeResult.componentCount} component{crystallizeResult.componentCount !== 1 ? 's' : ''} as proposal{crystallizeResult.componentCount !== 1 ? 's' : ''} — review in Proposals panel
        </div>
      {/if}
    </div>

    {#if showSlashMenu && filteredCommands.length > 0}
      <div class="slash-menu">
        {#each filteredCommands as cmd, i}
          <button class="slash-item" class:selected={i === selectedSlashIndex} onclick={() => selectSlashCommand(cmd)}>
            <span class="slash-cmd">{cmd.slashCommand}</span>
            <span class="slash-desc">{cmd.description}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="conv-input">
      <textarea
        bind:value={input}
        onkeydown={handleKeydown}
        oninput={updateSlashMenu}
        placeholder="Type a message or / for commands... (Enter to send)"
        rows="2"
        disabled={streaming || conv.active.status !== 'active'}
      ></textarea>
      {#if streaming}
        <button class="send-btn" onclick={handleCancel}>Cancel</button>
      {:else}
        <button class="send-btn" onclick={handleSend} disabled={!input.trim()}>Send</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .conversation-dialog {
    border-top: 1px solid var(--border);
    background: var(--bg-sidebar);
    display: flex;
    flex-direction: column;
    max-height: 60%;
    min-height: 200px;
  }

  .conv-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: var(--bg-toolbar, var(--bg-titlebar));
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .conv-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .conv-trigger {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }

  .conv-status {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .conv-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .conv-model {
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    max-width: 180px;
  }

  .conv-btn {
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
  }

  .conv-btn:hover { background: var(--bg-button-hover); }
  .conv-btn.close { border: none; background: none; color: var(--text-muted); font-size: 13px; }
  .conv-btn.close:hover { color: var(--text); }

  .context-rail {
    display: flex;
    gap: 4px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
    align-items: center;
  }

  .context-label {
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .context-chip {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: none;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }

  .context-chip:hover { background: var(--bg-button); }

  .conv-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .conv-msg {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .msg-role {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .conv-msg.user .msg-role { color: var(--accent); }
  .conv-msg.assistant .msg-role { color: var(--text-muted); }
  .conv-msg.system .msg-role { color: var(--text-muted); font-style: italic; }

  .msg-content {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .conv-msg.system .msg-content {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  .msg-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-btn {
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
  }

  .file-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .file-btn:disabled { opacity: 0.4; cursor: default; }

  .crystallize-notice {
    padding: 6px 10px;
    background: var(--bg-button);
    border-radius: 4px;
    font-size: 12px;
    color: var(--accent);
  }

  .citations {
    list-style: none;
    margin: 8px 0 4px 0;
    padding: 6px 10px;
    border-left: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .citation-link {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 2px 0;
    border: none;
    background: none;
    color: var(--text);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .citation-link:hover .citation-title {
    text-decoration: underline;
  }

  .citation-num {
    color: var(--text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .citation-title {
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .citation-host {
    color: var(--text-muted);
    font-size: 10px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .msg-actions {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }

  .msg-action-btn {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
  }

  .msg-action-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .msg-action-btn:disabled { opacity: 0.4; cursor: default; }

  .msg-content :global(.llm-claim) {
    border-bottom: 1px dashed var(--text-muted);
    cursor: help;
    transition: border-color 0.15s;
  }

  .msg-content :global(.llm-claim.grounded) {
    border-bottom-color: #a6e3a1;
    color: #a6e3a1;
  }

  .msg-content :global(.llm-claim.ungrounded) {
    border-bottom-color: #fab387;
    border-bottom-style: dotted;
  }

  .streaming .msg-content {
    opacity: 0.8;
  }

  .slash-menu {
    border-top: 1px solid var(--border);
    background: var(--bg-sidebar);
    max-height: 150px;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .slash-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 5px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .slash-item:hover, .slash-item.selected { background: var(--bg-button); }

  .slash-cmd {
    font-weight: 600;
    color: var(--accent);
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
  }

  .slash-desc {
    color: var(--text-muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conv-input {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .conv-input textarea {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    resize: none;
  }

  .conv-input textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .send-btn {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg);
    font-size: 12px;
    cursor: pointer;
    align-self: flex-end;
  }

  .send-btn:hover { opacity: 0.9; }
  .send-btn:disabled { opacity: 0.4; cursor: default; }
</style>
