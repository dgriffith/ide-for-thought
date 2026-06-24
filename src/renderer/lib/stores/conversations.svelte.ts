import { api } from '../ipc/client';
import type {
  Conversation,
  ContextBundle,
  ConversationsUIState,
} from '../../../shared/types';
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
import type {
  ConversationSourcePropertyDraft,
  SourcePropertyOutcome,
} from '../../../shared/conversation-source-property-drafts';
import type {
  ConversationClaimsDraft,
  ClaimsOutcome,
} from '../../../shared/conversation-claims-drafts';
import type { CellResult } from '../../../shared/compute/types';
import type {
  AskUserRequest,
  ConversationToolKey,
} from '../../../shared/conversation-tools';
import { isMissingApiKeyError } from '../../../shared/llm-errors';

/**
 * Multi-tab conversations store backing the bottom-docked tool window.
 */

/**
 * Cards that arrive mid-turn (note drafts, source drafts, the
 * post-Approve result for a source draft) need to be visually anchored
 * to the assistant message they came from. Otherwise a follow-up user
 * turn slots in *above* the card from the prior turn (since cards used
 * to render at panel-bottom regardless of which turn produced them),
 * breaking the chronological read of the conversation.
 *
 * `afterMessageIndex` is the index in `conversation.messages` of the
 * assistant message the card belongs to. Captured at card-arrival time
 * as `messages.length` — i.e. the slot where the *next* assistant
 * message will land (the optimistic user message has already been
 * pushed in `send()`, so length is already past it). After the
 * end-of-send reload, the real assistant message occupies exactly that
 * index, and the panel renders the card inline right after it.
 *
 * Cards whose anchor is out of range (e.g. arrived during a turn whose
 * assistant message hasn't been persisted yet, or after a cancel) get
 * rendered as orphans at the bottom of the message list — same visual
 * position as the pre-anchoring behavior, just for the narrow window
 * before reload lands.
 */
type AnchoredDraft = ConversationDraft & { afterMessageIndex: number };
type AnchoredSourceDraft = ConversationSourceDraft & { afterMessageIndex: number };
type AnchoredPropertyDraft = ConversationPropertyDraft & { afterMessageIndex: number };
type AnchoredSourcePropertyDraft = ConversationSourcePropertyDraft & { afterMessageIndex: number };
type AnchoredClaimsDraft = ConversationClaimsDraft & { afterMessageIndex: number };
interface SourceDraftResultEntry {
  outcomes: SourceIngestOutcome[];
  afterMessageIndex: number;
}
interface PropertyDraftResultEntry {
  outcomes: PropertyUpdateOutcome[];
  afterMessageIndex: number;
}
interface SourcePropertyDraftResultEntry {
  outcome: SourcePropertyOutcome;
  afterMessageIndex: number;
}
interface ClaimsDraftResultEntry {
  outcome: ClaimsOutcome;
  afterMessageIndex: number;
}
/** Post-Approve summary for a propose_notes draft. Persists in the
 *  conversation transcript so the user can still click through to filed
 *  notes after scrolling past the approval. `filedPaths` is what the
 *  approval engine actually wrote (collision-deduped), not what was
 *  proposed. */
interface NoteDraftResultEntry {
  filedPaths: string[];
  afterMessageIndex: number;
}
type AnchoredComputeDraft = ConversationComputeDraft & { afterMessageIndex: number };
/** Per-draft state for compute proposals (#245). `result` holds the
 *  output of the most recent Run; `insertedAt` records the destination
 *  path when the user chose Insert into notebook. Both are optional —
 *  a draft that hasn't been acted on yet has neither set. */
interface ComputeDraftStateEntry {
  /** Latest cell result after Run. Null while pending. */
  result: CellResult | null;
  /** True while a Run is in-flight, so the panel can show a spinner
   *  and disable the buttons. */
  running: boolean;
  /** Destination path written by the most recent Insert action. */
  insertedAt: string | null;
  afterMessageIndex: number;
}

interface TabRuntime {
  id: string;
  /** Auto-generated tab title. Set when a tool seeds the tab via
   *  `openConversationTab({ title })`; otherwise derived from the first
   *  user turn (handled at the panel layer). */
  title: string | null;
  conversation: Conversation;
  drafts: AnchoredDraft[];
  /** propose_sources drafts awaiting Approve/Discard. */
  sourceDrafts: AnchoredSourceDraft[];
  /** Outcomes from the most recent fileSourceDraft call per draft id —
   *  rendered as a compact "Filed:" line in place of the card. Keyed by
   *  draftId; inherits `afterMessageIndex` from the originating draft
   *  so the result line stays anchored to the same assistant message
   *  as the draft it replaces. */
  sourceDraftResults: Record<string, SourceDraftResultEntry>;
  /** Filed-paths summary per approved propose_notes draft id. Same
   *  anchoring story as `sourceDraftResults` — the line sits where the
   *  card used to so the user isn't left wondering what landed. */
  noteDraftResults: Record<string, NoteDraftResultEntry>;
  /** set_properties drafts awaiting Approve/Discard. */
  propertyDrafts: AnchoredPropertyDraft[];
  /** Per-update outcomes after Approve on a property draft — used to
   *  render the post-Approve "Updated:" line in place of the card. */
  propertyDraftResults: Record<string, PropertyDraftResultEntry>;
  /** propose_source_properties drafts awaiting Approve/Discard (#103). */
  sourcePropertyDrafts: AnchoredSourcePropertyDraft[];
  /** Per-draft outcome after Approve on a source-property draft — renders
   *  the post-Approve "Updated:" line in place of the card. */
  sourcePropertyDraftResults: Record<string, SourcePropertyDraftResultEntry>;
  /** propose_claims drafts awaiting Approve/Discard (#104). */
  claimsDrafts: AnchoredClaimsDraft[];
  /** Per-draft outcome after Approve on a claims draft — renders the
   *  post-Approve "Filed:" line in place of the card. */
  claimsDraftResults: Record<string, ClaimsDraftResultEntry>;
  /** propose_compute drafts awaiting Run / Insert / Discard. */
  computeDrafts: AnchoredComputeDraft[];
  /** Per-draft Run / Insert state. Stays alive after Run so the user
   *  can see the cell + output in the transcript; only Discard removes
   *  the draft entirely (which also drops the state entry). */
  computeDraftState: Record<string, ComputeDraftStateEntry>;
  /** In-flight ask_user prompt, if the agent is waiting on a reply. */
  pendingQuestion: AskUserRequest | null;
  composer: string;
  streaming: boolean;
  streamedChunks: string;
  /** Template-scoped tools enabled for this conversation (e.g. `ask_user`).
   *  Resolved at tab-creation time and re-sent with each turn. In-memory
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
/** One-shot flag flipped to true when a `send()` failed because no
 *  Anthropic API key is configured. App.svelte's `$effect` reads it,
 *  shows the missing-key dialog, then calls `dismissApiKeyDialog()`. */
let needsApiKey = $state(false);
// In-flight save coalescer — UI state changes a lot (every keystroke on a
// resize, every visibility toggle) and we don't want to fan out a write
// per change. Debounced via a single timeout that re-arms.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let draftSubscribed = false;
let sourceDraftSubscribed = false;
let propertyDraftSubscribed = false;
let sourcePropertyDraftSubscribed = false;
let claimsDraftSubscribed = false;
let computeDraftSubscribed = false;
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
      // Anchor to the slot the streaming assistant message will land in
      // post-reload. `messages.length` already counts the optimistic
      // user turn `send()` pushed before awaiting the IPC, so it points
      // at where the assistant turn will be appended.
      const afterMessageIndex = t.conversation.messages.length;
      t.drafts = [...t.drafts, { ...draft, afterMessageIndex }];
    });
    draftSubscribed = true;
  }
  if (!sourceDraftSubscribed) {
    api.conversations.onSourceDraft((draft) => {
      const t = tabs.find((tab) => tab.id === draft.conversationId);
      if (!t) return;
      const afterMessageIndex = t.conversation.messages.length;
      t.sourceDrafts = [...t.sourceDrafts, { ...draft, afterMessageIndex }];
    });
    sourceDraftSubscribed = true;
  }
  if (!propertyDraftSubscribed) {
    api.conversations.onPropertyDraft((draft) => {
      const t = tabs.find((tab) => tab.id === draft.conversationId);
      if (!t) return;
      const afterMessageIndex = t.conversation.messages.length;
      t.propertyDrafts = [...t.propertyDrafts, { ...draft, afterMessageIndex }];
    });
    propertyDraftSubscribed = true;
  }
  if (!sourcePropertyDraftSubscribed) {
    api.conversations.onSourcePropertyDraft((draft) => {
      const t = tabs.find((tab) => tab.id === draft.conversationId);
      if (!t) return;
      const afterMessageIndex = t.conversation.messages.length;
      t.sourcePropertyDrafts = [...t.sourcePropertyDrafts, { ...draft, afterMessageIndex }];
    });
    sourcePropertyDraftSubscribed = true;
  }
  if (!claimsDraftSubscribed) {
    api.conversations.onClaimsDraft((draft) => {
      const t = tabs.find((tab) => tab.id === draft.conversationId);
      if (!t) return;
      const afterMessageIndex = t.conversation.messages.length;
      t.claimsDrafts = [...t.claimsDrafts, { ...draft, afterMessageIndex }];
    });
    claimsDraftSubscribed = true;
  }
  if (!computeDraftSubscribed) {
    api.conversations.onComputeDraft((draft) => {
      const t = tabs.find((tab) => tab.id === draft.conversationId);
      if (!t) return;
      const afterMessageIndex = t.conversation.messages.length;
      t.computeDrafts = [...t.computeDrafts, { ...draft, afterMessageIndex }];
      // Seed the state entry so the panel can render a pristine card
      // immediately (no Run yet, no Insert yet).
      t.computeDraftState = {
        ...t.computeDraftState,
        [draft.draftId]: {
          result: null,
          running: false,
          insertedAt: null,
          afterMessageIndex,
        },
      };
    });
    computeDraftSubscribed = true;
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
      sourceDrafts: [],
      sourceDraftResults: {},
      noteDraftResults: {},
      propertyDrafts: [],
      propertyDraftResults: {},
      sourcePropertyDrafts: [],
      sourcePropertyDraftResults: {},
      claimsDrafts: [],
      claimsDraftResults: {},
      computeDrafts: [],
      computeDraftState: {},
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
    sourceDrafts: [],
    sourceDraftResults: {},
    noteDraftResults: {},
    propertyDrafts: [],
    propertyDraftResults: {},
    sourcePropertyDrafts: [],
    sourcePropertyDraftResults: {},
    claimsDrafts: [],
    claimsDraftResults: {},
    computeDrafts: [],
    computeDraftState: {},
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
  /** Template-scoped tools (e.g. `'ask_user'`) the agent should have in
   *  scope for this conversation. Mirrors ConversationTemplate's
   *  `requiresTools` and ThinkingTool's `requiresTools` (#514). */
  extraTools?: ConversationToolKey[];
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
    sourceDrafts: [],
    sourceDraftResults: {},
    noteDraftResults: {},
    propertyDrafts: [],
    propertyDraftResults: {},
    sourcePropertyDrafts: [],
    sourcePropertyDraftResults: {},
    claimsDrafts: [],
    claimsDraftResults: {},
    computeDrafts: [],
    computeDraftState: {},
    pendingQuestion: null,
    composer: '',
    streaming: false,
    streamedChunks: '',
    extraTools: opts.extraTools ? [...opts.extraTools] : [],
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
  // Echo the user's turn into the transcript immediately. The IPC call below
  // doesn't resolve until the assistant has finished streaming, and without
  // this echo the user sees their message vanish from the composer with
  // nothing replacing it for up to tens of seconds — making the first turn
  // feel like it didn't register. The end-of-send `load()` replaces this
  // array with the canonical persisted version (which contains the same
  // user message plus the assistant reply), so the optimistic insert is
  // not a permanent fork of state.
  tab.conversation.messages = [
    ...tab.conversation.messages,
    { role: 'user', content: text, timestamp: new Date().toISOString() },
  ];
  tab.streaming = true;
  tab.streamedChunks = '';
  const tools = tab.extraTools.length > 0 ? [...tab.extraTools] : undefined;
  try {
    await api.conversations.send(tab.id, text, undefined, currentNotePath, tools);
    const reloaded = await api.conversations.load(tab.id);
    if (reloaded) tab.conversation = reloaded;
  } catch (e) {
    if (isMissingApiKeyError(e)) {
      // Surface as an actionable modal at the App level rather than a
      // silent console.error — the user's optimistic message would
      // otherwise just sit in the transcript with no explanation. Also
      // drop that optimistic insert so the transcript isn't littered
      // with un-replied turns after the user wires up a key.
      tab.conversation.messages = tab.conversation.messages.slice(0, -1);
      tab.composer = text;
      needsApiKey = true;
    } else if (!String(e).includes('abort')) {
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

/**
 * Dispatch a reserved built-in slash command (#822). Built-ins are app-level
 * conversation operations, not skills — the composer's slash menu routes them
 * here instead of through `onInvokeSkill`. Handlers land in #823 (`clear`) and
 * #824 (`compact`); an unknown/not-yet-wired name no-ops loudly rather than
 * throwing into the composer's keydown path.
 */
function runBuiltinCommand(name: string): void {
  switch (name) {
    default:
      // Reserved but not yet wired (handlers land in #823/#824). No-op
      // loudly rather than throwing into the composer's keydown path.
      console.warn(`[conv] no handler for built-in command: /${name}`);
  }
}

async function cancel(): Promise<void> {
  await api.conversations.cancel();
  const tab = activeTab();
  if (tab) {
    tab.streaming = false;
    tab.streamedChunks = '';
  }
}

async function approveDraft(tabId: string, draft: ConversationDraft): Promise<{ filedPaths: string[] }> {
  const tab = findTab(tabId);
  if (!tab) return { filedPaths: [] };
  // Inherit the draft's anchor so the result line lands on the same
  // assistant turn the card was attached to.
  const anchored = tab.drafts.find((d) => d.draftId === draft.draftId);
  const afterMessageIndex = anchored?.afterMessageIndex ?? tab.conversation.messages.length;
  // Snapshot before crossing IPC — Svelte 5 `$state` Proxies fail
  // structured-clone otherwise (see project memory).
  const snapshot = $state.snapshot(draft);
  const result = await api.conversations.fileDraft(snapshot);
  // Drop the in-flight card and replace it with a persistent "Filed:"
  // summary keyed by the same draftId. `filedPaths` reflects the actual
  // post-collision-dedup paths the approval engine wrote.
  tab.drafts = tab.drafts.filter((d) => d.draftId !== draft.draftId);
  tab.noteDraftResults = {
    ...tab.noteDraftResults,
    [draft.draftId]: { filedPaths: result.filedPaths, afterMessageIndex },
  };
  return { filedPaths: result.filedPaths };
}

function discardDraft(tabId: string, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  tab.drafts = tab.drafts.filter((d) => d.draftId !== draftId);
}

async function approveSourceDraft(
  tabId: string,
  draft: ConversationSourceDraft,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  // Find the anchored entry so the result card inherits the same
  // afterMessageIndex — the visual "this happened on that turn"
  // grouping should survive Approve → result replacement.
  const anchored = tab.sourceDrafts.find((d) => d.draftId === draft.draftId);
  const afterMessageIndex = anchored?.afterMessageIndex ?? tab.conversation.messages.length;
  // Snapshot before crossing IPC — same Svelte 5 $state Proxy issue
  // that bit propose_notes.
  const snapshot = $state.snapshot(draft);
  const result = await api.conversations.fileSourceDraft(snapshot);
  // Drop the in-flight card and stash the per-source outcomes so the
  // panel can replace the card with a brief status summary.
  tab.sourceDrafts = tab.sourceDrafts.filter((d) => d.draftId !== draft.draftId);
  tab.sourceDraftResults = {
    ...tab.sourceDraftResults,
    [draft.draftId]: { outcomes: result.outcomes, afterMessageIndex },
  };
}

function dismissSourceDraftResult(tabId: string, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  const next = { ...tab.sourceDraftResults };
  delete next[draftId];
  tab.sourceDraftResults = next;
}

function discardSourceDraft(tabId: string, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  tab.sourceDrafts = tab.sourceDrafts.filter((d) => d.draftId !== draftId);
}

async function approvePropertyDraft(
  tabId: string,
  draft: ConversationPropertyDraft,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const anchored = tab.propertyDrafts.find((d) => d.draftId === draft.draftId);
  const afterMessageIndex = anchored?.afterMessageIndex ?? tab.conversation.messages.length;
  // Snapshot via JSON round-trip rather than `$state.snapshot` here.
  // The propose_notes/propose_sources path uses `$state.snapshot` and
  // works fine because its DraftPayload values are all primitives
  // (relativePath/content/url/identifier strings). PropertyUpdate
  // contains a nested `Record<string, unknown>` with arbitrary keys,
  // and a reported bug — "set_properties approved but no frontmatter
  // landed" — was traced to that inner object arriving on the main
  // side empty after $state.snapshot → IPC structured-clone. The
  // JSON round-trip drops any lingering Proxy wrapping unconditionally
  // and produces a payload IPC can serialize without losing keys.
  const plain = JSON.parse(JSON.stringify(draft)) as ConversationPropertyDraft;
  console.log('[conv] approvePropertyDraft sending', {
    draftId: plain.draftId,
    updateCount: plain.updates.length,
    propertyKeySamples: plain.updates.slice(0, 3).map((u) => ({
      relativePath: u.relativePath,
      keys: Object.keys(u.properties ?? {}),
    })),
  });
  const result = await api.conversations.filePropertyDraft(plain);
  tab.propertyDrafts = tab.propertyDrafts.filter((d) => d.draftId !== draft.draftId);
  tab.propertyDraftResults = {
    ...tab.propertyDraftResults,
    [draft.draftId]: { outcomes: result.outcomes, afterMessageIndex },
  };
}

function discardPropertyDraft(tabId: string, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  tab.propertyDrafts = tab.propertyDrafts.filter((d) => d.draftId !== draftId);
}

async function approveSourcePropertyDraft(
  tabId: string,
  draft: ConversationSourcePropertyDraft,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const anchored = tab.sourcePropertyDrafts.find((d) => d.draftId === draft.draftId);
  const afterMessageIndex = anchored?.afterMessageIndex ?? tab.conversation.messages.length;
  // JSON round-trip to shed any $state Proxy before IPC structured-clone —
  // same defensive snapshot the property-draft path uses (#103).
  const plain = JSON.parse(JSON.stringify(draft)) as ConversationSourcePropertyDraft;
  const result = await api.conversations.fileSourcePropertyDraft(plain);
  tab.sourcePropertyDrafts = tab.sourcePropertyDrafts.filter((d) => d.draftId !== draft.draftId);
  tab.sourcePropertyDraftResults = {
    ...tab.sourcePropertyDraftResults,
    [draft.draftId]: { outcome: result.outcome, afterMessageIndex },
  };
}

function discardSourcePropertyDraft(tabId: string, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  tab.sourcePropertyDrafts = tab.sourcePropertyDrafts.filter((d) => d.draftId !== draftId);
}

async function approveClaimsDraft(
  tabId: string,
  draft: ConversationClaimsDraft,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const anchored = tab.claimsDrafts.find((d) => d.draftId === draft.draftId);
  const afterMessageIndex = anchored?.afterMessageIndex ?? tab.conversation.messages.length;
  // JSON round-trip to shed any $state Proxy before IPC structured-clone —
  // the claims array is nested, so this is the safe snapshot (#104).
  const plain = JSON.parse(JSON.stringify(draft)) as ConversationClaimsDraft;
  const result = await api.conversations.fileClaimsDraft(plain);
  tab.claimsDrafts = tab.claimsDrafts.filter((d) => d.draftId !== draft.draftId);
  tab.claimsDraftResults = {
    ...tab.claimsDraftResults,
    [draft.draftId]: { outcome: result.outcome, afterMessageIndex },
  };
}

function discardClaimsDraft(tabId: string, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  tab.claimsDrafts = tab.claimsDrafts.filter((d) => d.draftId !== draftId);
}

async function runComputeDraft(
  tabId: string,
  draft: ConversationComputeDraft,
  editedCode?: string,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const state = tab.computeDraftState[draft.draftId];
  if (state) {
    // Mark in-flight so the panel can render a spinner + disable buttons.
    tab.computeDraftState = {
      ...tab.computeDraftState,
      [draft.draftId]: { ...state, running: true },
    };
  }
  // JSON round-trip to drop any Svelte 5 $state proxy wrapping before
  // IPC — same defense used by the property-draft path after the
  // dynamic-key serialization bug.
  const plain = JSON.parse(JSON.stringify({ draft, editedCode })) as {
    draft: ConversationComputeDraft;
    editedCode?: string;
  };
  try {
    const { result } = await api.conversations.runComputeDraft(plain);
    tab.computeDraftState = {
      ...tab.computeDraftState,
      [draft.draftId]: {
        result,
        running: false,
        insertedAt: tab.computeDraftState[draft.draftId]?.insertedAt ?? null,
        afterMessageIndex: tab.computeDraftState[draft.draftId]?.afterMessageIndex
          ?? tab.conversation.messages.length,
      },
    };
    // Reload the conversation so the user-role context message the
    // main process appended shows up immediately in the transcript.
    const reloaded = await api.conversations.load(tab.id);
    if (reloaded) tab.conversation = reloaded;
  } catch (e) {
    console.error('[conv] run compute draft failed:', e);
    tab.computeDraftState = {
      ...tab.computeDraftState,
      [draft.draftId]: {
        result: { ok: false, error: e instanceof Error ? e.message : String(e) },
        running: false,
        insertedAt: tab.computeDraftState[draft.draftId]?.insertedAt ?? null,
        afterMessageIndex: tab.computeDraftState[draft.draftId]?.afterMessageIndex
          ?? tab.conversation.messages.length,
      },
    };
  }
}

async function insertComputeDraft(
  tabId: string,
  draft: ConversationComputeDraft,
  editedCode?: string,
  destinationPath?: string,
): Promise<string | null> {
  const tab = findTab(tabId);
  if (!tab) return null;
  const plain = JSON.parse(JSON.stringify({ draft, editedCode, destinationPath })) as {
    draft: ConversationComputeDraft;
    editedCode?: string;
    destinationPath?: string;
  };
  try {
    const { destinationPath: where } = await api.conversations.insertComputeDraft(plain);
    const prior = tab.computeDraftState[draft.draftId];
    tab.computeDraftState = {
      ...tab.computeDraftState,
      [draft.draftId]: {
        result: prior?.result ?? null,
        running: false,
        insertedAt: where,
        afterMessageIndex: prior?.afterMessageIndex ?? tab.conversation.messages.length,
      },
    };
    return where;
  } catch (e) {
    console.error('[conv] insert compute draft failed:', e);
    return null;
  }
}

function discardComputeDraft(tabId: string, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  tab.computeDrafts = tab.computeDrafts.filter((d) => d.draftId !== draftId);
  const next = { ...tab.computeDraftState };
  delete next[draftId];
  tab.computeDraftState = next;
}

function setComposer(value: string): void {
  const tab = activeTab();
  if (tab) tab.composer = value;
}

function dismissApiKeyDialog(): void {
  needsApiKey = false;
}

export function getConversationsStore() {
  return {
    get initialized() { return initialized; },
    get visible() { return visible; },
    get height() { return height; },
    get tabs() { return tabs; },
    get activeTabId() { return activeTabId; },
    get activeTab() { return activeTab(); },
    get needsApiKey() { return needsApiKey; },
    dismissApiKeyDialog,
    init,
    reset,
    show,
    hide,
    toggle,
    setHeight,
    setActiveTab,
    openFreeform,
    openConversationTab,
    closeTab,
    send,
    answerQuestion,
    cancel,
    setModel,
    runBuiltinCommand,
    approveDraft,
    discardDraft,
    approveSourceDraft,
    discardSourceDraft,
    dismissSourceDraftResult,
    approvePropertyDraft,
    discardPropertyDraft,
    approveSourcePropertyDraft,
    discardSourcePropertyDraft,
    approveClaimsDraft,
    discardClaimsDraft,
    runComputeDraft,
    insertComputeDraft,
    discardComputeDraft,
    setComposer,
  };
}
