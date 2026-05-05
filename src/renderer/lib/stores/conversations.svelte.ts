import { api } from '../ipc/client';
import type {
  Conversation,
  ContextBundle,
  ConversationsUIState,
} from '../../../shared/types';
import type { ConversationDraft } from '../../../shared/conversation-drafts';
import type {
  AskUserRequest,
  ConversationToolKey,
  TemplateContext,
} from '../../../shared/conversation-templates';
import { getTemplate } from '../conversation/templates';

/**
 * Multi-tab conversations store backing the bottom-docked tool window.
 * Distinct from `conversation.svelte.ts` (single-active-conversation
 * store used by the legacy ConversationDialog modal); the two coexist
 * during Phase 1, and the modal is removed in Phase 3 along with the
 * old store.
 */

interface TabRuntime {
  id: string;
  /** Auto-generated tab title. Set from `template.suggestedTitle(ctx)` when
   *  the tab was opened via a template; otherwise derived from the first
   *  user turn (handled at the panel layer). */
  title: string | null;
  conversation: Conversation;
  drafts: ConversationDraft[];
  /** In-flight ask_user prompt, if the agent is waiting on a reply. */
  pendingQuestion: AskUserRequest | null;
  composer: string;
  streaming: boolean;
  streamedChunks: string;
  /** Template-scoped tools enabled for this conversation (e.g. `ask_user`).
   *  Resolved at openWithTemplate time and re-sent with each turn. In-memory
   *  only — if the user reloads the project, the tab still works but the
   *  agent loses access to template tools (an acceptable degradation since
   *  the agent can fall back to free-form prose questions). */
  extraTools: ConversationToolKey[];
}

const DEFAULT_HEIGHT = 320;
const DEFAULT_UI: ConversationsUIState = {
  visible: false,
  height: DEFAULT_HEIGHT,
  activeTabId: null,
};

let initialized = $state(false);
let visible = $state(false);
let height = $state(DEFAULT_HEIGHT);
let activeTabId = $state<string | null>(null);
let tabs = $state<TabRuntime[]>([]);
// In-flight save coalescer — UI state changes a lot (every keystroke on a
// resize, every visibility toggle) and we don't want to fan out a write
// per change. Debounced via a single timeout that re-arms.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let draftSubscribed = false;
let streamSubscribed = false;
let askUserSubscribed = false;

function findTab(id: string | null): TabRuntime | undefined {
  if (!id) return undefined;
  return tabs.find((t) => t.id === id);
}

function activeTab(): TabRuntime | undefined {
  return findTab(activeTabId);
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void api.conversations.saveUIState({
      visible,
      height,
      activeTabId,
    });
  }, 250);
}

function ensureSubscriptions(): void {
  if (!streamSubscribed) {
    api.conversations.onStream((chunk) => {
      const t = activeTab();
      if (!t || !t.streaming) return;
      t.streamedChunks += chunk;
    });
    streamSubscribed = true;
  }
  if (!draftSubscribed) {
    api.conversations.onDraft((draft) => {
      const t = tabs.find((tab) => tab.id === draft.conversationId);
      if (!t) return;
      t.drafts = [...t.drafts, draft];
    });
    draftSubscribed = true;
  }
  if (!askUserSubscribed) {
    api.conversations.onAskUser((req) => {
      const t = tabs.find((tab) => tab.id === req.conversationId);
      if (!t) {
        // No matching tab — answer empty so the agent can continue rather
        // than hang. Should not happen unless a tab was just closed.
        void api.conversations.askUserReply(req.questionId, '');
        return;
      }
      t.pendingQuestion = req;
    });
    askUserSubscribed = true;
  }
}

async function init(): Promise<void> {
  if (initialized) return;
  initialized = true;
  ensureSubscriptions();
  try {
    const ui = await api.conversations.loadUIState();
    // Always launch hidden — even if the user closed the app with the
    // panel visible. The intent is that the panel doesn't shove the
    // editor up unexpectedly on every launch; the user toggles when
    // they want it (Cmd/Ctrl+Shift+K). Persisted height + last-active
    // tab still apply when they re-open.
    visible = false;
    height = ui.height || DEFAULT_HEIGHT;
    // Restore tab list from the canonical store: any active conversation is
    // an open tab. No parallel "open tabs" persisted list — the status field
    // in `<id>.json` is the source of truth.
    const active = await api.conversations.listActive();
    tabs = active.map((conv) => ({
      id: conv.id,
      title: null,
      conversation: conv,
      drafts: [],
      pendingQuestion: null,
      composer: '',
      streaming: false,
      streamedChunks: '',
      extraTools: [],
    }));
    // Restore last-active tab id only if it still corresponds to an open
    // tab; if the user closed it from a prior session, fall through.
    if (ui.activeTabId && tabs.some((t) => t.id === ui.activeTabId)) {
      activeTabId = ui.activeTabId;
    } else if (tabs.length > 0) {
      activeTabId = tabs[0].id;
    } else {
      activeTabId = null;
    }
  } catch {
    visible = DEFAULT_UI.visible;
    height = DEFAULT_UI.height;
    activeTabId = null;
    tabs = [];
  }
}

async function reset(): Promise<void> {
  // Called when the project changes — drop all in-memory tab state and
  // re-init from the new project's _ui.json + active conversations.
  initialized = false;
  visible = false;
  height = DEFAULT_HEIGHT;
  activeTabId = null;
  tabs = [];
  await init();
}

function show(): void {
  if (!visible) {
    visible = true;
    scheduleSave();
  }
}

function hide(): void {
  if (visible) {
    visible = false;
    scheduleSave();
  }
}

function toggle(): void {
  visible = !visible;
  scheduleSave();
}

function setHeight(px: number): void {
  // Clamp to a sane range so the panel can't be dragged to invisibility
  // or larger than the editor area. Renderer enforces a hard min via CSS,
  // but we also belt-and-suspender it here.
  const next = Math.max(120, Math.min(1200, Math.round(px)));
  if (next !== height) {
    height = next;
    scheduleSave();
  }
}

function setActiveTab(id: string): void {
  if (activeTabId !== id) {
    activeTabId = id;
    scheduleSave();
  }
}

async function openFreeform(originNotePath?: string): Promise<TabRuntime> {
  ensureSubscriptions();
  // Empty context bundle for freeform; the origin note (if any) is the
  // active note at creation time.
  const bundle: ContextBundle = originNotePath ? { notePath: originNotePath } : {};
  const conv = await api.conversations.create(bundle);
  const tab: TabRuntime = {
    id: conv.id,
    title: null,
    conversation: conv,
    drafts: [],
    pendingQuestion: null,
    composer: '',
    streaming: false,
    streamedChunks: '',
    extraTools: [],
  };
  tabs = [...tabs, tab];
  activeTabId = tab.id;
  show();
  scheduleSave();
  return tab;
}

/**
 * General-purpose tab opener. Three call patterns:
 *
 *   - Plain freeform: `openConversationTab({ notePath })` — equivalent to
 *     `openFreeform(notePath)`. The user types the first turn.
 *   - Freeform with auto-sent first message: `openConversationTab({ notePath, initialMessage })`.
 *     Used by the inspections panel to seed "I'd like to discuss this inspection: …".
 *   - Pre-built system prompt + first message: `openConversationTab({ notePath, systemPrompt, model, initialMessage })`.
 *     Used by the ToolPanel / ThinkingTools system to drive the agent
 *     with a tool-prepared prompt and an auto-fired user turn.
 */
async function openConversationTab(opts: {
  notePath?: string;
  systemPrompt?: string;
  model?: string;
  initialMessage?: string;
}): Promise<TabRuntime> {
  ensureSubscriptions();
  const bundle: ContextBundle = opts.notePath ? { notePath: opts.notePath } : {};
  const createOpts: { systemPrompt?: string; model?: string } = {};
  if (opts.systemPrompt) createOpts.systemPrompt = opts.systemPrompt;
  if (opts.model) createOpts.model = opts.model;
  const conv = await api.conversations.create(
    bundle,
    undefined,
    Object.keys(createOpts).length > 0 ? createOpts : undefined,
  );
  const tab: TabRuntime = {
    id: conv.id,
    title: null,
    conversation: conv,
    drafts: [],
    pendingQuestion: null,
    composer: '',
    streaming: false,
    streamedChunks: '',
    extraTools: [],
  };
  tabs = [...tabs, tab];
  activeTabId = tab.id;
  show();
  scheduleSave();
  if (opts.initialMessage && opts.initialMessage.trim()) {
    void send(opts.initialMessage, opts.notePath);
  }
  return tab;
}

/**
 * Open a new conversation tab driven by a template. The template's
 * `buildPrompt(ctx)` text is sent as the first user turn; its
 * `requiresTools` are scoped to this conversation only.
 */
async function openWithTemplate(templateId: string, ctx: TemplateContext): Promise<TabRuntime | null> {
  const template = getTemplate(templateId);
  if (!template) {
    console.warn(`[conv] unknown template: ${templateId}`);
    return null;
  }
  ensureSubscriptions();
  const bundle: ContextBundle = ctx.notePath ? { notePath: ctx.notePath } : {};
  const conv = await api.conversations.create(bundle);
  const tab: TabRuntime = {
    id: conv.id,
    title: template.suggestedTitle?.(ctx) ?? null,
    conversation: conv,
    drafts: [],
    pendingQuestion: null,
    composer: '',
    streaming: false,
    streamedChunks: '',
    extraTools: template.requiresTools ? [...template.requiresTools] : [],
  };
  tabs = [...tabs, tab];
  activeTabId = tab.id;
  show();
  scheduleSave();
  // Auto-send the templated prompt as the first user turn. We don't
  // populate the composer — the user shouldn't see the prompt text in
  // the input field; it goes straight to the wire.
  const prompt = template.buildPrompt(ctx);
  // Fire-and-forget — `send` sets streaming state, the panel renders
  // accordingly. Errors logged inside send().
  void send(prompt, ctx.notePath ?? undefined);
  return tab;
}

async function closeTab(id: string): Promise<void> {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  try {
    await api.conversations.archive(id);
  } catch {
    // If archive fails (e.g., already archived), still drop from the
    // local list so the user sees the tab go away.
  }
  const next = tabs.filter((t) => t.id !== id);
  tabs = next;
  if (activeTabId === id) {
    // Pick a neighbor: the next-right tab if any, else the next-left.
    activeTabId = next[idx]?.id ?? next[idx - 1]?.id ?? null;
  }
  scheduleSave();
}

async function send(content: string, currentNotePath?: string): Promise<void> {
  const tab = activeTab();
  if (!tab) throw new Error('No active conversation');
  const text = content.trim();
  if (!text || tab.streaming) return;
  tab.composer = '';
  tab.streaming = true;
  tab.streamedChunks = '';
  const tools = tab.extraTools.length > 0 ? [...tab.extraTools] : undefined;
  try {
    await api.conversations.send(tab.id, text, undefined, currentNotePath, tools);
    const reloaded = await api.conversations.load(tab.id);
    if (reloaded) tab.conversation = reloaded;
  } catch (e) {
    if (!String(e).includes('abort')) {
      console.error('[conv] send failed:', e);
    }
  } finally {
    tab.streaming = false;
    tab.streamedChunks = '';
  }
}

async function answerQuestion(tabId: string, answer: string): Promise<void> {
  const tab = findTab(tabId);
  if (!tab || !tab.pendingQuestion) return;
  const { questionId } = tab.pendingQuestion;
  tab.pendingQuestion = null;
  await api.conversations.askUserReply(questionId, answer);
}

async function setModel(tabId: string, model: string | undefined): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const updated = await api.conversations.setModel(tabId, model);
  tab.conversation = updated;
}

async function cancel(): Promise<void> {
  await api.conversations.cancel();
  const tab = activeTab();
  if (tab) {
    tab.streaming = false;
    tab.streamedChunks = '';
  }
}

async function approveDraft(tabId: string, draft: ConversationDraft): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  // Snapshot before crossing IPC — Svelte 5 `$state` Proxies fail
  // structured-clone otherwise (see project memory).
  const snapshot = $state.snapshot(draft);
  await api.conversations.fileDraft(snapshot);
  tab.drafts = tab.drafts.filter((d) => d.draftId !== draft.draftId);
}

function discardDraft(tabId: string, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  tab.drafts = tab.drafts.filter((d) => d.draftId !== draftId);
}

function setComposer(value: string): void {
  const tab = activeTab();
  if (tab) tab.composer = value;
}

export function getConversationsStore() {
  return {
    get initialized() { return initialized; },
    get visible() { return visible; },
    get height() { return height; },
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return activeTab(); },
    init,
    reset,
    show,
    hide,
    toggle,
    setHeight,
    setActiveTab,
    openFreeform,
    openConversationTab,
    openWithTemplate,
    closeTab,
    send,
    answerQuestion,
    cancel,
    setModel,
    approveDraft,
    discardDraft,
    setComposer,
  };
}
