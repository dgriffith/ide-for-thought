import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import * as graph from '../graph/index';
import * as conversation from '../llm/conversation';
import { currentDateContext } from '../llm/date-context';
import { readThoughtbaseDoc, thoughtbaseDocPromptBlock } from '../llm/thoughtbase-doc';
import type { ContextBundle, ConversationMessage } from '../../shared/types';
import type { ConversationDraftBase } from '../../shared/conversation-draft-base';
import { rootPathFromEvent, winFromEvent, withRootPath, withRootPathOr } from './helpers';
import { broadcast } from './broadcast';
import { handle } from './typed-ipc';
import type { EventMap } from '../../shared/ipc-contract';

const DEFAULT_CONVERSATION_SYSTEM_PROMPT = [
  'You are an assistant embedded in Minerva, a markdown-based thinking tool.',
  'The user is working inside a thoughtbase: a collection of interlinked notes backed by an RDF knowledge graph.',
  '',
  'You have read tools, web tools, and two write tools (propose_notes, propose_sources). Prefer the thoughtbase tools for anything inside the user\'s notes; use the web tools for facts, events, documentation, or sources outside the thoughtbase.',
  '',
  'Thoughtbase read tools:',
  '- search_notes: full-text search across the thoughtbase.',
  '- read_note: read a specific note by its relative path.',
  '- query_graph: run a SPARQL query against the knowledge graph (minerva/thought prefixes are auto-injected).',
  '- describe_graph_schema: fetch the full ontology TTL. Call this before writing a non-trivial SPARQL query if you are unsure about class or predicate names.',
  '- search_help: semantic search over Minerva\'s own user-facing documentation — not the thoughtbase, the app itself. Use this for "how do I…" / "what does X do in Minerva" questions instead of answering from training data, which has never seen this specific app and can be confidently wrong.',
  '',
  'Thoughtbase write tools:',
  '- propose_notes: file one or more notes for the user to review. The user sees an inline draft card with Approve/Discard. **You MUST call this tool — do NOT just describe the notes in chat and ask the user to file them, and do NOT tell them you can\'t create notes.** If you have just outlined a structure (a learning journey, a topic breakdown, a per-section explanation, a multi-claim summary), and the user wants it filed, call propose_notes with the whole bundle in one call (parent + children). The trust principle is preserved: nothing lands until the user clicks Approve. Only call propose_notes when you have concrete note bodies ready — never with an empty payload list, and never just to offer to make notes; if there is nothing to file yet, reply in plain text.',
  '- propose_sources: file one or more sources (papers, articles, web pages) into the user\'s Sources library. The user sees an inline draft card with Approve/Discard; on Approve, Minerva runs its full ingest pipeline (Crossref / arXiv / PubMed for identifiers; Readability for URLs) to fetch metadata and archive the source. **Prefer identifiers (DOI / arXiv id / PubMed id) over URLs** — the structured metadata is richer. Duplicates are skipped automatically. Use this when you have referenced a specific external work, when the user asks to add a citation, or when web_search surfaced sources that materially advance the conversation.',
  '',
  'Web tools:',
  '- web_search: search the web for current information, news, documentation, or external references.',
  '- web_fetch: fetch the contents of a specific URL — use this after web_search to read a promising result in full, or when the user gives you a URL directly.',
  '',
  'About the code sandbox: the web tools execute server-side, and running one may expose a general code-execution sandbox to you (you may see it as bash or Python). That sandbox runs on the model provider\'s infrastructure, NOT on the user\'s machine. It cannot see the thoughtbase, and any filesystem it appears to offer has nothing to do with the user\'s notes. Never use it to inspect, grep, count, or verify the user\'s files: read_note, grep_notes, search_notes and query_graph are the only ways to see what is actually in the thoughtbase. If sandbox output looks like it is describing the user\'s notes, it is meaningless — discard it instead of reasoning from it.',
  '',
  'Minerva-specific markdown features (use these in note bodies whenever they materially help — and in inline reply examples if the user is asking how to use the feature):',
  '- ```python (also ```py, ```python3) — runnable Python cell. The user clicks the ▶ gutter icon (or Cmd/Ctrl+Shift+Enter) to execute; results land in a sibling ```output``` block that the editor manages. A persistent per-note kernel preserves variables across cells in the same note. The project root is on `sys.path`, so any `.py` file in the notebase is importable — `helpers.py` at the root → `import helpers`; `python/utils.py` → `from python import utils`. Reach for `propose_notes` with a `.py` payload when reusable logic emerges (helper functions, shared loaders, plotting wrappers). Heads-up: the kernel caches imported modules, so after editing a `.py` helper the user needs to restart the kernel for changes to land in already-imported cells (Compute menu → Restart Python Kernel).',
  '- ```sparql — runnable SPARQL query against the user\'s knowledge graph. Standard prefixes (minerva, thought, dc, rdf, rdfs, xsd, csvw, prov) are auto-injected, so write only the SELECT/ASK/CONSTRUCT body. Same run mechanism.',
  '- ```sql — runnable SQL query (DuckDB) against tables. Markdown tables in the user\'s notes become queryable via CSVW; column headers become the schema. Same run mechanism.',
  '- ```mermaid — rendered inline as an SVG diagram in preview (flowcharts, sequence diagrams, ER diagrams, state diagrams, etc.). Use for structural overviews where a picture beats prose.',
  '- ```turtle — Turtle-RDF that is parsed into the note\'s named graph at save time. Use sparingly, and only for genuinely structured facts the user will want to query later (e.g. a `thought:Claim` with `thought:supports`/`thought:rebuts` links). Do NOT use it as a dumping ground for arbitrary metadata.',
  'Do NOT pre-fill a ```output``` block — leave outputs for the user to generate by running the cell. Reach for these features when they earn their keep; a plain prose answer is often better.',
  '',
  'Usage guidance:',
  '- For questions about the user\'s notes or ideas they\'ve captured, use search_notes and read_note.',
  '- For structural questions (what links to what, which notes share a tag, which claims cite a source), use query_graph; fall back to describe_graph_schema if a query fails or you are guessing at predicates.',
  '- For current events, external facts, recent research, or things outside the thoughtbase, use web_search.',
  '- For "how do I…" / "what does X do" / "where do I find…" questions about Minerva itself, call search_help before answering — do not rely on prior knowledge of similar apps, since you have never actually seen this one. If search_help returns a WEAK MATCH (or nothing usable), say plainly that the docs don\'t seem to cover it and offer the closest section you found, rather than falling back to a confident guess from general knowledge.',
  '- This applies mid-task, not just when the user asks directly: before asserting or relying on a specific Minerva capability you are not fully certain of (an exact markdown syntax, a tool\'s precise behavior, a settings option, a menu location) while drafting a note, proposing an action, or explaining a workflow, call search_help to verify first rather than presenting an unconfirmed guess as fact.',
  '- It\'s often useful to combine tools: search_notes to see what the user already has, then web_search to fill in what they don\'t. Cite your web sources.',
  '- Never tell the user their notes are damaged, corrupted, duplicated, or lost unless a thoughtbase tool has shown you the actual content that demonstrates it, and say which tool showed you. A surprising or repetitive tool result is far likelier to be your own misreading than data loss, and telling someone to go hand-repair files that are fine can destroy work that nothing here can undo. When something looks wrong, describe exactly what you saw and let the user check.',
  '- When the user agrees to file something ("yes, file it", "file these as notes", "save this", "create the notes"), CALL propose_notes immediately — do not describe what you would file, do not ask for further confirmation. The Approve/Discard card IS the user\'s confirmation step.',
  '- When the user agrees to add sources ("add that paper", "save this source", "ingest this", "add the citation"), CALL propose_sources immediately with the relevant identifiers/URLs. The Approve/Discard card IS the user\'s confirmation step.',
  '',
  'When you call propose_notes or propose_sources, do NOT also paste the same content / URL list inline in your reply. The inline draft card is the deliverable; repeating it is duplicate noise.',
  '',
  'Answer in GitHub-flavored markdown. When you reference a note, cite its relative path so the user can open it.',
].join('\n');

async function buildConversationSystemPrompt(
  userSystem: string | undefined,
  contextBundle: ContextBundle,
  currentNotePath?: string,
  rootPath?: string | null,
): Promise<string> {
  const parts = [DEFAULT_CONVERSATION_SYSTEM_PROMPT];
  // The thoughtbase's own conventions doc (thoughtbase.md), when present, sits
  // right after the base instructions as authoritative project context —
  // foundational, before the per-turn/session context below.
  const thoughtbaseBlock = thoughtbaseDocPromptBlock(rootPath ? await readThoughtbaseDoc(rootPath) : null);
  if (thoughtbaseBlock) {
    parts.push('', thoughtbaseBlock);
  }
  // Dynamic per-turn context follows the static prompt. Within one session
  // (same day, same open note) it's stable, so the cached system block still
  // hits across turns; it only re-caches when the date or open note changes.
  parts.push('', currentDateContext());
  if (contextBundle.notePath) {
    parts.push('', `The user started this conversation from the note: ${contextBundle.notePath}`);
  }
  if (currentNotePath && currentNotePath !== contextBundle.notePath) {
    // Live context — the note the user is currently looking at, which may
    // differ from the conversation's origin. Resolves "this note" / "the
    // current note" in the user's prompts against what they're actually
    // viewing.
    parts.push('', `The note currently open in the editor is: ${currentNotePath}`);
  } else if (currentNotePath && currentNotePath === contextBundle.notePath) {
    parts.push('', 'The user is still viewing the origin note.');
  }
  if (userSystem && userSystem.trim()) {
    parts.push('', userSystem.trim());
  }
  return parts.join('\n');
}

type LlmMessage = { role: 'user' | 'assistant'; content: string };
type PendingAskUser = Map<string, { winId: number; resolve: (answer: string) => void; reject: (err: Error) => void }>;
type CompleteWithTools = typeof import('../llm/index').completeWithTools;
type CompletionParams = Parameters<CompleteWithTools>[0];
type StreamCallbacks = NonNullable<CompletionParams['callbacks']>;

/** The API's "container_id required" 400 marker — matched to trigger the
 *  strip-and-retry recovery in `runCompletionWithContainerRecovery`. */
const CONTAINER_REQUIRED_MARKER = 'container_id is required';

/** Drop assistant turns whose persisted text carries our code-execution markers
 *  (`_🔍 Searching` / `_🌐 Fetching` / `_⚙️ Running code`). Those are the only
 *  history entries that can make the API demand a container; stripping them
 *  (lossy) lets a stuck conversation recover. */
function stripCodeExecutionTurns(msgs: LlmMessage[]): LlmMessage[] {
  return msgs.filter((m) => {
    if (m.role !== 'assistant' || typeof m.content !== 'string') return true;
    return !/_(?:🔍 Searching|🌐 Fetching|⚙️ Running code)/.test(m.content);
  });
}

/** Build the per-send streaming callbacks: chunk + every draft kind forwarded to
 *  the window's renderer, plus the `ask_user` round-trip (tracked in
 *  `pendingAskUser` so aborting the send can reject a pending question). */
function buildStreamCallbacks(
  win: BrowserWindow,
  convId: string,
  signal: AbortSignal,
  pendingAskUser: PendingAskUser,
): StreamCallbacks {
  // All draft channels carry ConversationDraftBase; the channel is typed against
  // EventMap but the send stays raw — TS can't verify a single-arg spread against
  // a generic `Parameters<EventMap[K]>` tuple, and every subscriber is typed via
  // `subscribe`, so the payload is checked on the receiving side (#1633).
  const draftEmit =
    (channel: keyof EventMap) =>
    (draft: ConversationDraftBase) => {
      if (!win.isDestroyed()) win.webContents.send(channel, draft);
    };
  return {
    onChunk: (chunk: string) => {
      if (!win.isDestroyed()) broadcast(win, Channels.CONVERSATION_STREAM, chunk);
    },
    onDraft: draftEmit(Channels.CONVERSATION_DRAFT),
    onSourceDraft: draftEmit(Channels.CONVERSATION_SOURCE_DRAFT),
    onPropertyDraft: draftEmit(Channels.CONVERSATION_PROPERTY_DRAFT),
    onSourcePropertyDraft: draftEmit(Channels.CONVERSATION_SOURCE_PROPERTY_DRAFT),
    onClaimsDraft: draftEmit(Channels.CONVERSATION_CLAIMS_DRAFT),
    onComputeDraft: draftEmit(Channels.CONVERSATION_COMPUTE_DRAFT),
    onRefactorDraft: draftEmit(Channels.CONVERSATION_REFACTOR_DRAFT),
    onReorgDraft: draftEmit(Channels.CONVERSATION_REORG_DRAFT),
    onDeleteDraft: draftEmit(Channels.CONVERSATION_DELETE_DRAFT),
    onNoteBodyDraft: draftEmit(Channels.CONVERSATION_NOTE_BODY_DRAFT),
    askUser: ({ question, choices }: { question: string; choices?: string[] }) => {
      const questionId = randomUUID();
      return new Promise<string>((resolve, reject) => {
        pendingAskUser.set(questionId, { winId: win.id, resolve, reject });
        if (!win.isDestroyed()) {
          broadcast(win, Channels.CONVERSATION_ASK_USER, {
            questionId,
            conversationId: convId,
            question,
            // `choices` is optional (exactOptionalPropertyTypes) — omit when absent.
            ...(choices ? { choices } : {}),
          });
        } else {
          pendingAskUser.delete(questionId);
          reject(new Error('window destroyed'));
        }
      });
    },
    signal,
  };
}

/** Run `completeWithTools`, recovering once from the API's `container_id is
 *  required` 400: drop the cached container id, strip code-execution turns from
 *  history, and retry without an initial container id. Any other error — or a
 *  second failure — propagates. */
async function runCompletionWithContainerRecovery(
  completeWithTools: CompleteWithTools,
  rootPath: string,
  convId: string,
  base: Omit<CompletionParams, 'messages' | 'callbacks' | 'initialContainerId'>,
  messages: LlmMessage[],
  initialContainerId: string | undefined,
  callbacks: StreamCallbacks,
): Promise<Awaited<ReturnType<CompleteWithTools>>> {
  try {
    return await completeWithTools({
      ...base,
      messages,
      // Re-echo any prior turn's code-execution sandbox id — required whenever
      // history still contains a server_tool_use block.
      ...(initialContainerId ? { initialContainerId } : {}),
      callbacks,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(CONTAINER_REQUIRED_MARKER)) throw err;
    // The persisted container id is missing/stale while history still
    // references code_execution. Clear it, strip the offending turns, retry once.
    console.warn(
      `[conv] container_id 400 — recovering. conv=${convId} ` +
      `cachedContainer=${initialContainerId ?? 'none'} stripping code_execution turns`,
    );
    await conversation.setContainerId(rootPath, convId, undefined, undefined);
    return await completeWithTools({
      ...base,
      messages: stripCodeExecutionTurns(messages),
      callbacks,
    });
  }
}

export function registerConversation(): void {
  // Conversations
  // Every handler resolves the project from the CALLING WINDOW (#1743). These
  // used to reach module state that the last-opened project owned, so with two
  // thoughtbases open both windows read and wrote the same one's conversations.
  handle(Channels.CONVERSATION_CREATE, withRootPath((rootPath, contextBundle: ContextBundle, triggerNodeUri?: string, options?: { systemPrompt?: string; model?: string }) =>
    conversation.create(rootPath, contextBundle, triggerNodeUri, options)));
  handle(Channels.CONVERSATION_APPEND, withRootPath((rootPath, id: string, role: ConversationMessage['role'], content: string) =>
    conversation.appendMessage(rootPath, id, role, content)));
  handle(Channels.CONVERSATION_ARCHIVE, withRootPath((rootPath, id: string) => conversation.archive(rootPath, id)));
  handle(Channels.CONVERSATION_LOAD, withRootPath((rootPath, id: string) => conversation.load(rootPath, id)));
  // The list + UI-state reads answer "nothing yet" for a window with no project
  // open — the conversations panel calls them on mount, before any open. That's
  // a legitimate empty value, not a swallowed failure (CLAUDE.md, IPC rule 2).
  handle(Channels.CONVERSATION_LIST, withRootPathOr(Promise.resolve([]), (rootPath) => conversation.listAll(rootPath)));
  handle(Channels.CONVERSATION_LIST_ACTIVE, withRootPathOr(Promise.resolve([]), (rootPath) => conversation.listActive(rootPath)));
  handle(Channels.CONVERSATION_UI_STATE_LOAD, withRootPathOr(Promise.resolve({ ...conversation.DEFAULT_UI_STATE }), (rootPath) => conversation.loadUIState(rootPath)));
  handle(
    Channels.CONVERSATION_UI_STATE_SAVE,
    withRootPath((rootPath, state: import('../../shared/types').ConversationsUIState) =>
      conversation.saveUIState(rootPath, state)),
  );

  // Conversation send + LLM streaming
  const convAbortControllers = new Map<number, AbortController>();
  // Pending ask_user prompts keyed by question id. The CONVERSATION_SEND
  // handler creates an entry when the agent calls ask_user, and the
  // CONVERSATION_ASK_USER_REPLY handler resolves (or rejects) it. Aborting
  // the send rejects every pending question for that window so the agent
  // loop unwinds cleanly instead of hanging on an answered-never promise.
  const pendingAskUser = new Map<string, { winId: number; resolve: (answer: string) => void; reject: (err: Error) => void }>();

  handle(Channels.CONVERSATION_ASK_USER_REPLY, (_e, questionId: string, answer: string) => {
    const pending = pendingAskUser.get(questionId);
    if (!pending) return;
    pendingAskUser.delete(questionId);
    pending.resolve(answer);
  });

  /**
   * One assistant turn. `userMessage === null` means RETRY (#1804): the user's
   * turn is already persisted — main appends it *before* calling the model, so
   * a failed turn leaves it on disk — and re-sending the text would file it a
   * second time. Retry therefore re-runs the completion over the existing
   * history and appends only the assistant reply.
   */
  const runConversationTurn = async (e: Electron.IpcMainInvokeEvent, convId: string, userMessage: string | null, systemPrompt?: string, currentNotePath?: string, extraTools?: import('../../shared/conversation-tools').ConversationToolKey[]) => {
    const win = winFromEvent(e);
    const rootPath = rootPathFromEvent(e);
    const controller = new AbortController();
    convAbortControllers.set(win.id, controller);
    // When this send is aborted, fail any in-flight ask_user prompts so
    // the agent's tool-call loop unwinds.
    controller.signal.addEventListener('abort', () => {
      for (const [qid, pending] of pendingAskUser) {
        if (pending.winId === win.id) {
          pendingAskUser.delete(qid);
          pending.reject(new Error('aborted'));
        }
      }
    });

    // Unconditional log so we can prove the current build is loaded —
    // if the user reports "no log messages" again, this is missing too.
    console.log(`[conv] ${userMessage === null ? 'RETRY' : 'SEND'} start: conv=${convId} userMsgLen=${userMessage?.length ?? 0}`);

    graph.enterLLMContext();
    try {
      if (!rootPath) {
        throw new Error('No thoughtbase is open — cannot send conversation message.');
      }
      const conv = userMessage === null
        ? await conversation.load(rootPath, convId)
        : await conversation.appendMessage(rootPath, convId, 'user', userMessage);
      if (!conv) throw new Error(`Conversation not found: ${convId}`);

      const { completeWithTools } = await import('../llm/index');
      const messages = conv.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const effectiveSystem = await buildConversationSystemPrompt(
        systemPrompt ?? conv.systemPrompt,
        conv.contextBundle,
        currentNotePath,
        rootPath,
      );

      // Every draft kind shares one streaming callback set; the divergent
      // per-kind work is in the CONVERSATION_FILE_*_DRAFT handlers, not here (#980).
      const streamCallbacks = buildStreamCallbacks(win, convId, controller.signal, pendingAskUser);

      // Per-conversation web override (#1533): when the conversation pins web
      // on/off, send it as a `web` override — completeWithTools merges it over
      // the global setting, so the user's allow/block domain lists still apply.
      const webOverride =
        conv.webEnabled !== undefined ? { web: { enabled: conv.webEnabled } } : {};

      const result = await runCompletionWithContainerRecovery(
        completeWithTools,
        rootPath,
        convId,
        {
          system: effectiveSystem,
          toolContext: { rootPath, conversationId: convId },
          model: conv.model,
          effort: conv.effort,
          extraTools,
          ...webOverride,
        },
        messages,
        conv.containerId,
        streamCallbacks,
      );

      const updated = await conversation.appendMessage(
        rootPath,
        convId,
        'assistant',
        result.text,
        { citations: result.citations, usage: result.usage, usageModel: result.usageModel },
      );
      // Persist the (possibly updated) container id so the next turn
      // for this conversation can echo it. We write unconditionally
      // — even if the id is unchanged — because conversation.load /
      // appendMessage above don't preserve fields completeWithTools
      // can update mid-turn.
      if (result.containerId) {
        await conversation.setContainerId(
          rootPath,
          convId,
          result.containerId,
          result.containerExpiresAt,
        );
      }
      return updated;
    } finally {
      convAbortControllers.delete(win.id);
      graph.exitLLMContext();
    }
  };

  handle(Channels.CONVERSATION_SEND, (e, convId: string, userMessage: string, systemPrompt?: string, currentNotePath?: string, extraTools?: import('../../shared/conversation-tools').ConversationToolKey[]) =>
    runConversationTurn(e, convId, userMessage, systemPrompt, currentNotePath, extraTools));

  // Re-run the last turn after a failure, without re-filing the user's message.
  handle(Channels.CONVERSATION_RETRY, (e, convId: string, systemPrompt?: string, currentNotePath?: string, extraTools?: import('../../shared/conversation-tools').ConversationToolKey[]) =>
    runConversationTurn(e, convId, null, systemPrompt, currentNotePath, extraTools));

  handle(Channels.CONVERSATION_CANCEL, (e) => {
    const win = winFromEvent(e);
    const controller = convAbortControllers.get(win.id);
    if (controller) {
      controller.abort();
      convAbortControllers.delete(win.id);
    }
  });

  handle(Channels.CONVERSATION_SET_MODEL, withRootPath(async (rootPath, convId: string, model: string | undefined) => {
    return conversation.setModel(rootPath, convId, model);
  }));

  handle(
    Channels.CONVERSATION_SET_EFFORT,
    withRootPath(async (rootPath, convId: string, effort: import('../../shared/tools/effort').Effort | undefined) => {
      return conversation.setEffort(rootPath, convId, effort);
    }),
  );

  handle(Channels.CONVERSATION_COMPACT, withRootPath((rootPath, convId: string) =>
    compactConversation(rootPath, convId)));
}

/**
 * `/compact` (#824): client-side compaction. Summarizes the early history with
 * a model call and seeds a fresh conversation with the summary + the retained
 * recent turns. The pre-compaction original is archived (filed as a
 * thought:Source, recoverable from the archived list), never silently
 * destroyed. The summarization call's own token usage is recorded on the
 * summary message (#820). Decision/assembly logic is in `llm/compact.ts`.
 */
async function compactConversation(
  rootPath: string,
  convId: string,
): Promise<import('../../shared/types').CompactResult> {
  const conv = await conversation.load(rootPath, convId);
  if (!conv) throw new Error(`Conversation not found: ${convId}`);
  if (conv.status !== 'active') {
    return { compacted: false, reason: 'This conversation is archived and can\'t be compacted.' };
  }
  const { planCompaction, buildSummaryPrompt, buildSummaryMessage, COMPACT_SYSTEM_PROMPT } =
    await import('../llm/compact');
  const plan = planCompaction(conv.messages);
  if (!plan.ok) return { compacted: false, reason: plan.reason };

  let usage: import('../../shared/types').TurnUsage | undefined;
  let usageModel: string | undefined;
  let truncated = false;
  const { complete } = await import('../llm/index');
  const summary = await complete(buildSummaryPrompt(plan.transcript), {
    system: COMPACT_SYSTEM_PROMPT,
    model: conv.model,
    onUsage: (u, m) => { usage = u; usageModel = m; },
    onTruncated: () => { truncated = true; },
  });
  // A summary cut off at the token cap is the one truncation we refuse to live
  // with (#1811): compaction archives the original and makes this summary the
  // model's entire memory of it. Better to leave the conversation as it is and
  // say why than to install a half-written account of it.
  if (truncated) {
    return {
      compacted: false,
      reason: 'The summary of your earlier turns was cut off at the length limit, '
        + 'so nothing was compacted. Try again, or start a fresh conversation.',
    };
  }
  const summaryMsg = buildSummaryMessage(
    plan.prefix.length,
    summary,
    usage,
    usageModel,
    new Date().toISOString(),
  );

  // Archive the original (files the full transcript as a thought:Source —
  // recoverable) before opening the compacted continuation.
  await conversation.archive(rootPath, convId);
  const createOpts: { systemPrompt?: string; model?: string; webEnabled?: boolean } = {};
  if (conv.systemPrompt) createOpts.systemPrompt = conv.systemPrompt;
  if (conv.model) createOpts.model = conv.model;
  if (conv.webEnabled !== undefined) createOpts.webEnabled = conv.webEnabled;
  const fresh = await conversation.create(
    rootPath,
    conv.contextBundle,
    conv.triggerNodeUri,
    Object.keys(createOpts).length > 0 ? createOpts : undefined,
  );
  const updated = await conversation.replaceMessages(rootPath, fresh.id, [summaryMsg, ...plan.recent]);
  return { compacted: true, conversation: updated };
}
