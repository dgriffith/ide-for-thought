<script lang="ts">
  import { getConversationStore } from '../stores/conversation.svelte';
  import { api } from '../ipc/client';
  import { onMount } from 'svelte';

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

  async function handleSend() {
    const text = input.trim();
    if (!text || !conv.active || streaming) return;

    input = '';
    streaming = true;
    streamedChunks = '';

    try {
      // Build a system prompt from context bundle
      const ctx = conv.active.contextBundle;
      let system = 'You are a thoughtful epistemic partner helping the user analyze and develop ideas in their knowledge base.';
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
            {#if msg.role === 'assistant'}
              <button
                class="file-btn"
                onclick={() => handleCrystallize(msg.content)}
                disabled={crystallizing}
                title="Extract thought components from this message"
              >{crystallizing ? 'Filing...' : 'File This'}</button>
            {/if}
          </div>
          <div class="msg-content">{msg.content}</div>
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

    <div class="conv-input">
      <textarea
        bind:value={input}
        onkeydown={handleKeydown}
        placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
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

  .streaming .msg-content {
    opacity: 0.8;
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
