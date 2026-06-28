<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { getConversationsStore } from '../stores/conversations.svelte';
  import { getEditorStore } from '../stores/editor.svelte';
  import { getVoiceStore } from '../voice/voice.svelte';
  import { voiceSettings } from '../voice/voice-settings.svelte';
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
    ConversationSourcePropertyDraft,
    SourcePropertyOutcome,
  } from '../../../shared/conversation-source-property-drafts';
  import type {
    ConversationClaimsDraft,
    ClaimsOutcome,
  } from '../../../shared/conversation-claims-drafts';
  import type {
    ConversationComputeDraft,
  } from '../../../shared/conversation-compute-drafts';
  import type { ConversationMessage, Citation } from '../../../shared/types';
  import { insertCitationMarker } from '../conversations/cite-from-conversation';
  import { type CiteStatus } from '../conversations/citations';
  import MessageCitations from './MessageCitations.svelte';
  import DraftCard from './DraftCard.svelte';
  import ComputeDraftCard from './ComputeDraftCard.svelte';
  import RefactorDraftCard from './RefactorDraftCard.svelte';
  import ReorgDraftCard from './ReorgDraftCard.svelte';
  import type { ConversationRefactorDraft, ConversationReorgDraft } from '../../../shared/conversation-refactor-drafts';
  import { getSlashCommands } from '../tools/tool-registry';
  import { slashQueryFromComposer, buildSlashMenu, type SlashMenuItem } from '../conversations/slash-commands';
  import {
    tabTitle,
    formatPropertyValue,
    sourceLabel,
    basename,
    sourceKindLabel,
  } from '../conversations/conversation-display';
  import {
    costBadgeFor,
    formatTurnCost,
  } from '../conversations/conversation-cost';

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
  const voice = getVoiceStore();

  let composerEl = $state<HTMLTextAreaElement>();
  let scrollEl = $state<HTMLDivElement>();
  let expandedDraftIds = $state<Set<string>>(new Set());
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
    return model ?? defaultModel ?? 'claude-sonnet-4-6';
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

  // ── Dictation (#voice) ──────────────────────────────────────────────────
  // The mic toggles recording; stopping transcribes the clip locally (Whisper
  // in a renderer worker) and appends the text to the composer. Audio never
  // leaves the process — only the model weights are fetched, once.
  async function toggleDictation() {
    if (voice.recording) {
      const text = await voice.stopAndTranscribe();
      if (text) {
        const tab = store.activeTab;
        if (tab) {
          const sep = tab.composer && !/\s$/.test(tab.composer) ? ' ' : '';
          store.setComposer(tab.composer + sep + text);
          await tick();
          composerEl?.focus();
        }
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
        selectSlash(slashItems[slashIndex]);
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
      const { filedPaths } = await store.approveDraft(tabId, draft);
      // Open the first filed note so the user lands on what they just approved.
      if (filedPaths.length > 0) void editor.openFile(filedPaths[0]);
    } catch (e) {
      console.error('[conv-panel] approve failed:', e);
    }
  }

  function handleDiscard(tabId: string, draftId: string) {
    store.discardDraft(tabId, draftId);
  }

  async function handleApproveRefactor(tabId: string, draft: ConversationRefactorDraft) {
    try {
      await store.approveRefactorDraft(tabId, draft);
      // Land the user on the note at its new path.
      void editor.openFile(draft.toPath);
    } catch (e) {
      console.error('[conv-panel] approve refactor failed:', e);
    }
  }

  function handleDiscardRefactor(tabId: string, draftId: string) {
    store.discardRefactorDraft(tabId, draftId);
  }

  async function handleApproveReorg(
    tabId: string, draft: ConversationReorgDraft, selected: Array<{ fromPath: string; toPath: string }>,
  ) {
    try {
      await store.approveReorgDraft(tabId, draft, selected);
      // Land on the first moved note at its new path.
      if (selected.length > 0) void editor.openFile(selected[0].toPath);
    } catch (e) {
      console.error('[conv-panel] approve reorg failed:', e);
    }
  }

  function handleDiscardReorg(tabId: string, draftId: string) {
    store.discardReorgDraft(tabId, draftId);
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

  async function handleApproveSourceProperty(tabId: string, draft: ConversationSourcePropertyDraft) {
    try {
      await store.approveSourcePropertyDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve source property failed:', e);
    }
  }

  function handleDiscardSourceProperty(tabId: string, draftId: string) {
    store.discardSourcePropertyDraft(tabId, draftId);
  }

  async function handleApproveClaims(tabId: string, draft: ConversationClaimsDraft) {
    try {
      await store.approveClaimsDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve claims failed:', e);
    }
  }

  function handleDiscardClaims(tabId: string, draftId: string) {
    store.discardClaimsDraft(tabId, draftId);
  }

  // ── propose_compute card actions (#245) ───────────────────────────
  //
  // The edit buffer / edit mode / risky-ack now live inside ComputeDraftCard
  // (per-card view state); the panel only forwards the three store actions and
  // the run state. `edited` is undefined when the cell was never edited.
  function onRunCompute(draft: ConversationComputeDraft, edited: string | undefined): void {
    const tab = store.activeTab;
    if (!tab) return;
    void store.runComputeDraft(tab.id, draft, edited);
  }

  function onInsertCompute(draft: ConversationComputeDraft, edited: string | undefined): void {
    const tab = store.activeTab;
    if (!tab) return;
    void store.insertComputeDraft(tab.id, draft, edited);
  }

  function onDiscardCompute(draft: ConversationComputeDraft): void {
    const tab = store.activeTab;
    if (!tab) return;
    store.discardComputeDraft(tab.id, draft.draftId);
  }

  function openInsertedNote(path: string): void {
    void editor.openFile(path);
  }

  /** Render a frontmatter value for inline display on the review card.
   *  Strings render bare; everything else falls back to compact JSON
   *  so the user can eyeball arrays/objects without scrolling. Null
   *  is shown as a deletion marker. */
  function openFiledNote(relativePath: string) {
    void editor.openFile(relativePath);
  }

  function openFiledSource(sourceId: string) {
    editor.openSource(sourceId);
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
  function sourcePropertyDraftsAt(tab: TabT, i: number) {
    return tab.sourcePropertyDrafts.filter((d) => d.afterMessageIndex === i);
  }
  function sourcePropertyResultsAt(tab: TabT, i: number) {
    return Object.entries(tab.sourcePropertyDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex === i,
    );
  }
  function claimsDraftsAt(tab: TabT, i: number) {
    return tab.claimsDrafts.filter((d) => d.afterMessageIndex === i);
  }
  function claimsResultsAt(tab: TabT, i: number) {
    return Object.entries(tab.claimsDraftResults).filter(
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
  function orphanSourcePropertyDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.sourcePropertyDrafts.filter((d) => d.afterMessageIndex >= max);
  }
  function orphanSourcePropertyResults(tab: TabT) {
    const max = tab.conversation.messages.length;
    return Object.entries(tab.sourcePropertyDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex >= max,
    );
  }
  function orphanClaimsDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.claimsDrafts.filter((d) => d.afterMessageIndex >= max);
  }
  function orphanClaimsResults(tab: TabT) {
    const max = tab.conversation.messages.length;
    return Object.entries(tab.claimsDraftResults).filter(
      ([, entry]) => entry.afterMessageIndex >= max,
    );
  }
  function orphanComputeDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.computeDrafts.filter((d) => d.afterMessageIndex >= max);
  }
  function refactorDraftsAt(tab: TabT, i: number) {
    return tab.refactorDrafts.filter((d) => d.afterMessageIndex === i);
  }
  function orphanRefactorDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.refactorDrafts.filter((d) => d.afterMessageIndex >= max);
  }
  function reorgDraftsAt(tab: TabT, i: number) {
    return tab.reorgDrafts.filter((d) => d.afterMessageIndex === i);
  }
  function orphanReorgDrafts(tab: TabT) {
    const max = tab.conversation.messages.length;
    return tab.reorgDrafts.filter((d) => d.afterMessageIndex >= max);
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
      {@const costBadge = costBadgeFor(tab.conversation.messages)}
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

        {#snippet noteDraftCard(draft: ConversationDraft)}
          <DraftCard
            headline={`${draft.payloads.length} note${draft.payloads.length === 1 ? '' : 's'}`}
            note={draft.note}
            approveLabel="Approve & file"
            onApprove={() => handleApprove(tab.id, draft)}
            onDiscard={() => handleDiscard(tab.id, draft.draftId)}
          >
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
          </DraftCard>
        {/snippet}

        {#snippet sourceDraftCardBlock(draft: ConversationSourceDraft)}
          <DraftCard
            headline={`📚 ${draft.sources.length} source${draft.sources.length === 1 ? '' : 's'}`}
            note={draft.note}
            approveLabel="Approve & ingest"
            onApprove={() => handleApproveSource(tab.id, draft)}
            onDiscard={() => handleDiscardSource(tab.id, draft.draftId)}
          >
            <ul class="source-list">
              {#each draft.sources as s, si (si)}
                <li>
                  <span class="source-kind">{sourceKindLabel(s)}</span>
                  <span class="source-value">{sourceLabel(s)}</span>
                </li>
              {/each}
            </ul>
          </DraftCard>
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
          <DraftCard
            headline={`🔑 ${draft.updates.length} note${draft.updates.length === 1 ? '' : 's'}`}
            note={draft.note}
            approveLabel="Approve & apply"
            onApprove={() => handleApproveProperty(tab.id, draft)}
            onDiscard={() => handleDiscardProperty(tab.id, draft.draftId)}
          >
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
          </DraftCard>
        {/snippet}

        {#snippet sourcePropertyDraftCardBlock(draft: ConversationSourcePropertyDraft)}
          <!-- propose_source_properties review card (#103). Shows the proposed
               abstract / TL;DR for one source; Approve upserts dc:abstract /
               thought:tldr into its meta.ttl. -->
          <DraftCard
            headline="📄 Source summary"
            note={draft.note}
            approveLabel="Approve & apply"
            onApprove={() => handleApproveSourceProperty(tab.id, draft)}
            onDiscard={() => handleDiscardSourceProperty(tab.id, draft.draftId)}
          >
            <div class="property-update-path">{draft.sourceId}</div>
            {#if draft.abstract}
              <div class="source-prop-block">
                <div class="source-prop-label">Abstract</div>
                <div class="source-prop-text">{draft.abstract}</div>
              </div>
            {/if}
            {#if draft.tldr}
              <div class="source-prop-block">
                <div class="source-prop-label">TL;DR</div>
                <div class="source-prop-text">{draft.tldr}</div>
              </div>
            {/if}
          </DraftCard>
        {/snippet}

        {#snippet sourcePropertyResultLine(_draftId: string, outcome: SourcePropertyOutcome)}
          <div class="filed-line">
            <span class="filed-prefix">📄 Updated:</span>
            {#if outcome.error}
              <span class="filed-error" title={outcome.error}>⚠ {outcome.sourceId}</span>
            {:else if outcome.changedPredicates.length === 0}
              <span class="filed-error">{outcome.sourceId} · no change</span>
            {:else}
              <span class="filed-link" title={outcome.sourceId}>{outcome.sourceId} · {outcome.changedPredicates.join(', ')}</span>
            {/if}
          </div>
        {/snippet}

        {#snippet claimsDraftCardBlock(draft: ConversationClaimsDraft)}
          <!-- propose_claims review card (#104). Each claim shows its kind,
               confidence, and the supporting quote; Approve files claim notes +
               excerpt nodes through the approval engine. -->
          <DraftCard
            headline={`🧩 ${draft.claims.length} claim${draft.claims.length === 1 ? '' : 's'}`}
            note={draft.note}
            approveLabel="Approve & file"
            onApprove={() => handleApproveClaims(tab.id, draft)}
            onDiscard={() => handleDiscardClaims(tab.id, draft.draftId)}
          >
            <ul class="claims-list">
              {#each draft.claims as c, ci (ci)}
                <li class="claim-item">
                  <div class="claim-head">
                    <span class="claim-kind">{c.kind}</span>
                    <span class="claim-conf">conf {c.confidence.toFixed(2)}</span>
                    {#if !c.quoteFound}<span class="claim-approx" title="Quote wasn't a verbatim substring of the body — excerpt files without a character anchor">approx</span>{/if}
                  </div>
                  <div class="claim-text">{c.text}</div>
                  <div class="claim-quote">{c.quote}</div>
                </li>
              {/each}
            </ul>
          </DraftCard>
        {/snippet}

        {#snippet claimsResultLine(_draftId: string, outcome: ClaimsOutcome)}
          <div class="filed-line">
            <span class="filed-prefix">🧩 Filed:</span>
            {#if outcome.error}
              <span class="filed-error" title={outcome.error}>⚠ {outcome.sourceId}</span>
            {:else}
              {#each outcome.claimPaths as p, pi (p)}
                {#if pi > 0}<span class="filed-sep">·</span>{/if}
                <button type="button" class="filed-link" title={p} onclick={() => openFiledNote(p)}>{basename(p)}</button>
              {/each}
              <span class="filed-dup"> · {outcome.excerptIds.length} excerpt{outcome.excerptIds.length === 1 ? '' : 's'}</span>
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
            {#each sourcePropertyDraftsAt(tab, i) as draft (draft.draftId)}
              {@render sourcePropertyDraftCardBlock(draft)}
            {/each}
            {#each sourcePropertyResultsAt(tab, i) as [draftId, entry] (draftId)}
              {@render sourcePropertyResultLine(draftId, entry.outcome)}
            {/each}
            {#each claimsDraftsAt(tab, i) as draft (draft.draftId)}
              {@render claimsDraftCardBlock(draft)}
            {/each}
            {#each claimsResultsAt(tab, i) as [draftId, entry] (draftId)}
              {@render claimsResultLine(draftId, entry.outcome)}
            {/each}
            {#each computeDraftsAt(tab, i) as draft (draft.draftId)}
              <ComputeDraftCard
                {draft}
                runState={tab.computeDraftState[draft.draftId]}
                onRun={onRunCompute}
                onInsert={onInsertCompute}
                onDiscard={onDiscardCompute}
                onOpenInserted={openInsertedNote}
              />
            {/each}
            {#each refactorDraftsAt(tab, i) as draft (draft.draftId)}
              <RefactorDraftCard
                {draft}
                onApprove={() => handleApproveRefactor(tab.id, draft)}
                onDiscard={() => handleDiscardRefactor(tab.id, draft.draftId)}
              />
            {/each}
            {#each reorgDraftsAt(tab, i) as draft (draft.draftId)}
              <ReorgDraftCard
                {draft}
                onApprove={(selected) => handleApproveReorg(tab.id, draft, selected)}
                onDiscard={() => handleDiscardReorg(tab.id, draft.draftId)}
              />
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
          {#each orphanSourcePropertyDrafts(tab) as draft (draft.draftId)}
            {@render sourcePropertyDraftCardBlock(draft)}
          {/each}
          {#each orphanSourcePropertyResults(tab) as [draftId, entry] (draftId)}
            {@render sourcePropertyResultLine(draftId, entry.outcome)}
          {/each}
          {#each orphanClaimsDrafts(tab) as draft (draft.draftId)}
            {@render claimsDraftCardBlock(draft)}
          {/each}
          {#each orphanClaimsResults(tab) as [draftId, entry] (draftId)}
            {@render claimsResultLine(draftId, entry.outcome)}
          {/each}
          {#each orphanComputeDrafts(tab) as draft (draft.draftId)}
            <ComputeDraftCard
              {draft}
              runState={tab.computeDraftState[draft.draftId]}
              onRun={onRunCompute}
              onInsert={onInsertCompute}
              onDiscard={onDiscardCompute}
              onOpenInserted={openInsertedNote}
            />
          {/each}
          {#each orphanRefactorDrafts(tab) as draft (draft.draftId)}
            <RefactorDraftCard
              {draft}
              onApprove={() => handleApproveRefactor(tab.id, draft)}
              onDiscard={() => handleDiscardRefactor(tab.id, draft.draftId)}
            />
          {/each}
          {#each orphanReorgDrafts(tab) as draft (draft.draftId)}
            <ReorgDraftCard
              {draft}
              onApprove={(selected) => handleApproveReorg(tab.id, draft, selected)}
              onDiscard={() => handleDiscardReorg(tab.id, draft.draftId)}
            />
          {/each}
        </div>

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
  .drafts-label { font-size: 11px; color: var(--text-muted); }
  /* Proposal / draft card (§9.2) — accent-tinted bordered card so a
     proposal pops out of the message stream as something the user is
     about to decide on. Uses oklch color-mix so it tracks palette swaps. */
  /* Draft-card chrome (.draft-card / .draft-note / .draft-actions / .draft-btn)
     now lives in DraftCard.svelte and ComputeDraftCard.svelte. Only the
     card-body styles below (.draft-paths, source/property/claims lists) remain
     here — they render as DraftCard children, so they keep the panel's scope. */
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
  /* propose_source_properties card (#103). */
  .source-prop-block {
    margin: 6px 0;
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }
  .source-prop-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 2px;
  }
  .source-prop-text {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
  }
  /* propose_claims card (#104). */
  .claims-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .claim-item {
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }
  .claim-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 10px;
    margin-bottom: 2px;
  }
  .claim-kind {
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }
  .claim-conf { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .claim-approx {
    color: var(--bg);
    background: var(--text-muted);
    border-radius: 3px;
    padding: 0 4px;
  }
  .claim-text { font-size: 13px; color: var(--text); }
  .claim-quote {
    font-size: 11px;
    color: var(--text-muted);
    border-left: 2px solid var(--border);
    padding-left: 6px;
    margin-top: 2px;
    white-space: pre-wrap;
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
