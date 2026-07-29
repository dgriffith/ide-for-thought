<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { getConversationsStore } from '../stores/conversations.svelte';
  import { getDialogStore } from '../stores/dialogs.svelte';
  import { CONFIRM_KEYS } from '../confirm-keys';
  import { api } from '../ipc/client';
  import { groupedModelOptions, modelLabel, DEFAULT_MODEL } from '../../../shared/tools/models';
  import type { CustomModel } from '../../../shared/tools/types';
  import {
    EFFORT_LEVELS,
    supportedEfforts,
    modelSupportsEffort,
    effortSupported,
    clampEffort,
    isEffort,
    type Effort,
  } from '../../../shared/tools/effort';
  import Composer from './conversations/Composer.svelte';
  import MessageList from './conversations/MessageList.svelte';
  import { tabTitle } from '../conversations/conversation-display';

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
  const { showConfirm } = getDialogStore();

  let composer = $state<{ focus: () => void }>();
  let messageList = $state<{ getPaneSelectionText: () => string }>();
  let resizing = $state(false);
  // Project-default model — used to label the "Default" option so the
  // user can see which concrete model "default" resolves to.
  let defaultModel = $state<string | null>(null);
  let defaultEffort = $state<Effort | undefined>(undefined);
  // User-defined local models, merged into the picker (BYOM #1498).
  let customModels = $state<CustomModel[]>([]);
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
      customModels = s.customModels ? [...s.customModels] : [];
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
      // Only honour a selection that lives inside the conversation pane — the
      // MessageList guards that so an editor selection can't trigger by accident.
      const selectionText = messageList?.getPaneSelectionText() ?? '';
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

  /** Resolve the model a conversation actually runs on (override → global
   *  default → built-in fallback), for gating the effort picker. */
  function effectiveModel(model: string | undefined): string {
    return model ?? defaultModel ?? DEFAULT_MODEL;
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
            {#each groupedModelOptions(customModels) as g (g.provider)}
              <optgroup label={g.label}>
                {#each g.models as m (m.value)}
                  <option value={m.value}>{m.label}</option>
                {/each}
              </optgroup>
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

        <MessageList {tab} {currentNotePath} bind:this={messageList} />

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
