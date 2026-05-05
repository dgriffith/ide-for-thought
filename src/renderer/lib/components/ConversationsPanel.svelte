<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getConversationsStore } from '../stores/conversations.svelte';
  import { api } from '../ipc/client';
  import MarkdownIt from 'markdown-it';
  import { MODEL_OPTIONS, modelLabel } from '../../../shared/tools/models';
  import type { ConversationDraft } from '../../../shared/conversation-drafts';

  // Lightweight markdown-it for assistant message rendering. Mirrors the
  // configuration in the legacy ConversationDialog so prose renders the
  // same way during the parallel-mount window.
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: true,
  });

  interface Props {
    /** Path of the currently active note in the editor, or null. Pushed
     *  into each user-turn payload so the agent can resolve "this note"
     *  against whatever the user is looking at, even if it differs from
     *  the conversation's origin. */
    currentNotePath: string | null;
  }

  let { currentNotePath }: Props = $props();

  const store = getConversationsStore();

  let composerEl = $state<HTMLTextAreaElement>();
  let scrollEl = $state<HTMLDivElement>();
  let expandedDraftIds = $state<Set<string>>(new Set());
  let resizing = $state(false);
  // Project-default model — used to label the "Default" option so the
  // user can see which concrete model "default" resolves to.
  let defaultModel = $state<string | null>(null);
  // Width-of-tab-bar overflow handling deferred to polish (#505).

  onMount(async () => {
    // The {#key notebase.meta.rootPath} block at the mount site remounts
    // this component on project switch; reset() clears stale tabs from
    // the previous project and reloads from the new project's state.
    await store.reset();
    try {
      const s = await api.tools.getSettings();
      defaultModel = s.model ?? null;
    } catch { /* settings unavailable; picker still works without the label */ }
  });

  async function handleModelChange(tabId: string, e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    await store.setModel(tabId, value || undefined);
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  // Auto-scroll on new content for the active tab.
  $effect(() => {
    const tab = store.activeTab;
    if (!tab) return;
    // Track the streaming buffer + the message count so the effect re-runs
    // both as chunks arrive and when the final assistant turn lands.
    void tab.streamedChunks;
    void tab.conversation.messages.length;
    scrollToBottom();
  });

  async function handleNewTab() {
    await store.openFreeform(currentNotePath ?? undefined);
    await tick();
    composerEl?.focus();
  }

  async function handleCloseTab(id: string, e: Event) {
    e.stopPropagation();
    await store.closeTab(id);
  }

  async function handleSend() {
    const tab = store.activeTab;
    if (!tab) return;
    const text = tab.composer;
    await store.send(text, currentNotePath ?? undefined);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handleComposerInput(e: Event) {
    store.setComposer((e.currentTarget as HTMLTextAreaElement).value);
  }

  // Resize: track pointer between mousedown on the handle and mouseup
  // anywhere. We measure from the panel's bounding rect bottom so the
  // pointer stays under the handle as the user drags.
  let panelEl = $state<HTMLDivElement>();
  function startResize(e: PointerEvent) {
    e.preventDefault();
    resizing = true;
    const startY = e.clientY;
    const startHeight = store.height;
    function move(ev: PointerEvent) {
      const delta = startY - ev.clientY;
      store.setHeight(startHeight + delta);
    }
    function up() {
      resizing = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function tabTitle(tab: { title: string | null; conversation: { messages: { role: string; content: string }[] } }): string {
    if (tab.title) return tab.title;
    const firstUser = tab.conversation.messages.find((m) => m.role === 'user');
    if (!firstUser) return 'New conversation';
    const flat = firstUser.content.replace(/\s+/g, ' ').trim();
    if (!flat) return 'New conversation';
    // 60-char auto-title heuristic. Truncates on a word boundary when one
    // exists in the last quarter so we don't slice mid-word for the common
    // case of a 60-80 char first turn.
    if (flat.length <= 60) return flat;
    const window = flat.slice(0, 60);
    const lastSpace = window.lastIndexOf(' ');
    return (lastSpace > 45 ? window.slice(0, lastSpace) : window) + '…';
  }

  let pendingAnswerText = $state('');

  async function submitAnswer(tabId: string, answer: string) {
    const text = answer.trim();
    if (!text) return;
    pendingAnswerText = '';
    await store.answerQuestion(tabId, text);
  }

  function toggleDraftPath(key: string) {
    const next = new Set(expandedDraftIds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedDraftIds = next;
  }

  async function handleApprove(tabId: string, draft: ConversationDraft) {
    try {
      await store.approveDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve failed:', e);
    }
  }

  function handleDiscard(tabId: string, draftId: string) {
    store.discardDraft(tabId, draftId);
  }

  function hostOf(url: string): string {
    try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
  }
</script>

{#if store.visible}
  <div
    class="conv-panel"
    class:resizing
    style="height: {store.height}px;"
    bind:this={panelEl}
  >
    <div class="resize-handle" onpointerdown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize conversations panel"></div>

    <div class="header">
      <div class="tab-strip">
        {#each store.tabs as tab (tab.id)}
          <div class="tab" class:active={tab.id === store.activeTabId}>
            <button
              type="button"
              class="tab-label-btn"
              onclick={() => store.setActiveTab(tab.id)}
              title={tabTitle(tab)}
            >{tabTitle(tab)}</button>
            <button
              type="button"
              class="tab-close"
              aria-label="Close conversation"
              onclick={(e) => handleCloseTab(tab.id, e)}
            >&#x2715;</button>
          </div>
        {/each}
        <button type="button" class="new-tab" onclick={handleNewTab} title="New conversation">+</button>
      </div>
      <div class="header-controls">
        <button type="button" class="hide-btn" onclick={store.hide} title="Hide panel (does not archive any conversations)">&#x2715;</button>
      </div>
    </div>

    {#if store.activeTab}
      {@const tab = store.activeTab}
      <div class="content">
        <div class="context-rail">
          {#if tab.conversation.contextBundle.notePath}
            <span class="context-origin" title="Conversation origin note">From: {tab.conversation.contextBundle.notePath}</span>
          {:else}
            <span class="context-origin">Freeform conversation</span>
          {/if}
          {#if currentNotePath && currentNotePath !== tab.conversation.contextBundle.notePath}
            <span class="context-current" title="Note currently open in the editor — agent sees this with each turn">Active: {currentNotePath}</span>
          {/if}
          <select
            class="model-picker"
            value={tab.conversation.model ?? ''}
            onchange={(e) => handleModelChange(tab.id, e)}
            title="Model used for this conversation"
          >
            <option value="">{defaultModel ? `Default (${modelLabel(defaultModel)})` : 'Default'}</option>
            {#each MODEL_OPTIONS.filter((m) => m.value !== defaultModel) as m}
              <option value={m.value}>{m.label}</option>
            {/each}
          </select>
        </div>

        <div class="messages" bind:this={scrollEl}>
          {#each tab.conversation.messages as msg}
            {#if msg.role !== 'system'}
              <div class="msg {msg.role}">
                <div class="msg-role">{msg.role}</div>
                {#if msg.role === 'assistant'}
                  <div class="msg-content">{@html md.render(msg.content)}</div>
                  {#if msg.citations && msg.citations.length > 0}
                    <ol class="citations">
                      {#each msg.citations as cite, i}
                        <li>
                          <button type="button" class="citation-link" onclick={() => api.shell.openExternal(cite.url)} title={cite.citedText}>
                            <span class="citation-num">[{i + 1}]</span>
                            <span class="citation-title">{cite.title ?? hostOf(cite.url)}</span>
                            <span class="citation-host">{hostOf(cite.url)}</span>
                          </button>
                        </li>
                      {/each}
                    </ol>
                  {/if}
                {:else}
                  <div class="msg-content">{msg.content}</div>
                {/if}
              </div>
            {/if}
          {/each}

          {#if tab.streaming && tab.streamedChunks}
            <div class="msg assistant streaming">
              <div class="msg-role">assistant</div>
              <div class="msg-content">{tab.streamedChunks}</div>
            </div>
          {/if}

          {#if tab.pendingQuestion}
            <div class="ask-user-card">
              <div class="ask-user-q">{tab.pendingQuestion.question}</div>
              {#if tab.pendingQuestion.choices && tab.pendingQuestion.choices.length > 0}
                <div class="ask-user-choices">
                  {#each tab.pendingQuestion.choices as choice}
                    <button type="button" class="ask-user-chip" onclick={() => submitAnswer(tab.id, choice)}>{choice}</button>
                  {/each}
                </div>
              {/if}
              <div class="ask-user-input-row">
                <input
                  type="text"
                  bind:value={pendingAnswerText}
                  onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitAnswer(tab.id, pendingAnswerText); } }}
                  placeholder="Type your answer (Enter to send)"
                />
                <button type="button" class="ask-user-send" onclick={() => submitAnswer(tab.id, pendingAnswerText)} disabled={!pendingAnswerText.trim()}>Reply</button>
              </div>
            </div>
          {/if}

          {#if tab.drafts.length > 0}
            <div class="drafts">
              <div class="drafts-label">Proposed by the assistant — review and approve:</div>
              {#each tab.drafts as draft (draft.draftId)}
                <div class="draft-card">
                  <div class="draft-summary">
                    <strong>{draft.payloads.length} note{draft.payloads.length === 1 ? '' : 's'}</strong>
                    <span class="draft-note">{draft.note}</span>
                  </div>
                  <ul class="draft-paths">
                    {#each draft.payloads as p}
                      {@const key = draft.draftId + ':' + p.relativePath}
                      <li>
                        <button type="button" class="draft-path-btn" onclick={() => toggleDraftPath(key)}>
                          <span class="draft-path">{p.relativePath}</span>
                          <span class="draft-toggle">{expandedDraftIds.has(key) ? '▾' : '▸'}</span>
                        </button>
                        {#if expandedDraftIds.has(key)}
                          <pre class="draft-preview">{p.content}</pre>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                  <div class="draft-actions">
                    <button type="button" class="draft-btn primary" onclick={() => handleApprove(tab.id, draft)}>Approve &amp; file</button>
                    <button type="button" class="draft-btn" onclick={() => handleDiscard(tab.id, draft.draftId)}>Discard</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="composer">
          <textarea
            bind:this={composerEl}
            value={tab.composer}
            oninput={handleComposerInput}
            onkeydown={handleKeydown}
            placeholder="Type a message... (Enter to send, Shift+Enter newline)"
            rows="2"
            disabled={tab.streaming}
          ></textarea>
          {#if tab.streaming}
            <button type="button" class="send-btn" onclick={() => store.cancel()}>Cancel</button>
          {:else}
            <button type="button" class="send-btn" onclick={handleSend} disabled={!tab.composer.trim()}>Send</button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty">
        <p>No active conversation.</p>
        <button type="button" class="empty-action" onclick={handleNewTab}>Start a conversation</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .conv-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
    /* Hard upper cap so the inline `height: <px>` style can't push the
       editor area to zero on small windows. The store also clamps to
       1200px, but viewport is the real ceiling. */
    max-height: 80vh;
  }
  .conv-panel.resizing {
    user-select: none;
  }
  .resize-handle {
    height: 4px;
    cursor: ns-resize;
    background: transparent;
    flex-shrink: 0;
  }
  .resize-handle:hover {
    background: var(--accent);
    opacity: 0.5;
  }

  .header {
    display: flex;
    align-items: stretch;
    background: var(--bg-toolbar, var(--bg-titlebar));
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 28px;
  }
  .tab-strip {
    display: flex;
    flex: 1;
    overflow-x: auto;
    align-items: stretch;
  }
  .tab {
    display: flex;
    align-items: stretch;
    border-right: 1px solid var(--border);
    max-width: 220px;
    color: var(--text-muted);
  }
  .tab:hover { color: var(--text); background: var(--bg-button); }
  .tab.active {
    color: var(--text);
    background: var(--bg);
    border-bottom: 2px solid var(--accent);
  }
  .tab-label-btn {
    flex: 1;
    border: none;
    background: none;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
    padding: 4px 6px 4px 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    margin-right: 4px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
    border-radius: 2px;
  }
  .tab-close:hover { background: var(--bg-button-hover, var(--bg-button)); color: var(--text); }

  .new-tab {
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 0 10px;
    border-right: 1px solid var(--border);
  }
  .new-tab:hover { color: var(--text); background: var(--bg-button); }

  .header-controls {
    display: flex;
    align-items: center;
    padding: 0 6px;
  }
  .hide-btn {
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 3px;
  }
  .hide-btn:hover { background: var(--bg-button); color: var(--text); }

  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .context-rail {
    display: flex;
    gap: 12px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
    overflow-x: auto;
  }
  .context-origin { white-space: nowrap; }
  .context-current { color: var(--accent); white-space: nowrap; }
  .model-picker {
    margin-left: auto;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    max-width: 200px;
    flex-shrink: 0;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .msg { display: flex; flex-direction: column; gap: 2px; }
  .msg-role {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .msg.user .msg-role { color: var(--accent); }
  .msg-content {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
    word-wrap: break-word;
  }
  /* markdown-it produces real <p>/<ol>/<ul> — keep their leading padding
     visible so list markers don't sit flush against the message gutter. */
  .msg-content :global(ol),
  .msg-content :global(ul) {
    padding-left: 1.6em;
    margin: 0.4em 0;
  }
  .msg-content :global(p) { margin: 0.4em 0; }
  .msg-content :global(p:first-child) { margin-top: 0; }
  .msg-content :global(p:last-child) { margin-bottom: 0; }
  .msg-content :global(pre) {
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 8px 10px;
    border-radius: 4px;
    overflow-x: auto;
  }
  .msg-content :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  /* User-turn and in-flight assistant streaming content are plain text
     (we only run markdown-it on finalized assistant turns); preserve
     newlines. Finalized assistant content is HTML; the rules above
     handle its layout. */
  .msg.user .msg-content,
  .msg.streaming .msg-content { white-space: pre-wrap; }
  .streaming .msg-content { opacity: 0.85; }

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
  .citation-link:hover .citation-title { text-decoration: underline; }
  .citation-num { color: var(--text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .citation-title { color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .citation-host { color: var(--text-muted); font-size: 10px; flex-shrink: 0; margin-left: auto; }

  .ask-user-card {
    margin-top: 4px;
    padding: 10px 12px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg-button);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ask-user-q { font-size: 13px; color: var(--text); font-weight: 600; }
  .ask-user-choices { display: flex; gap: 6px; flex-wrap: wrap; }
  .ask-user-chip {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .ask-user-chip:hover { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .ask-user-input-row { display: flex; gap: 6px; }
  .ask-user-input-row input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
  }
  .ask-user-input-row input:focus { outline: none; border-color: var(--accent); }
  .ask-user-send {
    padding: 6px 12px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg);
    font-size: 12px;
    cursor: pointer;
  }
  .ask-user-send:disabled { opacity: 0.5; cursor: default; }

  .drafts {
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .drafts-label { font-size: 11px; color: var(--text-muted); }
  .draft-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--bg-button);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .draft-summary { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .draft-note { color: var(--text-muted); font-size: 12px; }
  .draft-paths { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .draft-path-btn {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 4px 6px;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 3px;
  }
  .draft-path-btn:hover { background: var(--bg, var(--bg-sidebar)); }
  .draft-path { font-family: var(--font-mono, monospace); font-size: 12px; }
  .draft-toggle { color: var(--text-muted); margin-left: auto; }
  .draft-preview {
    margin: 4px 0 4px 18px;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    white-space: pre-wrap;
    overflow-x: auto;
    max-height: 280px;
  }
  .draft-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .draft-btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }
  .draft-btn:hover:not(:disabled) { background: var(--bg, var(--bg-sidebar)); }
  .draft-btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .draft-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .composer {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .composer textarea {
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
  .composer textarea:focus { outline: none; border-color: var(--accent); }

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

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-muted);
    font-size: 13px;
  }
  .empty-action {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .empty-action:hover { background: var(--bg-button-hover, var(--accent)); color: var(--bg); }
</style>
