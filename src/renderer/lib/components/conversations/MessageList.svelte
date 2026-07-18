<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import MessageCitations from '../MessageCitations.svelte';
  import DraftCards from './DraftCards.svelte';
  import { getConversationsStore, type TabRuntime } from '../../stores/conversations.svelte';
  import { getEditorStore } from '../../stores/editor.svelte';
  import { api } from '../../ipc/client';
  import { insertCitationMarker } from '../../conversations/cite-from-conversation';
  import { type CiteStatus } from '../../conversations/citations';
  import { formatTurnCost } from '../../conversations/conversation-cost';
  import type { ConversationMessage, Citation } from '../../../../shared/types';

  interface Props {
    /** The active conversation tab whose transcript we render. */
    tab: TabRuntime;
    /** Active editor note — the fallback cite target when the conversation has
     *  no anchor note. */
    currentNotePath: string | null;
  }

  let { tab, currentNotePath }: Props = $props();

  const store = getConversationsStore();
  const editor = getEditorStore();

  // Lightweight markdown-it for assistant message rendering. Mirrors the
  // configuration in the legacy ConversationDialog so prose renders the same way.
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: true,
  });

  let scrollEl = $state<HTMLDivElement>();
  let pendingAnswerText = $state('');

  /** The selected text if the selection lives inside this pane, else ''. Read by
   *  the panel's "Create note from conversation" action (#177), which must only
   *  honour a selection that sits in the transcript — not one in the editor. */
  export function getPaneSelectionText(): string {
    const sel = window.getSelection();
    if (
      sel && scrollEl && !sel.isCollapsed &&
      scrollEl.contains(sel.anchorNode) && scrollEl.contains(sel.focusNode)
    ) {
      return sel.toString().trim();
    }
    return '';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (!scrollEl) return;
      scrollEl.scrollTop = scrollEl.scrollHeight;
      // Second pass (#1112): with `content-visibility` render-virtualization the
      // bottom turns may have used their intrinsic-size *estimate* on the first
      // pass. Scrolling there brings them on-screen so they render at their real
      // height; re-pin to the now-accurate scrollHeight on the next frame so we
      // always land flush at the bottom instead of a few pixels short.
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    });
  }

  // Auto-scroll on new content. Track the streaming buffer + the message count
  // so the effect re-runs both as chunks arrive and when the final turn lands.
  $effect(() => {
    void tab.streamedChunks;
    void tab.conversation.messages.length;
    scrollToBottom();
  });

  async function submitAnswer(tabId: string, answer: string) {
    const text = answer.trim();
    if (!text) return;
    pendingAnswerText = '';
    await store.answerQuestion(tabId, text);
  }

  // ── Cite What You Said (#112) ───────────────────────────────────────────
  // Promote a conversation citation into a real `thought:cites` edge on the
  // note that anchors the conversation. Per-citation status keyed by
  // `${tabId}:${messageIndex}:${citationIndex}` so each footnote tracks its
  // own running / done / error state independently across tabs.
  let citeState = $state<Record<string, CiteStatus>>({});

  function citeKey(t: TabRuntime, msgIndex: number, ci: number): string {
    return `${t.id}:${msgIndex}:${ci}`;
  }

  /** Display name for a message's sender. The assistant turn is presented as
   *  "Minerva" (the app) in the conversation UI; the underlying message role is
   *  still `assistant` — this only relabels what the user sees. */
  function roleLabel(role: string): string {
    return role === 'assistant' ? 'Minerva' : role;
  }

  /** Note this conversation cites *into*: its anchor note, else whatever the
   *  editor currently shows. Null when there's nowhere to record the edge. */
  function citeTargetPath(t: TabRuntime): string | null {
    return t.conversation.contextBundle.notePath ?? currentNotePath;
  }

  async function handleCite(t: TabRuntime, msgIndex: number, ci: number, cite: Citation) {
    const notePath = citeTargetPath(t);
    if (!notePath) return;
    const key = citeKey(t, msgIndex, ci);
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
</script>

{#snippet messageBlock(msg: ConversationMessage, t: TabRuntime, msgIndex: number)}
  {#if msg.role !== 'system'}
    <div class="msg {msg.role}">
      <div class="msg-role">
        <span>{roleLabel(msg.role)}</span>
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
            targetPath={citeTargetPath(t)}
            citeStateFor={(ci) => citeState[citeKey(t, msgIndex, ci)]}
            onOpenExternal={(url) => api.shell.openExternal(url)}
            onCite={(ci, cite) => handleCite(t, msgIndex, ci, cite)}
          />
        {/if}
      {:else}
        <div class="msg-content">{msg.content}</div>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="messages" bind:this={scrollEl}>
  <!-- Interleave: message → cards anchored to that message → next message.
       Keeps a draft visually attached to the assistant turn that produced it,
       even after the user sends a follow-up that would otherwise push their new
       message between the old assistant and its still-pending card. -->
  {#each tab.conversation.messages as msg, i}
    {@render messageBlock(msg, tab, i)}
    <DraftCards {tab} index={i} />
  {/each}

  {#if tab.streaming}
    <div class="msg assistant streaming">
      <div class="msg-role">{roleLabel('assistant')}</div>
      {#if tab.streamedChunks}
        <!-- Stream the assistant's partial text through markdown-it so tool-call
             indicators (`_🔍 …_`) and any markdown the model emits mid-stream
             render with the same styling they'll have after the conversation
             reloads on completion. Without this the live view shows raw
             underscores/asterisks and the message visibly "snaps" to formatted
             prose when the final turn lands. -->
        <div class="msg-content">{@html md.render(tab.streamedChunks)}</div>
      {/if}
      <!-- Thinking interstitial — always rendered while the turn is in flight.
           Sits at the head of the streaming block before any text arrives, then
           tucks under the streamed text once content lands. Inter-iteration
           waits (model produced text in iteration 1, now blocked on a tool call
           before iteration 2 starts) would otherwise have zero animated
           feedback; keeping the dots visible throughout means the user always
           knows the turn is still working. -->
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

  <!-- Orphans: cards anchored beyond the current message list. Happens during
       an in-flight turn (the assistant message hasn't been persisted yet) or
       after a cancel left the anchor pointing into thin air. Render at the
       bottom so the card is still visible; the inline interleaved render above
       picks them up on reload. -->
  <DraftCards {tab} index={null} />
</div>

<style>
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .msg {
    display: flex;
    flex-direction: column;
    gap: 2px;
    /* Render-virtualization for long transcripts (perf #1112). A several-
       hundred-message research conversation mounts thousands of DOM nodes
       (rendered markdown, citations, diffs); `content-visibility: auto` lets
       Chromium skip layout + paint for the off-screen turns so scroll and
       per-append cost stay bounded by the visible window instead of the whole
       history. Crucially the nodes stay in the DOM, so scroll-to-bottom,
       jump-to-message, and cross-message text selection keep working unchanged
       — this virtualizes rendering, not the node list.
       `contain-intrinsic-size: auto <fallback>` makes Chromium remember each
       turn's real height after its first render (so the scrollbar settles
       instead of drifting as you scroll up); the 4rem fallback only sizes turns
       that have never been on-screen yet. */
    content-visibility: auto;
    contain-intrinsic-size: auto 4rem;
  }
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
  /* User-turn content is plain text — preserve newlines. Streaming assistant
     content is now markdown-rendered (same as finalized assistant turns), so
     the rules above handle its layout. */
  .msg.user .msg-content { white-space: pre-wrap; }
  .streaming .msg-content { opacity: 0.85; }

  /* "Thinking…" interstitial — three dots that pulse out of phase so the user
     can see the agent is in flight before the first chunk or tool indicator
     arrives. */
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
</style>
