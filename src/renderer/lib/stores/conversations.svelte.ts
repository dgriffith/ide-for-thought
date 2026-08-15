import { api } from '../ipc/client';
import { getConversationsSettings } from '../conversations/settings';
import { ensureComputeConsent } from '../compute/run-cell-with-trust';
import { getDialogStore } from './dialogs.svelte';
import type {
  Conversation,
  ContextBundle,
  ConversationsUIState,
} from '../../../shared/types';
import type { ConversationDraft } from '../../../shared/conversation-drafts';
import type { ConversationRefactorDraft, ConversationReorgDraft, ConversationDeleteDraft } from '../../../shared/conversation-refactor-drafts';
import type { ConversationNoteBodyDraft } from '../../../shared/conversation-note-body-drafts';
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
  RunComputeDraftInput,
  InsertComputeDraftInput,
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
import {
  isProviderUnconfiguredError,
  classifyLlmFailure,
  describeLlmFailure,
  isCancellation,
  type LlmFailureKind,
} from '../../../shared/llm-errors';

/**
 * Plain deep clone for the IPC boundary. Every draft payload sent renderer→main
 * must be detached from Svelte's reactive `$state` proxies first — Electron's
 * structured clone rejects them. A JSON round-trip is the one safe snapshot for
 * all of them: unlike `$state.snapshot`, it strips any lingering Proxy wrapping
 * unconditionally and survives dynamic-key payloads (the `PropertyUpdate` inner
 * `Record<string, unknown>` once arrived empty on the main side after
 * `$state.snapshot` → structured-clone — the "set_properties approved but no
 * frontmatter landed" bug). Drafts are disk-persisted as JSON, so the round-trip
 * is lossless. (#1629)
 */
function plainSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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
type AnchoredRefactorDraft = ConversationRefactorDraft & { afterMessageIndex: number };
type AnchoredReorgDraft = ConversationReorgDraft & { afterMessageIndex: number };
type AnchoredDeleteDraft = ConversationDeleteDraft & { afterMessageIndex: number };
type AnchoredNoteBodyDraft = ConversationNoteBodyDraft & { afterMessageIndex: number };
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

/**
 * A failed turn, rendered in the transcript where the reply would have been
 * (#1804). Before this, everything except "no API key" was `console.error`d:
 * the spinner stopped, the streamed text was thrown away, and the user's turn
 * sat there un-replied with no explanation anywhere in the UI.
 */
export interface TabFailure {
  kind: LlmFailureKind;
  /** Already human-readable and provider-specific; classified in main. */
  message: string;
  /** Whether re-running the identical request is worth offering. */
  retryable: boolean;
  /** Text streamed before the failure. Kept, not discarded — a turn that died
   *  three paragraphs in still wrote three useful paragraphs. */
  partial: string;
  /** Anchors the error block to the turn it belongs to. */
  afterMessageIndex: number;
}

export interface TabRuntime {
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
  /** propose_note_rename/move drafts awaiting Approve/Discard (#913). */
  refactorDrafts: AnchoredRefactorDraft[];
  /** propose_reorganization batch plans awaiting Approve/Discard (#914). */
  reorgDrafts: AnchoredReorgDraft[];
  /** propose_note_delete batch deletions awaiting Approve/Discard. */
  deleteDrafts: AnchoredDeleteDraft[];
  /** propose_note_body in-place rewrites awaiting Approve/Discard (#938). */
  noteBodyDrafts: AnchoredNoteBodyDraft[];
  /** Per-draft Run / Insert state. Stays alive after Run so the user
   *  can see the cell + output in the transcript; only Discard removes
   *  the draft entirely (which also drops the state entry). */
  computeDraftState: Record<string, ComputeDraftStateEntry>;
  /** In-flight ask_user prompt, if the agent is waiting on a reply. */
  pendingQuestion: AskUserRequest | null;
  composer: string;
  streaming: boolean;
  streamedChunks: string;
  /** The last turn's failure, or null. Cleared when a new turn starts. */
  failure: TabFailure | null;
  /** Template-scoped tools enabled for this conversation (e.g. `ask_user`).
   *  Resolved at tab-creation time and re-sent with each turn. In-memory
   *  only — if the user reloads the project, the tab still works but the
   *  agent loses access to template tools (an acceptable degradation since
   *  the agent can fall back to free-form prose questions). */
  extraTools: ConversationToolKey[];
}

const DEFAULT_HEIGHT = 320;
/** Panel-height clamp bounds. MIN mirrors the hard min the renderer enforces
 *  via CSS; MAX keeps the panel from growing past the editor area. */
const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT = 1200;
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
// One flag guards the whole uniform draft-subscription block below — the 10
// per-kind subscriptions are all wired together in a single pass (#980).
let draftsSubscribed = false;
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

/**
 * Build a uniform draft handler (#980): find the tab by conversationId, anchor
 * the draft at `afterMessageIndex` — the slot the streaming assistant message
 * will land in post-reload (`messages.length` already counts the optimistic
 * user turn `send()` pushed before awaiting the IPC) — and hand the anchored
 * draft to `append`, which does the per-kind array push (and, for compute
 * drafts, seeds the state entry).
 */
function draftHandler<T extends { conversationId: string; draftId: string }>(
  append: (tab: TabRuntime, anchored: T & { afterMessageIndex: number }) => void,
): (draft: T) => void {
  return (draft) => {
    const t = findTab(draft.conversationId);
    if (!t) return;
    const afterMessageIndex = t.conversation.messages.length;
    append(t, { ...draft, afterMessageIndex });
  };
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
  if (!draftsSubscribed) {
    api.conversations.onDraft(draftHandler((t, d) => { t.drafts = [...t.drafts, d]; }));
    api.conversations.onSourceDraft(draftHandler((t, d) => { t.sourceDrafts = [...t.sourceDrafts, d]; }));
    api.conversations.onPropertyDraft(draftHandler((t, d) => { t.propertyDrafts = [...t.propertyDrafts, d]; }));
    api.conversations.onSourcePropertyDraft(draftHandler((t, d) => { t.sourcePropertyDrafts = [...t.sourcePropertyDrafts, d]; }));
    api.conversations.onClaimsDraft(draftHandler((t, d) => { t.claimsDrafts = [...t.claimsDrafts, d]; }));
    api.conversations.onComputeDraft(draftHandler((t, d) => {
      t.computeDrafts = [...t.computeDrafts, d];
      // Seed the state entry so the panel can render a pristine card
      // immediately (no Run yet, no Insert yet).
      t.computeDraftState = {
        ...t.computeDraftState,
        [d.draftId]: {
          result: null,
          running: false,
          insertedAt: null,
          afterMessageIndex: d.afterMessageIndex,
        },
      };
    }));
    api.conversations.onRefactorDraft(draftHandler((t, d) => { t.refactorDrafts = [...t.refactorDrafts, d]; }));
    api.conversations.onReorgDraft(draftHandler((t, d) => { t.reorgDrafts = [...t.reorgDrafts, d]; }));
    api.conversations.onDeleteDraft(draftHandler((t, d) => { t.deleteDrafts = [...t.deleteDrafts, d]; }));
    api.conversations.onNoteBodyDraft(draftHandler((t, d) => { t.noteBodyDrafts = [...t.noteBodyDrafts, d]; }));
    draftsSubscribed = true;
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
    // Launch hidden by default — the panel shouldn't shove the editor up
    // unexpectedly on every launch; the user toggles when they want it
    // (Cmd/Ctrl+Shift+K). The persisted `visible` is deliberately ignored.
    // The "Open Conversations on project load" behavior setting opts into
    // showing it on load instead. Persisted height + last-active tab still
    // apply either way.
    visible = getConversationsSettings().openOnLoad;
    height = ui.height || DEFAULT_HEIGHT;
    // Restore tab list from the canonical store: any active conversation is
    // an open tab. No parallel "open tabs" persisted list — the status field
    // in `<id>.json` is the source of truth.
    const active = await api.conversations.listActive();
    tabs = active.map((conv) => blankTabRuntime(conv, []));
    // Restore last-active tab id only if it still corresponds to an open
    // tab; if the user closed it from a prior session, fall through.
    if (ui.activeTabId && tabs.some((t) => t.id === ui.activeTabId)) {
      activeTabId = ui.activeTabId;
    } else if (tabs.length > 0) {
      activeTabId = tabs[0]!.id;
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
  // or larger than the editor area (belt-and-suspenders alongside the CSS min).
  const next = Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, Math.round(px)));
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
  const tab = blankTabRuntime(conv, []);
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
  notePath?: string | undefined;
  systemPrompt?: string;
  model?: string;
  initialMessage?: string;
  /** Per-conversation web override (#1533) — from a launching skill's `web:`
   *  declaration. Persisted on the conversation; the send handler applies it. */
  webEnabled?: boolean;
  /** Template-scoped tools (e.g. `'ask_user'`) the agent should have in
   *  scope for this conversation. Mirrors ConversationTemplate's
   *  `requiresTools` and ThinkingTool's `requiresTools` (#514). */
  extraTools?: ConversationToolKey[];
}): Promise<TabRuntime> {
  ensureSubscriptions();
  const bundle: ContextBundle = opts.notePath ? { notePath: opts.notePath } : {};
  const createOpts: { systemPrompt?: string; model?: string; webEnabled?: boolean } = {};
  if (opts.systemPrompt) createOpts.systemPrompt = opts.systemPrompt;
  if (opts.model) createOpts.model = opts.model;
  if (opts.webEnabled !== undefined) createOpts.webEnabled = opts.webEnabled;
  const conv = await api.conversations.create(
    bundle,
    undefined,
    Object.keys(createOpts).length > 0 ? createOpts : undefined,
  );
  const tab = blankTabRuntime(conv, opts.extraTools ? [...opts.extraTools] : []);
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
  tab.failure = null;
  const tools = tab.extraTools.length > 0 ? [...tab.extraTools] : undefined;
  try {
    await api.conversations.send(tab.id, text, undefined, currentNotePath, tools);
    const reloaded = await api.conversations.load(tab.id);
    if (reloaded) tab.conversation = reloaded;
  } catch (e) {
    handleTurnFailure(tab, e, text);
  } finally {
    tab.streaming = false;
    tab.streamedChunks = '';
  }
}

/**
 * Re-run the turn that just failed (#1804).
 *
 * Goes through CONVERSATION_RETRY, not send(): main appends the user's message
 * *before* calling the model, so a failed turn already persisted it. Re-sending
 * the text would file the same user turn twice.
 */
async function retryLastTurn(tabId: string, currentNotePath?: string): Promise<void> {
  const tab = findTab(tabId);
  if (!tab || tab.streaming) return;
  tab.streaming = true;
  tab.streamedChunks = '';
  tab.failure = null;
  const tools = tab.extraTools.length > 0 ? [...tab.extraTools] : undefined;
  try {
    await api.conversations.retry(tab.id, undefined, currentNotePath, tools);
    const reloaded = await api.conversations.load(tab.id);
    if (reloaded) tab.conversation = reloaded;
  } catch (e) {
    handleTurnFailure(tab, e, null);
  } finally {
    tab.streaming = false;
    tab.streamedChunks = '';
  }
}

/**
 * One place that decides what a failed turn looks like, shared by send() and
 * retry(). Three outcomes:
 *
 * - **Cancelled** — the user's own doing; stay quiet, leave the transcript be.
 * - **Unconfigured provider** — keep the existing App-level modal, which is a
 *   better affordance than an inline message because the fix is elsewhere
 *   (Settings). Roll back the optimistic turn so the transcript isn't littered
 *   with un-replied messages once a key is wired up.
 * - **Everything else** — an inline failure block, keeping the partial reply.
 *
 * `sentText` is the user's message when we can put it back in the composer
 * (send), and null when it's already committed to the transcript (retry).
 */
function handleTurnFailure(tab: TabRuntime, e: unknown, sentText: string | null): void {
  if (isCancellation(e)) {
    // Quiet, but not destructive: a stopped turn keeps whatever it had already
    // written, in the slot the reply would have occupied. Main only appends the
    // assistant message on success, so this block is the *only* copy — hence
    // saying so rather than letting the user assume it was filed.
    if (tab.streamedChunks) {
      tab.failure = {
        kind: 'cancelled',
        message: 'Stopped. This partial reply wasn\'t saved to the conversation.',
        retryable: false,
        partial: tab.streamedChunks,
        afterMessageIndex: tab.conversation.messages.length,
      };
    }
    return;
  }

  if (isProviderUnconfiguredError(e)) {
    if (sentText !== null) {
      tab.conversation.messages = tab.conversation.messages.slice(0, -1);
      tab.composer = sentText;
    }
    needsApiKey = true;
    return;
  }

  const classified = classifyLlmFailure(e);
  tab.failure = {
    kind: classified?.kind ?? 'unknown',
    message: describeLlmFailure(e),
    retryable: classified?.retryable ?? true,
    // Whatever streamed before the failure is real output — keep it. `finally`
    // clears streamedChunks, so capture it here.
    partial: tab.streamedChunks,
    afterMessageIndex: tab.conversation.messages.length,
  };
  // Still log for anyone with devtools open; the UI no longer depends on it.
  console.error('[conv] turn failed:', e);
}

/**
 * `/compact` (#824): summarize earlier turns into a fresh conversation, then
 * swap it into the same tab slot. The original is archived main-side (filed as
 * a thought:Source). Shows a brief busy state while the summarization call
 * runs; a too-short conversation is left untouched.
 */
async function compactConversation(): Promise<void> {
  const tab = activeTab();
  if (!tab || tab.streaming) return;
  tab.streaming = true;
  tab.streamedChunks = 'Compacting earlier turns…';
  try {
    const result = await api.conversations.compact(tab.id);
    if (!result.compacted || !result.conversation) {
      // Nothing to compact (or skipped) — leave the conversation as-is.
      if (result.reason) console.info(`[conv] /compact: ${result.reason}`);
      return;
    }
    const newTab = blankTabRuntime(result.conversation, [...tab.extraTools]);
    const idx = tabs.findIndex((t) => t.id === tab.id);
    if (idx === -1) {
      tabs = [...tabs, newTab];
    } else {
      tabs = [...tabs.slice(0, idx), newTab, ...tabs.slice(idx + 1)];
    }
    activeTabId = newTab.id;
    scheduleSave();
  } catch (e) {
    // /compact is a model call like any other — it can hit a 429, an exhausted
    // balance, or a dead network, and used to fail by silently dropping the
    // "Compacting earlier turns…" indicator (#1804).
    handleTurnFailure(tab, e, null);
  } finally {
    // If the tab was swapped out, this just touches the now-detached old tab
    // object; the new tab starts with streaming=false.
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

async function setEffort(
  tabId: string,
  effort: import('../../../shared/tools/effort').Effort | undefined,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const updated = await api.conversations.setEffort(tabId, effort);
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
    case 'clear':
      void clearConversation();
      break;
    case 'compact':
      void compactConversation();
      break;
    default:
      // Reserved but not yet wired. No-op loudly rather than throwing into
      // the composer's keydown path.
      console.warn(`[conv] no handler for built-in command: /${name}`);
  }
}

/** Empty per-turn state for a freshly-created conversation tab. Keeps the
 *  three tab-construction sites from drifting as draft kinds are added. */
function blankTabRuntime(conv: Conversation, extraTools: ConversationToolKey[]): TabRuntime {
  return {
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
    refactorDrafts: [],
    reorgDrafts: [],
    deleteDrafts: [],
    noteBodyDrafts: [],
    computeDraftState: {},
    pendingQuestion: null,
    composer: '',
    streaming: false,
    streamedChunks: '',
    failure: null,
    extraTools,
  };
}

/**
 * `/clear` (#823): archive the active conversation and open a fresh one in its
 * place, carrying the same context (origin note, trigger node, system prompt,
 * model, template tools). Archive is non-destructive — it files the transcript
 * as a `thought:Source` and leaves any pending approval proposals (which are
 * graph-global, not conversation-scoped) untouched. Truncating in place would
 * orphan those proposals, hence archive-and-new.
 */
async function clearConversation(): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  const prev = tab.conversation;
  // A brand-new, never-used conversation has nothing to archive — just no-op
  // so spamming /clear doesn't litter the archived list with empties.
  if (prev.messages.length === 0) return;
  try {
    await api.conversations.archive(prev.id);
  } catch (e) {
    // Already-archived or transient failure — proceed to open a fresh tab
    // regardless so the user still gets their clean slate.
    console.warn('[conv] /clear: archive failed', e);
  }
  const createOpts: { systemPrompt?: string; model?: string; webEnabled?: boolean } = {};
  if (prev.systemPrompt) createOpts.systemPrompt = prev.systemPrompt;
  if (prev.model) createOpts.model = prev.model;
  if (prev.webEnabled !== undefined) createOpts.webEnabled = prev.webEnabled;
  const fresh = await api.conversations.create(
    prev.contextBundle,
    prev.triggerNodeUri,
    Object.keys(createOpts).length > 0 ? createOpts : undefined,
  );
  const newTab = blankTabRuntime(fresh, [...tab.extraTools]);
  // Replace in place so the fresh conversation keeps the same tab slot.
  const idx = tabs.findIndex((t) => t.id === tab.id);
  if (idx === -1) {
    tabs = [...tabs, newTab];
  } else {
    tabs = [...tabs.slice(0, idx), newTab, ...tabs.slice(idx + 1)];
  }
  activeTabId = newTab.id;
  scheduleSave();
}

/**
 * Stop the in-flight turn. Deliberately does NOT touch the tab's streaming
 * state: aborting makes the in-flight `send()` / `retryLastTurn()` reject, and
 * that rejection is what turns the streamed text into a stopped-turn block
 * (`handleTurnFailure`) before `finally` clears the buffer. Clearing
 * `streamedChunks` here — which is what this used to do — erased the partial
 * reply a few milliseconds before the code that wanted to keep it ran (#1809).
 */
async function cancel(): Promise<void> {
  await api.conversations.cancel();
}

/**
 * Run one draft-approval write, reporting a failure instead of dropping it
 * (#1804).
 *
 * All ten `approve*Draft` functions used to `await api.conversations.file*(…)`
 * bare. A rejection there became an unhandled promise rejection: the card
 * stayed on screen, no result line appeared, and nothing told the user their
 * Approve hadn't landed — the worst version of this bug, because the transcript
 * looked like the change was still pending when it had actually failed.
 *
 * Not retryable: these are writes, and re-firing one blind is how you get a
 * half-applied bundle. The user re-approves from the card, which is still there.
 */
async function applyDraft<T>(
  tab: TabRuntime,
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    tab.failure = {
      kind: classifyLlmFailure(e)?.kind ?? 'unknown',
      message: `Couldn't apply that change. ${describeLlmFailure(e)}`,
      retryable: false,
      partial: '',
      afterMessageIndex: tab.conversation.messages.length,
    };
    console.error('[conv] apply draft failed:', e);
    return { ok: false };
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
  const snapshot = plainSnapshot(draft);
  const applied = await applyDraft(tab, () => api.conversations.fileDraft(snapshot));
  if (!applied.ok) return { filedPaths: [] };
  const result = applied.value;
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

/** The TabRuntime draft-array fields a discard removes a card from — every one
 *  holds items keyed by `draftId`. (`computeDrafts` is handled separately by
 *  `discardComputeDraft`, which also clears `computeDraftState`.) */
type DraftArrayKey =
  | 'drafts' | 'refactorDrafts' | 'reorgDrafts' | 'deleteDrafts' | 'noteBodyDrafts'
  | 'sourceDrafts' | 'propertyDrafts' | 'sourcePropertyDrafts' | 'claimsDrafts';

/** Remove a draft card by id from one of the tab's draft arrays. The cast
 *  bridges the heterogeneous element types (a union `key` widens the write side);
 *  every draft type carries a `draftId`. */
function discardFrom(tabId: string, key: DraftArrayKey, draftId: string): void {
  const tab = findTab(tabId);
  if (!tab) return;
  const remaining = (tab[key] as Array<{ draftId: string }>).filter((d) => d.draftId !== draftId);
  (tab as Record<DraftArrayKey, Array<{ draftId: string }>>)[key] = remaining;
}

function discardDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'drafts', draftId); }

async function approveRefactorDraft(tabId: string, draft: ConversationRefactorDraft): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  // Snapshot before crossing IPC ($state Proxies fail structured-clone).
  const snapshot = plainSnapshot(draft);
  if (!(await applyDraft(tab, () => api.conversations.fileRefactorDraft(snapshot))).ok) return;
  // Drop the card. The move + link rewrites land via the approval engine, and
  // the NOTEBASE_RENAMED / NOTEBASE_REWRITTEN broadcasts update any open editors.
  tab.refactorDrafts = tab.refactorDrafts.filter((d) => d.draftId !== draft.draftId);
}

function discardRefactorDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'refactorDrafts', draftId); }

async function approveReorgDraft(
  tabId: string,
  draft: ConversationReorgDraft,
  selected: Array<{ fromPath: string; toPath: string }>,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const snapshot = plainSnapshot(draft);
  if (!(await applyDraft(tab, () => api.conversations.fileReorgDraft(snapshot, selected))).ok) return;
  tab.reorgDrafts = tab.reorgDrafts.filter((d) => d.draftId !== draft.draftId);
}

function discardReorgDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'reorgDrafts', draftId); }

async function approveDeleteDraft(
  tabId: string,
  draft: ConversationDeleteDraft,
  selected: string[],
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const snapshot = plainSnapshot(draft);
  if (!(await applyDraft(tab, () => api.conversations.fileDeleteDraft(snapshot, selected))).ok) return;
  // Drop the card. The deletions land via the approval engine, and the
  // NOTEBASE_FILE_DELETED broadcasts close any open editors + refresh the tree.
  tab.deleteDrafts = tab.deleteDrafts.filter((d) => d.draftId !== draft.draftId);
}

function discardDeleteDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'deleteDrafts', draftId); }

async function approveNoteBodyDraft(
  tabId: string,
  draft: ConversationNoteBodyDraft,
  selected: string[],
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const snapshot = plainSnapshot(draft);
  if (!(await applyDraft(tab, () => api.conversations.fileNoteBodyDraft(snapshot, selected))).ok) return;
  // Drop the card. The rewrites land via the approval engine as ONE bundled
  // proposal, and the NOTEBASE_REWRITTEN broadcast reloads any open editors.
  tab.noteBodyDrafts = tab.noteBodyDrafts.filter((d) => d.draftId !== draft.draftId);
}

function discardNoteBodyDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'noteBodyDrafts', draftId); }

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
  const snapshot = plainSnapshot(draft);
  const applied = await applyDraft(tab, () => api.conversations.fileSourceDraft(snapshot));
  if (!applied.ok) return;
  const result = applied.value;
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

function discardSourceDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'sourceDrafts', draftId); }

async function approvePropertyDraft(
  tabId: string,
  draft: ConversationPropertyDraft,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  const anchored = tab.propertyDrafts.find((d) => d.draftId === draft.draftId);
  const afterMessageIndex = anchored?.afterMessageIndex ?? tab.conversation.messages.length;
  // PropertyUpdate's nested `Record<string, unknown>` (arbitrary keys) is the
  // payload that first forced the JSON round-trip now in plainSnapshot — see its
  // doc for the "set_properties approved but no frontmatter landed" history.
  const plain = plainSnapshot(draft);
  const applied = await applyDraft(tab, () => api.conversations.filePropertyDraft(plain));
  if (!applied.ok) return;
  const result = applied.value;
  tab.propertyDrafts = tab.propertyDrafts.filter((d) => d.draftId !== draft.draftId);
  tab.propertyDraftResults = {
    ...tab.propertyDraftResults,
    [draft.draftId]: { outcomes: result.outcomes, afterMessageIndex },
  };
}

function discardPropertyDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'propertyDrafts', draftId); }

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
  const plain = plainSnapshot(draft);
  const applied = await applyDraft(tab, () => api.conversations.fileSourcePropertyDraft(plain));
  if (!applied.ok) return;
  const result = applied.value;
  tab.sourcePropertyDrafts = tab.sourcePropertyDrafts.filter((d) => d.draftId !== draft.draftId);
  tab.sourcePropertyDraftResults = {
    ...tab.sourcePropertyDraftResults,
    [draft.draftId]: { outcome: result.outcome, afterMessageIndex },
  };
}

function discardSourcePropertyDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'sourcePropertyDrafts', draftId); }

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
  const plain = plainSnapshot(draft);
  const applied = await applyDraft(tab, () => api.conversations.fileClaimsDraft(plain));
  if (!applied.ok) return;
  const result = applied.value;
  tab.claimsDrafts = tab.claimsDrafts.filter((d) => d.draftId !== draft.draftId);
  tab.claimsDraftResults = {
    ...tab.claimsDraftResults,
    [draft.draftId]: { outcome: result.outcome, afterMessageIndex },
  };
}

function discardClaimsDraft(tabId: string, draftId: string): void { discardFrom(tabId, 'claimsDrafts', draftId); }

async function runComputeDraft(
  tabId: string,
  draft: ConversationComputeDraft,
  editedCode?: string,
): Promise<void> {
  const tab = findTab(tabId);
  if (!tab) return;
  // Eyes-on-code gate (#1411/#1412): an AI-drafted cell always shows its code
  // for review before its first run — `forceReview` bypasses blanket trust — so
  // AI-authored code is never run unreviewed. Declining leaves the draft un-run.
  const codeToRun = editedCode ?? draft.code;
  if (!(await ensureComputeConsent(draft.language, codeToRun, { showConsent: getDialogStore().showComputeConsent }, { forceReview: true }))) {
    return;
  }
  const state = tab.computeDraftState[draft.draftId];
  if (state) {
    // Mark in-flight so the panel can render a spinner + disable buttons.
    tab.computeDraftState = {
      ...tab.computeDraftState,
      [draft.draftId]: { ...state, running: true },
    };
  }
  const input: RunComputeDraftInput = editedCode === undefined ? { draft } : { draft, editedCode };
  const plain = plainSnapshot(input);
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
        // describeLlmFailure over `e.message`: a compute draft can be run by a
        // model call, so this arm sees classified provider failures too — and
        // the raw message still carries Electron's "Error invoking remote
        // method" prefix, which is noise on a card (#1804).
        result: { ok: false, error: describeLlmFailure(e) },
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
  const input: InsertComputeDraftInput = { draft };
  if (editedCode !== undefined) input.editedCode = editedCode;
  if (destinationPath !== undefined) input.destinationPath = destinationPath;
  const plain = plainSnapshot(input);
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
    // Returning null alone left the user with a button that did nothing (#1804).
    tab.failure = {
      kind: classifyLlmFailure(e)?.kind ?? 'unknown',
      message: `Couldn't insert that cell into a note. ${describeLlmFailure(e)}`,
      retryable: false,
      partial: '',
      afterMessageIndex: tab.conversation.messages.length,
    };
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

/** Clear the inline failure block — the user has read it. */
function dismissFailure(tabId: string): void {
  const tab = findTab(tabId);
  if (tab) tab.failure = null;
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
    retryLastTurn,
    dismissFailure,
    answerQuestion,
    cancel,
    setModel,
    setEffort,
    runBuiltinCommand,
    approveDraft,
    discardDraft,
    approveRefactorDraft,
    discardRefactorDraft,
    approveReorgDraft,
    discardReorgDraft,
    approveDeleteDraft,
    discardDeleteDraft,
    approveNoteBodyDraft,
    discardNoteBodyDraft,
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
