<script lang="ts">
  import { getConversationStore } from '../stores/conversation.svelte';
  import { api } from '../ipc/client';
  import { onMount } from 'svelte';
  import { getSlashCommands } from '../tools/tool-registry';
  import type { ThinkingToolInfo } from '../../../shared/tools/types';
  import { MODEL_OPTIONS, modelLabel } from '../../../shared/tools/models';
  import type { ConversationDraft } from '../../../shared/conversation-drafts';
  import MarkdownIt from 'markdown-it';

  // Lightweight markdown-it for assistant message rendering. No HTML
  // passthrough (the model produces text we don't want to interpret as
  // HTML). Linkify on so URLs become clickable. The richer pipeline lives
  // in Preview.svelte (hljs, katex, charts, queries) — this just needs
  // headings, lists, code blocks, links, emphasis.
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: true,
  });

  interface Props {
    onClose: () => void;
    onNavigate?: (target: string) => void;
    /** Auto-fired user message when the dialog mounts. Used by conversational tools. Consumed once. */
    initialAutoMessage?: string;
  }

  let { onClose, onNavigate, initialAutoMessage }: Props = $props();

  const conv = getConversationStore();
  let input = $state('');
  let streaming = $state(false);
  let streamedChunks = $state('');
  let messagesEl = $state<HTMLDivElement>();
  let crystallizing = $state(false);
  let crystallizeResult = $state<{ componentCount: number } | null>(null);
  // Drafts emitted by the propose_notes tool, scoped to the active conversation.
  // Cleared when the dialog closes; not persisted across reload.
  let drafts = $state<ConversationDraft[]>([]);
  let pendingDraftIds = $state<Set<string>>(new Set());
  let expandedDraftIds = $state<Set<string>>(new Set());
  let lastDraftError = $state<string | null>(null);
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

  // Render the assistant message:
  //   1. Stash any [[claim: …]] annotations behind a unique placeholder
  //      so markdown-it doesn't mangle them as malformed link syntax.
  //   2. Run markdown-it on the rest.
  //   3. Substitute the placeholders back as the grounding-check spans.
  // html:false in the MarkdownIt config means raw HTML in the model's
  // text is escaped — placeholders survive only because we replace them
  // in the post-pass after rendering.
  function renderAnnotatedContent(text: string): string {
    const claims: string[] = [];
    const stashed = text.replace(/\[\[claim:\s*(.+?)\]\]/g, (_, claim: string) => {
      const idx = claims.length;
      claims.push(claim);
      // Token markdown-it leaves alone (no special chars, won't appear in
      // normal prose). The trailing END disambiguates indexes with digits.
      return `MINERVACLAIM${idx}END`;
    });
    let rendered = md.render(stashed);
    rendered = rendered.replace(
      /MINERVACLAIM(\d+)END/g,
      (_, idxStr: string) => {
        const claim = claims[Number(idxStr)] ?? '';
        const escaped = claim
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        return `<span class="llm-claim" data-claim="${escaped}" title="Checking grounding...">${escaped}</span>`;
      },
    );
    return rendered;
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
      const match = (results as Array<{ label: string; type: string }>)?.[0];
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
    api.conversations.onDraft((draft) => {
      // Only show drafts from the conversation we're currently looking at;
      // if the user opens a different one mid-stream, drafts for the prior
      // conversation are still cached but not surfaced (closing the dialog
      // drops them anyway).
      if (!conv.active || draft.conversationId !== conv.active.id) return;
      drafts = [...drafts, draft];
      scrollToBottom();
    });
    if (initialAutoMessage && initialAutoMessage.trim()) {
      input = initialAutoMessage;
      requestAnimationFrame(() => { void handleSend(); });
    }
  });

  async function approveDraft(draft: ConversationDraft) {
    if (pendingDraftIds.has(draft.draftId)) return;
    pendingDraftIds = new Set([...pendingDraftIds, draft.draftId]);
    try {
      // Svelte 5 $state values are Proxies; Electron's structured-clone
      // rejects reactive Proxies at the preload-bridge boundary. Snapshot
      // before crossing IPC or fileDraft silently no-ops.
      const snapshot = $state.snapshot(draft);
      console.log('[draft] approve clicked', { draftId: snapshot.draftId, payloads: snapshot.payloads.length });
      const result = await api.conversations.fileDraft(snapshot);
      console.log('[draft] file result', result);
      drafts = drafts.filter((d) => d.draftId !== draft.draftId);
    } catch (e) {
      console.error('[draft] file failed:', e);
      lastDraftError = e instanceof Error ? e.message : String(e);
    } finally {
      const next = new Set(pendingDraftIds);
      next.delete(draft.draftId);
      pendingDraftIds = next;
    }
  }

  function rejectDraft(draft: ConversationDraft) {
    drafts = drafts.filter((d) => d.draftId !== draft.draftId);
  }

  /**
   * "File as notes" — meta-prompts the model to take its previous reply
   * and call propose_notes for it. The system prompt already nudges the
   * model toward propose_notes when the user asks to file content; this
   * is the explicit, unambiguous trigger for when the model didn't pick
   * up on the request implicitly.
   *
   * The user-visible message in the chat is short ("File the previous
   * response as notes."); the work is done by the model in its next
   * turn — which should produce a propose_notes tool call and an
   * inline draft card.
   */
  function fileMessageAsNotes(messageContent: string) {
    if (!conv.active || streaming) return;
    // Quote a short head of the message so the chat record shows what
    // the user asked to be filed; the system prompt directive is what
    // actually drives the propose_notes call.
    const head = messageContent.slice(0, 120).replace(/\s+/g, ' ').trim();
    input = `File your previous response as notes. Call the propose_notes tool with one or more note payloads — one for the parent / index, plus one per logical section. Don't repeat the contents in this reply; the inline review card is the deliverable.\n\n(short snippet for context: "${head}…")`;
    requestAnimationFrame(() => { void handleSend(); });
  }

  function toggleDraftExpanded(draftId: string) {
    const next = new Set(expandedDraftIds);
    if (next.has(draftId)) next.delete(draftId);
    else next.add(draftId);
    expandedDraftIds = next;
  }

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
      let system: string;
      if (conv.active.systemPrompt) {
        // Tool-spawned conversation — use the pinned tool prompt and skip the
        // default [[claim:]] epistemic-partner framing (the tool is in charge).
        system = conv.active.systemPrompt;
      } else {
        system = 'You are a thoughtful epistemic partner helping the user analyze and develop ideas in their knowledge base. When you make a substantive claim, assertion, or finding, wrap it in [[claim: your claim here]] notation so it can be checked against the knowledge base.';
      }
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
      void handleSend();
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
        <button class="conv-btn" onclick={handleCrystallizeSelection} disabled={crystallizing} title="Extract Claims/Grounds/etc. from selected text as graph nodes (NOT files — these become triples in the knowledge graph). For files, use the &quot;File as Notes&quot; button under each assistant message.">Extract Selection as Components</button>
        <button class="conv-btn" onclick={handleResolve} title="Mark this conversation resolved (status flag only — no content is filed) and close">Mark Resolved &amp; Close</button>
        <button class="conv-btn" onclick={handleAbandon} title="Mark this conversation abandoned (status flag only — no content is filed) and close">Mark Abandoned &amp; Close</button>
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
              <button
                class="msg-action-btn primary"
                onclick={() => fileMessageAsNotes(msg.content)}
                disabled={streaming}
                title="Ask the assistant to file this response as one or more new notes (you'll review the bundle inline before anything lands)"
              >File as Notes</button>
              <button
                class="msg-action-btn"
                onclick={() => handleCrystallize(msg.content)}
                disabled={crystallizing}
                title="Extract Claims/Grounds/etc. as graph nodes (NOT files — these become triples in the knowledge graph)"
              >{crystallizing ? 'Extracting…' : 'Extract Components'}</button>
              <button
                class="msg-action-btn"
                onclick={() => { input = 'Tell me more about this.'; void handleSend(); }}
                disabled={streaming}
                title="Continue exploring this topic"
              >Explore Further</button>
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
      {#if drafts.length > 0}
        <div class="drafts-region">
          <div class="drafts-region-label">Proposed by the assistant — review and approve:</div>
          {#if lastDraftError}
            <div class="draft-error">Approve failed: {lastDraftError}</div>
          {/if}
          {#each drafts as draft (draft.draftId)}
            <div class="draft-card">
              <div class="draft-summary">
                <strong>{draft.payloads.length} note{draft.payloads.length === 1 ? '' : 's'}</strong>
                <span class="draft-note">{draft.note}</span>
              </div>
              <ul class="draft-paths">
                {#each draft.payloads as p}
                  <li>
                    <button
                      class="draft-path-btn"
                      onclick={() => toggleDraftExpanded(draft.draftId + ':' + p.relativePath)}
                      title={expandedDraftIds.has(draft.draftId + ':' + p.relativePath) ? 'Hide preview' : 'Preview'}
                    >
                      <span class="draft-path">{p.relativePath}</span>
                      <span class="draft-toggle">{expandedDraftIds.has(draft.draftId + ':' + p.relativePath) ? '▾' : '▸'}</span>
                    </button>
                    {#if expandedDraftIds.has(draft.draftId + ':' + p.relativePath)}
                      <pre class="draft-preview">{p.content}</pre>
                    {/if}
                  </li>
                {/each}
              </ul>
              <div class="draft-actions">
                <button
                  class="draft-btn primary"
                  disabled={pendingDraftIds.has(draft.draftId)}
                  onclick={() => approveDraft(draft)}
                >{pendingDraftIds.has(draft.draftId) ? 'Filing…' : 'Approve & file'}</button>
                <button
                  class="draft-btn"
                  disabled={pendingDraftIds.has(draft.draftId)}
                  onclick={() => rejectDraft(draft)}
                >Discard</button>
              </div>
            </div>
          {/each}
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

  .drafts-region {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .drafts-region-label {
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }
  .draft-error {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
  }
  .draft-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--bg-button);
    color: var(--text);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .draft-summary {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .draft-note {
    color: var(--text-muted);
    font-size: 12px;
  }
  .draft-paths {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
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
  .draft-path-btn:hover {
    background: var(--bg-hover, var(--bg));
  }
  .draft-path {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .draft-toggle {
    color: var(--text-muted);
    margin-left: auto;
  }
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
  .draft-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .draft-btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }
  .draft-btn:hover:not(:disabled) {
    background: var(--bg-hover, var(--bg));
  }
  .draft-btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .draft-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
  .msg-action-btn.primary {
    color: var(--accent);
    border-color: var(--accent);
  }
  .msg-action-btn.primary:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }

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
