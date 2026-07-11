<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { getConversationsStore } from '../stores/conversations.svelte';
  import { getEditorStore } from '../stores/editor.svelte';
  import { getDialogStore } from '../stores/dialogs.svelte';
  import { CONFIRM_KEYS } from '../confirm-keys';
  import { api } from '../ipc/client';
  import MarkdownIt from 'markdown-it';
  import { MODEL_OPTIONS, modelLabel } from '../../../shared/tools/models';
  import {
    EFFORT_LEVELS,
    supportedEfforts,
    modelSupportsEffort,
    effortSupported,
    clampEffort,
    isEffort,
    type Effort,
  } from '../../../shared/tools/effort';
  import type { ConversationMessage, Citation } from '../../../shared/types';
  import { insertCitationMarker } from '../conversations/cite-from-conversation';
  import { type CiteStatus } from '../conversations/citations';
  import MessageCitations from './MessageCitations.svelte';
  import Composer from './conversations/Composer.svelte';
  import DraftCards from './conversations/DraftCards.svelte';
  import { tabTitle } from '../conversations/conversation-display';
  import { formatTurnCost } from '../conversations/conversation-cost';

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
    /** Host implementation of "Create note from this conversation"
     *  (#177). Receives the conversation, the selected text (or
     *  empty when no selection lives inside the conversation pane),
     *  and the latest assistant message's content as a fallback. */
    onCreateNoteFromConversation?: (args: {
      conversation: import('../../../shared/types').Conversation;
      selectionText: string;
      fallbackText: string;
    }) => Promise<void>;
    /** Invoke a skill by id from the composer's `/` launcher (#648). Wired to
     *  the host's standard tool-invoke path so a slash-command runs exactly
     *  like picking the skill from the menu. */
    onInvokeSkill?: (toolId: string) => void;
  }

  let { currentNotePath, onCreateNoteFromConversation, onInvokeSkill }: Props = $props();

  const store = getConversationsStore();
  const editor = getEditorStore();
  const { showConfirm } = getDialogStore();

  let composer = $state<{ focus: () => void }>();
  let scrollEl = $state<HTMLDivElement>();
  let resizing = $state(false);
  // Project-default model — used to label the "Default" option so the
  // user can see which concrete model "default" resolves to.
  let defaultModel = $state<string | null>(null);
  let defaultEffort = $state<Effort | undefined>(undefined);
  // Width-of-tab-bar overflow handling deferred to polish (#505).

  onMount(async () => {
    // The {#key notebase.meta.rootPath} block at the mount site remounts
    // this component on project switch; reset() clears stale tabs from
    // the previous project and reloads from the new project's state.
    await store.reset();
    try {
      const s = await api.tools.getSettings();
      defaultModel = s.model ?? null;
      defaultEffort = s.effort;
    } catch { /* settings unavailable; picker still works without the label */ }
  });

  /**
   * "Create note" from the active conversation (#177). Pulls the
   * current selection if it sits inside the conversation pane;
   * otherwise the host's fallback (last assistant message) wins.
   */
  let creatingNote = $state(false);
  async function handleCreateNote(): Promise<void> {
    if (!onCreateNoteFromConversation || creatingNote) return;
    const tab = store.activeTab;
    if (!tab || tab.conversation.messages.filter((m) => m.role === 'assistant').length === 0) return;
    creatingNote = true;
    try {
      const sel = window.getSelection();
      let selectionText = '';
      if (sel && scrollEl && !sel.isCollapsed) {
        // Only honour the selection when it lives inside the
        // conversation pane — otherwise users could trigger from
        // editor selections by accident.
        if (scrollEl.contains(sel.anchorNode) && scrollEl.contains(sel.focusNode)) {
          selectionText = sel.toString().trim();
        }
      }
      const lastAssistant = [...tab.conversation.messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      const fallbackText = lastAssistant?.content ?? '';
      await onCreateNoteFromConversation({
        conversation: tab.conversation,
        selectionText,
        fallbackText,
      });
    } finally {
      creatingNote = false;
    }
  }

  /** Whether the "Create note" affordance is enabled. Requires at
   *  least one assistant message in the active conversation. */
  const canCreateNote = $derived.by(() => {
    const tab = store.activeTab;
    if (!tab) return false;
    return tab.conversation.messages.some((m) => m.role === 'assistant');
  });

  // ── Cite What You Said (#112) ───────────────────────────────────────────
  // Promote a conversation citation into a real `thought:cites` edge on the
  // note that anchors the conversation. Per-citation status keyed by
  // `${tabId}:${messageIndex}:${citationIndex}` so each footnote tracks its
  // own running / done / error state independently across tabs.
  let citeState = $state<Record<string, CiteStatus>>({});

  function citeKey(tab: TabT, msgIndex: number, ci: number): string {
    return `${tab.id}:${msgIndex}:${ci}`;
  }

  /** Note this conversation cites *into*: its anchor note, else whatever the
   *  editor currently shows. Null when there's nowhere to record the edge. */
  function citeTargetPath(tab: TabT): string | null {
    return tab.conversation.contextBundle.notePath ?? currentNotePath;
  }

  async function handleCite(tab: TabT, msgIndex: number, ci: number, cite: Citation) {
    const notePath = citeTargetPath(tab);
    if (!notePath) return;
    const key = citeKey(tab, msgIndex, ci);
    if (citeState[key]?.phase === 'running' || citeState[key]?.phase === 'done') return;
    citeState = { ...citeState, [key]: { phase: 'running' } };
    try {
      // 1. Ingest the cited URL as a Source (no-op-ish if it already exists —
      //    the pipeline dedupes and returns the existing source id).
      const { sourceId } = await api.sources.ingestUrl(cite.url);
      // 2. Flush any pending editor edits to the target note first, so the
      //    disk read below sees them and our write doesn't get clobbered by a
      //    late autosave. Only the *active* tab can be dirty.
      if (editor.activeFilePath === notePath) await editor.save();
      // 3. Weave the citation marker into the note text and persist; the write
      //    re-indexes the graph, which is what materialises the cites edge.
      const text = await api.notebase.readFile(notePath);
      const next = insertCitationMarker(text, sourceId);
      if (next !== text) await api.notebase.writeFile(notePath, next);
      // 4. Refresh the open tab (if any) so the user sees the new marker.
      await editor.reloadTabFromDisk(notePath);
      citeState = { ...citeState, [key]: { phase: 'done' } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[conv-panel] cite from conversation failed:', e);
      citeState = { ...citeState, [key]: { phase: 'error', message } };
    }
  }

  /** Resolve the model a conversation actually runs on (override → global
   *  default → built-in fallback), for gating the effort picker. */
  function effectiveModel(model: string | undefined): string {
    return model ?? defaultModel ?? 'claude-sonnet-5';
  }

  async function handleModelChange(tabId: string, e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    await store.setModel(tabId, value || undefined);
    // Re-gate effort against the new model: if the conversation pinned an
    // effort the new model can't honor (e.g. Extra → Sonnet, or any → Haiku),
    // clamp it to the nearest supported level (or clear it for Haiku) so the
    // next turn doesn't 400.
    const tab = store.tabs.find((t) => t.id === tabId);
    const current = tab?.conversation.effort;
    if (current) {
      const model = effectiveModel(value || undefined);
      const clamped = clampEffort(model, current);
      if (clamped !== current) await store.setEffort(tabId, clamped);
    }
  }

  async function handleEffortChange(tabId: string, e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    await store.setEffort(tabId, isEffort(value) ? value : undefined);
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
    // A blank conversation — the "New conversation" button is note-agnostic.
    // Note-scoped conversations come from the "Ask about this note" affordance.
    await store.openFreeform();
    await tick();
    composer?.focus();
  }

  async function handleCloseTab(id: string, e: Event) {
    e.stopPropagation();
    // Closing archives the conversation and there's no reopen UI, so guard it
    // with a dismissable confirm (#1033).
    const ok = await showConfirm(
      "Close this conversation? You won't be able to reopen it.",
      CONFIRM_KEYS.closeConversation,
      'Close',
    );
    if (!ok) return;
    await store.closeTab(id);
  }

  // Resize: track pointer between mousedown on the handle and mouseup
  // anywhere. We measure from the panel's bounding rect bottom so the
  // pointer stays under the handle as the user drags.
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

  let pendingAnswerText = $state('');

  async function submitAnswer(tabId: string, answer: string) {
    const text = answer.trim();
    if (!text) return;
    pendingAnswerText = '';
    await store.answerQuestion(tabId, text);
  }


  // The active-tab shape, for the cite handlers above. Draft/result card
  // anchoring (per-message vs orphan) now lives in DraftCards.svelte (#1087).
  type TabT = NonNullable<typeof store.activeTab>;
</script>

{#if store.visible}
  <div
    class="conv-panel"
    class:resizing
    style="height: {store.height}px;"
  >
    <div class="resize-handle" onpointerdown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize conversations panel"></div>

    <!-- Two-pane mail-style layout (§9.1). Left list of conversations,
         right pane shows the active conversation. -->
    <div class="conv-body">
      <aside class="conv-list">
        <div class="list-header">
          <h2 class="list-title">Conversations</h2>
          <button type="button" class="list-new" onclick={handleNewTab} title="New conversation">
            <Icon name="plus" size={13} />
          </button>
          <button type="button" class="list-hide" onclick={store.hide} title="Hide panel (does not archive any conversations)">
            <Icon name="close" size={11} />
          </button>
        </div>
        <div class="list-items">
          {#each store.tabs as tab (tab.id)}
            <div class="conv-item" class:active={tab.id === store.activeTabId}>
              <button
                type="button"
                class="conv-item-btn"
                onclick={() => store.setActiveTab(tab.id)}
                title={tabTitle(tab)}
              >
                <span class="conv-item-title">{tabTitle(tab)}</span>
                {#if tab.conversation.contextBundle.notePath}
                  <span class="conv-item-note">
                    <Icon name="notes" size={10} color="var(--text-faint)" />
                    {tab.conversation.contextBundle.notePath}
                  </span>
                {/if}
              </button>
              <button
                type="button"
                class="conv-item-close"
                aria-label="Close conversation"
                onclick={(e) => handleCloseTab(tab.id, e)}
              ><Icon name="close" size={10} /></button>
            </div>
          {/each}
        </div>
      </aside>

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
          {#if modelSupportsEffort(effectiveModel(tab.conversation.model))}
            {@const convModel = effectiveModel(tab.conversation.model)}
            {@const inherited = defaultEffort ? clampEffort(convModel, defaultEffort) : undefined}
            {@const inheritedLabel = inherited ? EFFORT_LEVELS.find((l) => l.value === inherited)?.label : null}
            <select
              class="model-picker effort-picker"
              value={tab.conversation.effort && effortSupported(convModel, tab.conversation.effort) ? tab.conversation.effort : ''}
              onchange={(e) => handleEffortChange(tab.id, e)}
              title="Reasoning effort for this conversation"
            >
              <option value="">Effort: default{inheritedLabel ? ` (${inheritedLabel})` : ''}</option>
              {#each EFFORT_LEVELS.filter((l) => supportedEfforts(convModel).includes(l.value)) as lvl}
                <option value={lvl.value}>Effort: {lvl.label}</option>
              {/each}
            </select>
          {/if}
          {#if onCreateNoteFromConversation}
            <button
              type="button"
              class="rail-action"
              disabled={!canCreateNote || creatingNote}
              onclick={handleCreateNote}
              title="Create a new note from the selection (or last assistant message) — #177"
            >
              {creatingNote ? 'Creating…' : 'Create note'}
            </button>
          {/if}
        </div>

        {#snippet messageBlock(msg: ConversationMessage, tab: TabT, msgIndex: number)}
          {#if msg.role !== 'system'}
            <div class="msg {msg.role}">
              <div class="msg-role">
                <span>{msg.role}</span>
                {#if msg.role === 'assistant'}
                  {@const turnCost = formatTurnCost(msg)}
                  {#if turnCost}
                    <span class="msg-cost" title="Token usage / cost for this turn">{turnCost}</span>
                  {/if}
                {/if}
              </div>
              {#if msg.role === 'assistant'}
                <div class="msg-content">{@html md.render(msg.content)}</div>
                {#if msg.citations && msg.citations.length > 0}
                  <MessageCitations
                    citations={msg.citations}
                    targetPath={citeTargetPath(tab)}
                    citeStateFor={(ci) => citeState[citeKey(tab, msgIndex, ci)]}
                    onOpenExternal={(url) => api.shell.openExternal(url)}
                    onCite={(ci, cite) => handleCite(tab, msgIndex, ci, cite)}
                  />
                {/if}
              {:else}
                <div class="msg-content">{msg.content}</div>
              {/if}
            </div>
          {/if}
        {/snippet}

        <div class="messages" bind:this={scrollEl}>
          <!-- Interleave: message → cards anchored to that message →
               next message. Keeps a draft visually attached to the
               assistant turn that produced it, even after the user
               sends a follow-up that would otherwise push their new
               message between the old assistant and its still-pending
               card. -->
          {#each tab.conversation.messages as msg, i}
            {@render messageBlock(msg, tab, i)}
            <DraftCards {tab} index={i} />
          {/each}

          {#if tab.streaming}
            <div class="msg assistant streaming">
              <div class="msg-role">assistant</div>
              {#if tab.streamedChunks}
                <!-- Stream the assistant's partial text through markdown-it
                     so tool-call indicators (`_🔍 …_`) and any markdown the
                     model emits mid-stream render with the same styling
                     they'll have after the conversation reloads on
                     completion. Without this the live view shows raw
                     underscores/asterisks and the message visibly "snaps"
                     to formatted prose when the final turn lands. -->
                <div class="msg-content">{@html md.render(tab.streamedChunks)}</div>
              {/if}
              <!-- Thinking interstitial — always rendered while the turn
                   is in flight. Sits at the head of the streaming block
                   before any text arrives, then tucks under the streamed
                   text once content lands. Inter-iteration waits (model
                   produced text in iteration 1, now blocked on a tool
                   call before iteration 2 starts) would otherwise have
                   zero animated feedback; keeping the dots visible
                   throughout means the user always knows the turn is
                   still working. -->
              <div class="thinking-indicator" aria-label="Thinking" role="status">
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
              </div>
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

          <!-- Orphans: cards anchored beyond the current message list.
               Happens during an in-flight turn (the assistant message
               hasn't been persisted yet) or after a cancel left the
               anchor pointing into thin air. Render at the bottom so
               the card is still visible; the inline interleaved render
               above will pick them up on reload. -->
          <DraftCards {tab} index={null} />
        </div>

        <Composer {tab} {currentNotePath} {onInvokeSkill} bind:this={composer} />
      </div>
    {:else}
      <div class="empty">
        <p>No active conversation.</p>
        <button type="button" class="empty-action" onclick={handleNewTab}>Start a conversation</button>
      </div>
    {/if}
    </div>
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

  /* Two-pane mail-style layout (§9.1) — left list + right pane. */
  .conv-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .conv-list {
    width: 220px;
    border-right: 1px solid var(--border);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 0;
  }
  .list-header {
    padding: 12px 14px 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .list-title {
    flex: 1;
    margin: 0;
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 500;
    letter-spacing: -0.005em;
    color: var(--text);
  }
  .list-new,
  .list-hide {
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 3px;
    border-radius: 5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .list-new:hover,
  .list-hide:hover {
    background: color-mix(in oklch, var(--text) 8%, transparent);
    color: var(--text);
  }
  .list-items {
    flex: 1;
    overflow-y: auto;
  }
  .conv-item {
    display: flex;
    align-items: stretch;
    border-left: 2px solid transparent;
    color: var(--text);
    position: relative;
  }
  .conv-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
  }
  .conv-item.active {
    border-left-color: var(--accent);
    background: color-mix(in oklch, var(--accent) 8%, transparent);
  }
  .conv-item-btn {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    text-align: left;
    padding: 10px 14px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .conv-item-title {
    font-size: 12.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conv-item.active .conv-item-title {
    font-weight: 500;
  }
  .conv-item-note {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conv-item-close {
    border: none;
    background: transparent;
    color: var(--text-faint);
    padding: 0 8px;
    cursor: pointer;
    opacity: 0;
    display: inline-flex;
    align-items: center;
  }
  .conv-item:hover .conv-item-close,
  .conv-item.active .conv-item-close {
    opacity: 1;
  }
  .conv-item-close:hover {
    color: var(--text);
  }
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
  /* "Create note" rail button (#177). Sits next to the model picker
     and follows the same chrome — keeps the rail visually contained. */
  .rail-action {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .rail-action:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .rail-action:disabled { opacity: 0.45; cursor: default; }

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
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .msg.user .msg-role { color: var(--accent); }
  .msg-cost {
    font-weight: 400;
    text-transform: none;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
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
  /* User-turn content is plain text — preserve newlines. Streaming
     assistant content is now markdown-rendered (same as finalized
     assistant turns), so the rules above handle its layout. */
  .msg.user .msg-content { white-space: pre-wrap; }
  .streaming .msg-content { opacity: 0.85; }

  /* "Thinking…" interstitial — three dots that pulse out of phase so
     the user can see the agent is in flight before the first chunk or
     tool indicator arrives. */
  .thinking-indicator {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 0;
  }
  .thinking-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.35;
    animation: thinking-pulse 1.2s ease-in-out infinite;
  }
  .thinking-dot:nth-child(2) { animation-delay: 0.18s; }
  .thinking-dot:nth-child(3) { animation-delay: 0.36s; }
  @keyframes thinking-pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
    40%          { opacity: 1;    transform: scale(1.1); }
  }


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
