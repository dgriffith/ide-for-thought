<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { getConversationsStore } from '../stores/conversations.svelte';
  import { getEditorStore } from '../stores/editor.svelte';
  import { api } from '../ipc/client';
  import MarkdownIt from 'markdown-it';
  import { MODEL_OPTIONS, modelLabel } from '../../../shared/tools/models';
  import type { ConversationDraft } from '../../../shared/conversation-drafts';
  import type {
    ConversationSourceDraft,
    SourceIngestOutcome,
  } from '../../../shared/conversation-source-drafts';
  import type {
    ConversationPropertyDraft,
    PropertyUpdateOutcome,
  } from '../../../shared/conversation-property-drafts';
  import type {
    ConversationComputeDraft,
  } from '../../../shared/conversation-compute-drafts';
  import type { CellOutput } from '../../../shared/compute/types';
  import { sanitizeComputeOutputHtml } from '../compute-output-sanitize';
  import type { ConversationMessage, Citation } from '../../../shared/types';
  import { insertCitationMarker, noteBasename } from '../conversations/cite-from-conversation';

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
  }

  let { currentNotePath, onCreateNoteFromConversation }: Props = $props();

  const store = getConversationsStore();
  const editor = getEditorStore();

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
  type CiteStatus = { phase: 'running' | 'done' } | { phase: 'error'; message: string };
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

  async function handleApproveSource(tabId: string, draft: ConversationSourceDraft) {
    try {
      await store.approveSourceDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve source failed:', e);
    }
  }

  function handleDiscardSource(tabId: string, draftId: string) {
    store.discardSourceDraft(tabId, draftId);
  }

  async function handleApproveProperty(tabId: string, draft: ConversationPropertyDraft) {
    try {
      await store.approvePropertyDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve property failed:', e);
    }
  }

  function handleDiscardProperty(tabId: string, draftId: string) {
    store.discardPropertyDraft(tabId, draftId);
  }

  // ── propose_compute card state (#245) ─────────────────────────────
  //
  // Per-draft editor buffer (when the user clicks Edit) and a flag for
  // "I see the safety warnings, run anyway". Keyed by draftId so two
  // compute drafts in the same conversation are independent. Edit
  // buffers are dropped when the draft is discarded.
  let computeEdits = $state<Record<string, string>>({});
  let computeEditing = $state<Record<string, boolean>>({});
  let computeRiskyAck = $state<Record<string, boolean>>({});

  function startEditCompute(draft: ConversationComputeDraft): void {
    computeEdits[draft.draftId] = draft.code;
    computeEditing[draft.draftId] = true;
  }

  function cancelEditCompute(draftId: string): void {
    delete computeEdits[draftId];
    computeEditing[draftId] = false;
  }

  function commitEditCompute(draftId: string): void {
    // No persistence here — the edited code is folded into Run /
    // Insert payloads when the user actually fires those actions.
    // This just exits edit mode while preserving the buffer.
    computeEditing[draftId] = false;
  }

  function effectiveComputeCode(draft: ConversationComputeDraft): string {
    const edited = computeEdits[draft.draftId];
    return edited !== undefined ? edited : draft.code;
  }

  async function handleRunCompute(draft: ConversationComputeDraft): Promise<void> {
    if (draft.safetyFlags.length > 0 && !computeRiskyAck[draft.draftId]) {
      // First click on a flagged cell just arms the acknowledgement;
      // the user has to click Run a second time to actually execute.
      computeRiskyAck[draft.draftId] = true;
      return;
    }
    const edited = computeEdits[draft.draftId];
    const tab = store.activeTab;
    if (!tab) return;
    await store.runComputeDraft(tab.id, draft, edited);
  }

  async function handleInsertCompute(draft: ConversationComputeDraft): Promise<void> {
    const tab = store.activeTab;
    if (!tab) return;
    const edited = computeEdits[draft.draftId];
    await store.insertComputeDraft(tab.id, draft, edited);
  }

  function handleDiscardCompute(draft: ConversationComputeDraft): void {
    const tab = store.activeTab;
    if (!tab) return;
    delete computeEdits[draft.draftId];
    delete computeEditing[draft.draftId];
    delete computeRiskyAck[draft.draftId];
    store.discardComputeDraft(tab.id, draft.draftId);
  }

  function languagePillLabel(lang: 'sparql' | 'sql' | 'python'): string {
    return lang === 'sparql' ? 'SPARQL' : lang === 'sql' ? 'SQL' : 'Python';
  }

  function openInsertedNote(path: string): void {
    void editor.openFile(path);
  }

  /** Format a single table cell for inline rendering. Wide values
   *  get truncated; bigints are shown as plain numbers (no `n` suffix). */
  function formatComputeCell(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '…' : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch { return ''; }
  }

  /** Render a frontmatter value for inline display on the review card.
   *  Strings render bare; everything else falls back to compact JSON
   *  so the user can eyeball arrays/objects without scrolling. Null
   *  is shown as a deletion marker. */
  function formatPropertyValue(v: unknown): string {
    if (v === null) return '⌫ deleted';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v) ?? ''; } catch { return '[unserializable]'; }
  }

  function sourceLabel(s: { identifier?: string; url?: string }): string {
    return s.identifier ?? s.url ?? '(unknown source)';
  }

  /** Last segment of a project-relative path — the only part the user
   *  needs to recognize the filed note in the compact "Filed:" line.
   *  Full path is still on the link's `title` for hover disambiguation
   *  when two filings have the same basename. */
  function basename(p: string): string {
    const slash = p.lastIndexOf('/');
    return slash >= 0 ? p.slice(slash + 1) : p;
  }

  function openFiledNote(relativePath: string) {
    void editor.openFile(relativePath);
  }

  function openFiledSource(sourceId: string) {
    editor.openSource(sourceId);
  }

  /** Cheap heuristic for the "doi / arxiv / pmid / url" pill — exact
   *  normalization happens server-side at ingest time. Only used for
   *  the badge label so a bit of imprecision is fine. */
  function sourceKindLabel(s: { identifier?: string; url?: string }): string {
    if (s.url) return 'url';
    const id = s.identifier ?? '';
    const stripped = id.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:|arxiv:|pmid:)\s*/i, '');
    if (/^10\./.test(stripped)) return 'doi';
    if (/^\d{4}\.\d{4,5}$|^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/i.test(stripped)) return 'arxiv';
    if (/^\d+$/.test(stripped)) return 'pmid';
    return 'id';
  }

  function hostOf(url: string): string {
    try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
  }

  // ── Card anchoring helpers ───────────────────────────────────────────
  // Each draft / sourceDraft / sourceDraftResult carries an
  // `afterMessageIndex` captured when it arrived (the slot the streaming
  // assistant message will occupy after end-of-send reload). To keep
  // the visual conversation chronological, we walk messages and render
  // each card right after the message it's anchored to. Cards whose
  // anchor index is beyond the current message list (in-flight turn,
  // canceled turn, etc.) render as orphans at the bottom — same
  // position as the old "everything at panel bottom" behavior but only
  // for the narrow window before reload lands.
  type TabT = NonNullable<typeof store.activeTab>;
  function draftsAt(tab: TabT, i: number) {
    return tab.drafts.filter((d) => d.afterMessageIndex === i);
  }
  function sourceDraftsAt(tab: TabT, i: number) {
    return tab.sourceDrafts.filter((d) => d.afterMessageIndex === i);
  }
  function sourceResultsAt(tab: TabT, i: number) {
    return Object.entries(tab.sourceDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex === i,
    );
  }
  function noteResultsAt(tab: TabT, i: number) {
    return Object.entries(tab.noteDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex === i,
    );
  }
  function propertyDraftsAt(tab: TabT, i: number) {
    return tab.propertyDrafts.filter((d) => d.afterMessageIndex === i);
  }
  function propertyResultsAt(tab: TabT, i: number) {
    return Object.entries(tab.propertyDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex === i,
    );
  }
  function computeDraftsAt(tab: TabT, i: number) {
    return tab.computeDrafts.filter((d) => d.afterMessageIndex === i);
  }
  function orphanDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.drafts.filter((d) => d.afterMessageIndex >= max);
  }
  function orphanSourceDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.sourceDrafts.filter((d) => d.afterMessageIndex >= max);
  }
  function orphanSourceResults(tab: TabT) {
    const max = tab.conversation.messages.length;
    return Object.entries(tab.sourceDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex >= max,
    );
  }
  function orphanNoteResults(tab: TabT) {
    const max = tab.conversation.messages.length;
    return Object.entries(tab.noteDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex >= max,
    );
  }
  function orphanPropertyDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.propertyDrafts.filter((d) => d.afterMessageIndex >= max);
  }
  function orphanPropertyResults(tab: TabT) {
    const max = tab.conversation.messages.length;
    return Object.entries(tab.propertyDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex >= max,
    );
  }
  function orphanComputeDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.computeDrafts.filter((d) => d.afterMessageIndex >= max);
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
              <div class="msg-role">{msg.role}</div>
              {#if msg.role === 'assistant'}
                <div class="msg-content">{@html md.render(msg.content)}</div>
                {#if msg.citations && msg.citations.length > 0}
                  {@const target = citeTargetPath(tab)}
                  <ol class="citations">
                    {#each msg.citations as cite, ci}
                      {@const st = citeState[citeKey(tab, msgIndex, ci)]}
                      <li>
                        <button type="button" class="citation-link" onclick={() => api.shell.openExternal(cite.url)} title={cite.citedText}>
                          <span class="citation-num">[{ci + 1}]</span>
                          <span class="citation-title">{cite.title ?? hostOf(cite.url)}</span>
                          <span class="citation-host">{hostOf(cite.url)}</span>
                        </button>
                        {#if st?.phase === 'done'}
                          <span class="cite-action done" title="Filed as a source and cited from this note">✓ cited</span>
                        {:else if st?.phase === 'error'}
                          <button type="button" class="cite-action error" title={st.message} onclick={() => handleCite(tab, msgIndex, ci, cite)}>retry</button>
                        {:else}
                          <button
                            type="button"
                            class="cite-action"
                            disabled={!target || st?.phase === 'running'}
                            title={target ? `Ingest as a source and cite from ${noteBasename(target)}` : 'No note to cite into — open one in the editor'}
                            onclick={() => handleCite(tab, msgIndex, ci, cite)}
                          >{st?.phase === 'running' ? 'citing…' : 'cite'}</button>
                        {/if}
                      </li>
                    {/each}
                  </ol>
                {/if}
              {:else}
                <div class="msg-content">{msg.content}</div>
              {/if}
            </div>
          {/if}
        {/snippet}

        {#snippet noteDraftCard(draft: ConversationDraft)}
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
        {/snippet}

        {#snippet sourceDraftCardBlock(draft: ConversationSourceDraft)}
          <div class="draft-card">
            <div class="draft-summary">
              <strong>📚 {draft.sources.length} source{draft.sources.length === 1 ? '' : 's'}</strong>
              <span class="draft-note">{draft.note}</span>
            </div>
            <ul class="source-list">
              {#each draft.sources as s, si (si)}
                <li>
                  <span class="source-kind">{sourceKindLabel(s)}</span>
                  <span class="source-value">{sourceLabel(s)}</span>
                </li>
              {/each}
            </ul>
            <div class="draft-actions">
              <button type="button" class="draft-btn primary" onclick={() => handleApproveSource(tab.id, draft)}>Approve &amp; ingest</button>
              <button type="button" class="draft-btn" onclick={() => handleDiscardSource(tab.id, draft.draftId)}>Discard</button>
            </div>
          </div>
        {/snippet}

        {#snippet sourceResultLine(_draftId: string, outcomes: SourceIngestOutcome[])}
          <!-- Compact "Filed:" line that replaces the propose_sources
               card after Approve. Each successfully filed source title
               is a clickable link that opens the source in the editor;
               failures are shown muted in-line so the user can see what
               didn't land without losing the click-to-open story. The
               line is persistent (no dismiss) — it lives in the
               transcript so the user can scroll back later. -->
          <div class="filed-line">
            <span class="filed-prefix">📚 Filed:</span>
            {#each outcomes as o, oi (oi)}
              {#if oi > 0}<span class="filed-sep">·</span>{/if}
              {#if o.error}
                <span class="filed-error" title={o.error}>⚠ {sourceLabel(o.input)}</span>
              {:else if o.sourceId}
                <button
                  type="button"
                  class="filed-link"
                  title={o.duplicate ? 'Already in library — open' : 'Open source'}
                  onclick={() => openFiledSource(o.sourceId!)}
                >{o.title ?? sourceLabel(o.input)}{#if o.duplicate}<span class="filed-dup"> · already in library</span>{/if}</button>
              {:else}
                <span class="filed-error">{sourceLabel(o.input)}</span>
              {/if}
            {/each}
          </div>
        {/snippet}

        {#snippet noteResultLine(_draftId: string, filedPaths: string[])}
          <!-- Counterpart to sourceResultLine for propose_notes. Drops
               in where the draft card was so the user knows what filed
               and can jump to any of the new notes with one click. -->
          <div class="filed-line">
            <span class="filed-prefix">📝 Filed:</span>
            {#if filedPaths.length === 0}
              <span class="filed-error">(no notes written)</span>
            {:else}
              {#each filedPaths as p, pi (p)}
                {#if pi > 0}<span class="filed-sep">·</span>{/if}
                <button
                  type="button"
                  class="filed-link"
                  title={p}
                  onclick={() => openFiledNote(p)}
                >{basename(p)}</button>
              {/each}
            {/if}
          </div>
        {/snippet}

        {#snippet propertyDraftCardBlock(draft: ConversationPropertyDraft)}
          <!-- set_properties review card. Mirrors the source/note card
               chrome but shows the proposed frontmatter patch per note
               instead of a flat list. Each value renders with its key
               so the user can eyeball the diff without clicking
               through to the file. -->
          <div class="draft-card">
            <div class="draft-summary">
              <strong>🔑 {draft.updates.length} note{draft.updates.length === 1 ? '' : 's'}</strong>
              <span class="draft-note">{draft.note}</span>
            </div>
            <ul class="property-update-list">
              {#each draft.updates as u, ui (ui)}
                <li class="property-update">
                  <div class="property-update-path">{u.relativePath}</div>
                  <ul class="property-kv-list">
                    {#each Object.entries(u.properties) as [k, v] (k)}
                      <li class="property-kv" class:property-kv-delete={v === null}>
                        <span class="property-key">{k}:</span>
                        <span class="property-value">{formatPropertyValue(v)}</span>
                      </li>
                    {/each}
                  </ul>
                </li>
              {/each}
            </ul>
            <div class="draft-actions">
              <button type="button" class="draft-btn primary" onclick={() => handleApproveProperty(tab.id, draft)}>Approve &amp; apply</button>
              <button type="button" class="draft-btn" onclick={() => handleDiscardProperty(tab.id, draft.draftId)}>Discard</button>
            </div>
          </div>
        {/snippet}

        {#snippet computeOutputBlock(output: CellOutput)}
          {#if output.type === 'text'}
            <pre class="compute-output-text">{output.value}</pre>
          {:else if output.type === 'json'}
            <pre class="compute-output-text">{JSON.stringify(output.value, null, 2)}</pre>
          {:else if output.type === 'table'}
            <div class="compute-output-table">
              <table>
                <thead>
                  <tr>{#each output.columns as col (col)}<th>{col}</th>{/each}</tr>
                </thead>
                <tbody>
                  {#each output.rows.slice(0, 50) as row, ri (ri)}
                    <tr>{#each row as cell, ci (ci)}<td>{formatComputeCell(cell)}</td>{/each}</tr>
                  {/each}
                </tbody>
              </table>
              {#if output.truncated || output.rows.length > 50}
                <div class="compute-output-trailer">
                  Showing {Math.min(output.rows.length, 50)} of {output.totalRows ?? output.rows.length} rows
                </div>
              {/if}
            </div>
          {:else if output.type === 'image'}
            {#if output.mime === 'image/png'}
              <!-- Base64 PNG bytes from matplotlib / PIL. -->
              <img class="compute-output-image" alt="compute output" src={`data:image/png;base64,${output.data}`} />
            {:else}
              <!-- SVG markup — sanitized for the same reasons as html. -->
              <div class="compute-output-image">{@html sanitizeComputeOutputHtml(output.data)}</div>
            {/if}
          {:else if output.type === 'html'}
            <div class="compute-output-html">{@html sanitizeComputeOutputHtml(output.html)}</div>
          {/if}
        {/snippet}

        {#snippet computeDraftCardBlock(draft: ConversationComputeDraft)}
          {@const state = tab.computeDraftState[draft.draftId]}
          {@const editing = computeEditing[draft.draftId] === true}
          {@const code = effectiveComputeCode(draft)}
          {@const result = state?.result ?? null}
          {@const running = state?.running === true}
          {@const insertedAt = state?.insertedAt ?? null}
          {@const armedRisky = computeRiskyAck[draft.draftId] === true}
          <div class="draft-card compute-card">
            <div class="compute-header">
              <span class="compute-lang">{languagePillLabel(draft.language)}</span>
              <span class="draft-note">{draft.rationale}</span>
            </div>
            {#if draft.safetyFlags.length > 0}
              <div class="compute-safety" role="alert">
                <strong>⚠ Risky patterns detected:</strong>
                <ul>
                  {#each draft.safetyFlags as f (f.id)}
                    <li>{@html f.message}</li>
                  {/each}
                </ul>
                {#if armedRisky}
                  <span class="compute-safety-armed">Click Run again to confirm execution.</span>
                {/if}
              </div>
            {/if}
            {#if editing}
              <textarea
                class="compute-edit"
                value={code}
                spellcheck="false"
                oninput={(e) => { computeEdits[draft.draftId] = e.currentTarget.value; }}
                rows={Math.max(4, Math.min(20, code.split('\n').length))}
              ></textarea>
              <div class="compute-edit-actions">
                <button type="button" class="draft-btn" onclick={() => cancelEditCompute(draft.draftId)}>Cancel</button>
                <button type="button" class="draft-btn primary" onclick={() => commitEditCompute(draft.draftId)}>Done</button>
              </div>
            {:else}
              <pre class="compute-code"><code>{code}</code></pre>
            {/if}
            <div class="draft-actions">
              <button
                type="button"
                class="draft-btn primary"
                disabled={running || editing}
                onclick={() => { void handleRunCompute(draft); }}
              >{running ? 'Running…' : armedRisky ? 'Run anyway' : 'Run'}</button>
              {#if !editing}
                <button type="button" class="draft-btn" onclick={() => startEditCompute(draft)}>Edit</button>
              {/if}
              <button
                type="button"
                class="draft-btn"
                disabled={running || editing}
                onclick={() => { void handleInsertCompute(draft); }}
              >Insert into notebook</button>
              <button type="button" class="draft-btn" onclick={() => handleDiscardCompute(draft)}>Discard</button>
            </div>
            {#if insertedAt}
              <div class="compute-inserted">
                Filed as a cell in
                <button
                  type="button"
                  class="filed-link"
                  title={insertedAt}
                  onclick={() => openInsertedNote(insertedAt)}
                >{basename(insertedAt)}</button>
              </div>
            {/if}
            {#if result}
              <div class="compute-output">
                {#if !result.ok}
                  <div class="compute-output-error">
                    <strong>Error:</strong> {result.error}
                  </div>
                {:else}
                  {@render computeOutputBlock(result.output)}
                {/if}
              </div>
            {/if}
          </div>
        {/snippet}

        {#snippet propertyResultLine(_draftId: string, outcomes: PropertyUpdateOutcome[])}
          <!-- Compact "Updated:" line that replaces the propose-property
               card after Approve. Each successfully-patched path is a
               clickable link that opens the note in the editor; the
               count of changed keys is shown in parentheses so the user
               can confirm the patch landed without re-reading the
               frontmatter. -->
          <div class="filed-line">
            <span class="filed-prefix">🔑 Updated:</span>
            {#if outcomes.length === 0}
              <span class="filed-error">(no notes touched)</span>
            {:else}
              {#each outcomes as o, oi (oi)}
                {#if oi > 0}<span class="filed-sep">·</span>{/if}
                {#if o.error}
                  <span class="filed-error" title={o.error}>⚠ {basename(o.relativePath)}</span>
                {:else if o.changedKeys.length === 0}
                  <button
                    type="button"
                    class="filed-link"
                    title="{o.relativePath} — already up to date"
                    onclick={() => openFiledNote(o.relativePath)}
                  >{basename(o.relativePath)}<span class="filed-dup"> · no-op</span></button>
                {:else}
                  <button
                    type="button"
                    class="filed-link"
                    title="{o.relativePath} — {o.changedKeys.join(', ')}"
                    onclick={() => openFiledNote(o.relativePath)}
                  >{basename(o.relativePath)}<span class="filed-dup"> · {o.changedKeys.length} key{o.changedKeys.length === 1 ? '' : 's'}</span></button>
                {/if}
              {/each}
            {/if}
          </div>
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
            {#each draftsAt(tab, i) as draft (draft.draftId)}
              {@render noteDraftCard(draft)}
            {/each}
            {#each sourceDraftsAt(tab, i) as draft (draft.draftId)}
              {@render sourceDraftCardBlock(draft)}
            {/each}
            {#each sourceResultsAt(tab, i) as [draftId, entry] (draftId)}
              {@render sourceResultLine(draftId, entry.outcomes)}
            {/each}
            {#each noteResultsAt(tab, i) as [draftId, entry] (draftId)}
              {@render noteResultLine(draftId, entry.filedPaths)}
            {/each}
            {#each propertyDraftsAt(tab, i) as draft (draft.draftId)}
              {@render propertyDraftCardBlock(draft)}
            {/each}
            {#each propertyResultsAt(tab, i) as [draftId, entry] (draftId)}
              {@render propertyResultLine(draftId, entry.outcomes)}
            {/each}
            {#each computeDraftsAt(tab, i) as draft (draft.draftId)}
              {@render computeDraftCardBlock(draft)}
            {/each}
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
          {#each orphanDrafts(tab) as draft (draft.draftId)}
            {@render noteDraftCard(draft)}
          {/each}
          {#each orphanSourceDrafts(tab) as draft (draft.draftId)}
            {@render sourceDraftCardBlock(draft)}
          {/each}
          {#each orphanSourceResults(tab) as [draftId, entry] (draftId)}
            {@render sourceResultLine(draftId, entry.outcomes)}
          {/each}
          {#each orphanNoteResults(tab) as [draftId, entry] (draftId)}
            {@render noteResultLine(draftId, entry.filedPaths)}
          {/each}
          {#each orphanPropertyDrafts(tab) as draft (draft.draftId)}
            {@render propertyDraftCardBlock(draft)}
          {/each}
          {#each orphanPropertyResults(tab) as [draftId, entry] (draftId)}
            {@render propertyResultLine(draftId, entry.outcomes)}
          {/each}
          {#each orphanComputeDrafts(tab) as draft (draft.draftId)}
            {@render computeDraftCardBlock(draft)}
          {/each}
        </div>

        <div class="composer">
          <div class="composer-card">
            <textarea
              bind:this={composerEl}
              value={tab.composer}
              oninput={handleComposerInput}
              onkeydown={handleKeydown}
              placeholder="Ask about this note, or paste a question…"
              rows="2"
              disabled={tab.streaming}
            ></textarea>
            <div class="composer-footer">
              {#if tab.conversation.contextBundle.notePath}
                <Icon name="notes" size={12} color="var(--text-faint)" />
                <span class="composer-context">{tab.conversation.contextBundle.notePath}</span>
              {/if}
              <span class="composer-spacer"></span>
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
    flex: 1;
    min-width: 0;
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
  .citations li { display: flex; align-items: baseline; gap: 8px; }
  .cite-action {
    flex-shrink: 0;
    border: none;
    background: none;
    padding: 2px 4px;
    font-size: 10px;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
  }
  .cite-action:hover:not(:disabled) { color: var(--accent); background: var(--bg-button); }
  .cite-action:disabled { opacity: 0.4; cursor: default; }
  .cite-action.done { color: var(--accent); cursor: default; }
  .cite-action.error { color: var(--text); }

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
  /* Proposal / draft card (§9.2) — accent-tinted bordered card so a
     proposal pops out of the message stream as something the user is
     about to decide on. Uses oklch color-mix so it tracks palette swaps. */
  .draft-card {
    border: 1px solid color-mix(in oklch, var(--accent) 28%, transparent);
    border-radius: 8px;
    padding: 10px 12px;
    background: color-mix(in oklch, var(--accent) 5%, var(--bg));
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

  /* propose_sources cards. Same outer chrome as note draft cards;
     interior shows a flat list of url/identifier pills rather than the
     expandable preview tree (we don't fetch metadata until Approve, so
     there's nothing to preview pre-ingest). */
  .source-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 3px; }
  .source-list li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 3px 6px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .source-kind {
    display: inline-block;
    min-width: 38px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg, var(--bg-sidebar));
    color: var(--text-muted);
    font-size: 10px;
    text-transform: uppercase;
    text-align: center;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .source-value {
    color: var(--text);
    overflow-wrap: anywhere;
  }

  /* set_properties review card interior. Each per-note patch is a
     small block with the relative path as a header and a key:value
     list underneath. Deleted keys render dimmed with a strikethrough
     marker so removals are visually distinct from sets. */
  .property-update-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .property-update {
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }
  .property-update-path {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 2px;
  }
  .property-kv-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .property-kv {
    display: flex;
    gap: 6px;
    font-size: 12px;
    padding: 1px 4px;
    font-family: var(--font-mono, monospace);
  }
  .property-key {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .property-value {
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .property-kv-delete .property-key,
  .property-kv-delete .property-value {
    color: var(--text-muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--text-muted) 60%, transparent);
  }

  /* propose_compute card (#245). Two-column header with the language
     pill on the left and the LLM's one-line rationale on the right.
     Code uses a monospace pre block; edit mode swaps in a textarea.
     Risky-Python flags surface above the code in a muted alert box,
     and the Run button label changes to "Run anyway" after the first
     click so the second click is the explicit confirmation. */
  .compute-card { gap: 6px; }
  .compute-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .compute-lang {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 3px;
    background: var(--accent);
    color: var(--bg);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .compute-code {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--text);
    white-space: pre;
    overflow-x: auto;
    max-height: 360px;
    overflow-y: auto;
  }
  .compute-code code {
    background: transparent;
    padding: 0;
    font-family: inherit;
  }
  .compute-edit {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--text);
    resize: vertical;
    box-sizing: border-box;
  }
  .compute-edit:focus { outline: none; border-color: var(--accent); }
  .compute-edit-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .compute-safety {
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 3px;
    padding: 6px 10px;
    font-size: 11px;
    background: var(--bg-button);
    color: var(--text);
  }
  .compute-safety ul {
    margin: 4px 0 0 0;
    padding-left: 18px;
    color: var(--text-muted);
  }
  .compute-safety-armed {
    display: block;
    margin-top: 4px;
    color: var(--accent);
    font-weight: 600;
  }
  .compute-output {
    margin-top: 4px;
    padding: 8px 10px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .compute-output-error {
    color: var(--text);
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .compute-output-text {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: var(--text);
    white-space: pre-wrap;
    max-height: 240px;
    overflow-y: auto;
  }
  .compute-output-table {
    overflow-x: auto;
    max-height: 280px;
    overflow-y: auto;
  }
  .compute-output-table table {
    border-collapse: collapse;
    font-size: 11px;
    color: var(--text);
  }
  .compute-output-table th,
  .compute-output-table td {
    padding: 2px 8px;
    border: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  .compute-output-table th {
    background: var(--bg-button);
    font-weight: 600;
  }
  .compute-output-trailer {
    font-size: 10px;
    color: var(--text-muted);
    padding-top: 4px;
  }
  .compute-output-image img,
  .compute-output-image {
    max-width: 100%;
    height: auto;
  }
  .compute-output-html {
    font-size: 12px;
    color: var(--text);
  }
  .compute-inserted {
    font-size: 11px;
    color: var(--text-muted);
    padding: 2px 4px;
  }

  /* Post-Approve summary line — replaces the inline draft card for
     both propose_notes and propose_sources. Single-line, no chrome,
     clickable filenames/titles. Persistent (no dismiss) so the user
     can scroll back later and still navigate to filed resources. */
  .filed-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    padding: 6px 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .filed-prefix {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .filed-sep { color: var(--border); }
  .filed-link {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .filed-link:hover { text-decoration-color: var(--accent); }
  .filed-dup { color: var(--text-muted); text-decoration: none; }
  .filed-error { color: var(--text-muted); }
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
  /* Primary buttons set `color: var(--bg)` for dark-text-on-accent.
     The shared `.draft-btn:hover` rule above sets background to
     var(--bg), which on a primary button collapses text and background
     to the same color — invisible label. Keep the accent background on
     hover and just dim slightly, matching `.send-btn:hover`. */
  .draft-btn.primary:hover:not(:disabled) {
    background: var(--accent);
    opacity: 0.9;
  }
  .draft-btn:disabled { opacity: 0.6; cursor: not-allowed; }

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
  }
  .composer-card:focus-within {
    border-color: var(--accent);
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
