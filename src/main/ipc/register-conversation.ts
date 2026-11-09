/**
 * Conversation lifecycle + send/retry IPC handlers.
 *
 * Thin delegation by design (#2237, epic #2241). This file used to open with
 * 214 lines before its first `handle()` call — the assistant's entire system
 * prompt, a stream-callback fan-out, and an API-error recovery strategy — and
 * close with a 67-line `/compact` orchestration after the last one. Those are
 * product behaviour, and they now live where someone looking for them would
 * think to look:
 *
 *   - `llm/conversation-prompt.ts` — the system prompt and its per-turn context
 *   - `llm/container-recovery.ts`  — the `container_id` 400 strip-and-retry
 *   - `llm/compact.ts`             — `/compact`, beside the planning helpers
 *   - `ipc/conversation-stream.ts` — the callback→channel transport (glue, so
 *                                     it stays here; see that file's header)
 *
 * What remains is what a registrar is for: resolve the project from the
 * calling window, wire abort controllers, the `ask_user` round-trip and the
 * `mcp_call` confirmation card (#2439), and
 * delegate.
 */
import { randomUUID } from 'node:crypto';
import { Channels } from '../../shared/channels';
import * as graph from '../graph/index';
import * as conversation from '../llm/conversation';
import { buildConversationSystemPrompt } from '../llm/conversation-prompt';
import { withSkillContext } from '../llm/skill-context';
import { runCompletionWithContainerRecovery } from '../llm/container-recovery';
import { compactConversation } from '../llm/compact';
import { archiveWithBranches, createBranch, defaultBranchDeps, descendantsOf, sharedSummary } from '../llm/conversation-branch';
import { branchInstructions, FORK_TIME_BUDGET_MS, oneAtATime, runFork, type ForkBranchSpec, type ForkDeps, type ForkOutcome } from '../llm/fork';
import { forkAnswersForModel } from '../llm/tools/fork';
import { joinedAnswersMarkdown, parallelMessage } from '../../shared/conversation-parallel';
import { resolveForkConfirmAboveUsd, resolveForkMaxBranches } from '../../shared/tools/fork-settings';
import { buildStreamCallbacks, type PendingAskUser, type PendingMcpConfirm } from './conversation-stream';
import type { BranchCreateOptions, ContextBundle, ConversationCreateOptions, ConversationMessage, ForkAnswer, ParallelBranch } from '../../shared/conversation';
import { rootPathFromEvent, winFromEvent, withRootPath, withRootPathOr } from './helpers';
import { handle } from './typed-ipc';
import { broadcast } from './broadcast';
import { autoTitleConversation, wantsAutoTitle } from '../llm/conversation-title';
import { getSettings } from '../llm/settings';
import { logger } from '../../shared/logger';

export function registerConversation(): void {
  // Conversations
  // Every handler resolves the project from the CALLING WINDOW (#1743). These
  // used to reach module state that the last-opened project owned, so with two
  // thoughtbases open both windows read and wrote the same one's conversations.
  handle(Channels.CONVERSATION_CREATE, withRootPath((rootPath, contextBundle: ContextBundle, triggerNodeUri?: string, options?: ConversationCreateOptions) =>
    conversation.create(rootPath, contextBundle, triggerNodeUri, options)));
  handle(Channels.CONVERSATION_APPEND, withRootPath((rootPath, id: string, role: ConversationMessage['role'], content: string) =>
    conversation.appendMessage(rootPath, id, role, content)));
  // Archiving a conversation archives its branches too (#2970): a branch left
  // open under a closed parent would be a tab with nowhere to report to.
  handle(Channels.CONVERSATION_ARCHIVE, withRootPath((rootPath, id: string) => archiveWithBranches(rootPath, id)));
  handle(Channels.CONVERSATION_LOAD, withRootPath((rootPath, id: string) => conversation.load(rootPath, id)));
  // The list + UI-state reads answer "nothing yet" for a window with no project
  // open — the conversations panel calls them on mount, before any open. That's
  // a legitimate empty value, not a swallowed failure (CLAUDE.md, IPC rule 2).
  handle(Channels.CONVERSATION_LIST, withRootPathOr(Promise.resolve([]), (rootPath) => conversation.listAll(rootPath)));
  handle(Channels.CONVERSATION_LIST_ACTIVE, withRootPathOr(Promise.resolve([]), (rootPath) => conversation.listActive(rootPath)));
  handle(Channels.CONVERSATION_UI_STATE_LOAD, withRootPathOr(Promise.resolve({ ...conversation.DEFAULT_UI_STATE }), (rootPath) => conversation.loadUIState(rootPath)));
  handle(
    Channels.CONVERSATION_UI_STATE_SAVE,
    withRootPath((rootPath, state: import('../../shared/conversation').ConversationsUIState) =>
      conversation.saveUIState(rootPath, state)),
  );

  // Conversation send + LLM streaming. One running turn per CONVERSATION, not
  // per window (#2969): two tabs in one window can each be mid-turn, and Stop
  // names the one it stops. Each entry remembers its window, so closing the
  // window stops every turn it started and nothing else.
  const runningTurns = new Map<string, { controller: AbortController; winId: number; rootPath: string | null }>();
  // Pending ask_user prompts keyed by question id. The CONVERSATION_SEND
  // handler creates an entry when the agent calls ask_user, and the
  // CONVERSATION_ASK_USER_REPLY handler resolves (or rejects) it. Aborting
  // a turn rejects every pending question for that conversation so the agent
  // loop unwinds cleanly instead of hanging on an answered-never promise.
  const pendingAskUser: PendingAskUser = new Map();

  handle(Channels.CONVERSATION_ASK_USER_REPLY, (_e, questionId: string, answer: string) => {
    const pending = pendingAskUser.get(questionId);
    if (!pending) return;
    pendingAskUser.delete(questionId);
    pending.resolve(answer);
  });

  // Pending mcp_call confirmation cards (#2439). Each entry settles itself on
  // abort and on window close (see `conversation-stream.ts`); this handler is
  // the Allow / Deny path. Only the window that was shown the card may answer
  // it, and only a literal `true` is an Allow: anything else the renderer
  // sends is a Deny, so a malformed reply can never authorize a call.
  const pendingMcpConfirm: PendingMcpConfirm = new Map();

  handle(Channels.CONVERSATION_MCP_CONFIRM_REPLY, (e, requestId: string, allow: boolean, remember: boolean) => {
    const pending = pendingMcpConfirm.get(requestId);
    if (!pending || pending.winId !== winFromEvent(e).id) return;
    pending.settle(allow === true ? { allow: true, remember: remember === true } : { allow: false, reason: 'denied' });
  });

  /**
   * One assistant turn. `userMessage === null` means RETRY (#1804): the user's
   * turn is already persisted — main appends it *before* calling the model, so
   * a failed turn leaves it on disk — and re-sending the text would file it a
   * second time. Retry therefore re-runs the completion over the existing
   * history and appends only the assistant reply.
   */
  const runConversationTurn = (e: Electron.IpcMainInvokeEvent, convId: string, userMessage: string | null, systemPrompt?: string, currentNotePath?: string, extraTools?: import('../../shared/conversation-tools').ConversationToolKey[]) =>
    runTurn(winFromEvent(e), rootPathFromEvent(e), convId, userMessage, systemPrompt, currentNotePath, extraTools);

  /**
   * The turn itself, for a window. `branchRun` marks a branch's turn started by
   * a fork (#2971): it stops with the fork (`signal`) and reports its reply as
   * it streams (`onChunk`). Its draft cards, questions and MCP confirms go to
   * the parent's transcript, labelled with the branch, the questions and
   * confirms one at a time across the fork (`oneAtATime`, #2973). It can't
   * fork, and it offers no drafted extension.
   */
  const runTurn = async (
    win: Electron.BrowserWindow,
    rootPath: string | null,
    convId: string,
    userMessage: string | null,
    systemPrompt?: string,
    currentNotePath?: string,
    extraTools?: import('../../shared/conversation-tools').ConversationToolKey[],
    branchRun?: { signal: AbortSignal; onChunk: (text: string) => void; oneAtATime: <T>(fn: () => Promise<T>) => Promise<T> },
  ): Promise<import('../../shared/conversation').Conversation> => {
    // The renderer won't send to a tab mid-turn; a second turn for the same
    // conversation would interleave two replies into one transcript.
    if (runningTurns.has(convId)) throw new Error('This conversation is already answering — wait for it, or stop it first.');
    const controller = new AbortController();
    runningTurns.set(convId, { controller, winId: win.id, rootPath });
    if (branchRun) {
      if (branchRun.signal.aborted) controller.abort();
      else branchRun.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    // When this turn is aborted, fail its in-flight ask_user prompts so
    // the agent's tool-call loop unwinds.
    controller.signal.addEventListener('abort', () => {
      for (const [qid, pending] of pendingAskUser) {
        if (pending.conversationId === convId) {
          pendingAskUser.delete(qid);
          pending.reject(new Error('aborted'));
        }
      }
    });
    // Closing the window stops the turn, as Stop would.
    const onWindowClosed = (): void => controller.abort();
    win.once('closed', onWindowClosed);

    // Unconditional log so we can prove the current build is loaded —
    // if the user reports "no log messages" again, this is missing too.
    logger('conversation').info(`${userMessage === null ? 'RETRY' : 'SEND'} start: conv=${convId} userMsgLen=${userMessage?.length ?? 0}`);

    // A branch records how its turn ended (#2970), for the list beside it.
    let branchTurn = false;
    try {
      return await graph.withLLMContext(async () => {
        if (!rootPath) {
          throw new Error('No thoughtbase is open — cannot send conversation message.');
        }
        const conv = userMessage === null
          ? await conversation.load(rootPath, convId)
          : await conversation.appendMessage(rootPath, convId, 'user', userMessage);
        if (!conv) throw new Error(`Conversation not found: ${convId}`);
        branchTurn = conv.branch !== undefined;

        const { completeWithTools } = await llmClient();
        // A skill's note/source material rides at the head of the first user
        // turn, never in the system prompt (#2438).
        const messages = withSkillContext(
          conv.messages
            .filter(m => m.role !== 'system')
            // An "Ask in parallel" join reaches the model delimited (#2974).
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.forkAnswers ? forkAnswersForModel(m.forkAnswers) : m.content })),
          conv.skillContext,
        );

        const effectiveSystem = await buildConversationSystemPrompt(
          systemPrompt ?? conv.systemPrompt,
          conv.contextBundle,
          currentNotePath,
          rootPath,
        );

        // Every draft kind shares one streaming callback set; the divergent
        // per-kind work is in the CONVERSATION_FILE_*_DRAFT handlers, not here (#980).
        const stream = buildStreamCallbacks(
          win, convId, controller.signal, pendingAskUser, pendingMcpConfirm,
          branchRun && conv.branch
            ? { label: { parentId: conv.branch.parentId, title: conv.title ?? 'Branch' }, oneAtATime: branchRun.oneAtATime }
            : undefined,
        );
        // What this turn's forks cost (#2971), rolled into its reply's cost.
        let forkCostUSD = 0;
        const callbacks: import('../llm/index').StreamCallbacks = branchRun
          ? branchCallbacks(stream.callbacks, branchRun.onChunk)
          : {
            ...stream.callbacks,
            runBranches: async (specs) => {
              const outcome = await forkBranches(win, rootPath, conv, controller.signal, currentNotePath, stream.callbacks.askUser, specs);
              if (outcome.ok) forkCostUSD += outcome.costUSD;
              return outcome;
            },
          };

        // Per-conversation web override (#1533): when the conversation pins web
        // on/off, send it as a `web` override — completeWithTools merges it over
        // the global setting, so the user's allow/block domain lists still apply.
        const webOverride =
          conv.webEnabled !== undefined ? { web: { enabled: conv.webEnabled } } : {};

        // The `finally` is the contract for #2219's chunk coalescing: main
        // buffers stream text for up to STREAM_COALESCE_MS, so the last ≤100ms
        // of the reply is still in that buffer when the completion settles.
        // Flushing here — not after appendMessage, and not only on success —
        // covers all three exits:
        //   - normal completion: the tail reaches the renderer before this
        //     handler's promise resolves, so it lands while the store still has
        //     `streaming === true`. Once `send()` resolves, the store clears
        //     `streamedChunks` and drops any later chunk on the floor.
        //   - throw: the failure card renders `failure.partial` from exactly
        //     this buffered text; without the flush a turn that died three
        //     paragraphs in would show two.
        //   - user pressed Stop: same path, same reason.
        let result;
        try {
          result = await runCompletionWithContainerRecovery(
            completeWithTools,
            rootPath,
            convId,
            {
              system: effectiveSystem,
              // The MCP reach main stored for this conversation (#2649), never
              // the renderer's say.
              toolContext: { rootPath, conversationId: convId, ...(conv.mcpScope ? { mcpScope: conv.mcpScope } : {}) },
              model: conv.model,
              effort: conv.effort,
              extraTools,
              ...webOverride,
            },
            messages,
            conv.containerId,
            callbacks,
          );
        } finally {
          stream.flush();
        }

        const updated = await conversation.appendMessage(
          rootPath,
          convId,
          'assistant',
          result.text,
          { citations: result.citations, usage: result.usage, usageModel: result.usageModel, ...(forkCostUSD > 0 ? { addCostUSD: forkCostUSD } : {}) },
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
        // Name the conversation after its first exchange, in the background:
        // the reply is already back, and a title must never delay or fail it.
        if (wantsAutoTitle(updated)) {
          void (async () => {
            await autoTitleConversation(updated, {
              complete: (prompt, options) => llmClient().then((m) => m.complete(prompt, options)),
              settings: await getSettings(),
              setTitle: (title) => conversation.setTitle(rootPath, convId, title, 'auto'),
              notify: (title) => {
                if (!win.isDestroyed()) broadcast(win, Channels.CONVERSATION_TITLE_CHANGED, { conversationId: convId, title });
              },
            });
          })().catch((err: unknown) => logger('conversation').warn('auto-title setup failed:', err));
        }
        return branchTurn ? (await conversation.setBranchOutcome(rootPath, convId, 'done')) ?? updated : updated;
      });
    } catch (err) {
      if (branchTurn && rootPath) {
        await conversation.setBranchOutcome(rootPath, convId, controller.signal.aborted ? 'stopped' : 'failed')
          .catch((e: unknown) => logger('conversation').warn('recording a branch outcome failed:', e));
      }
      throw err;
    } finally {
      if (runningTurns.get(convId)?.controller === controller) runningTurns.delete(convId);
      win.removeListener('closed', onWindowClosed);
    }
  };

  /**
   * A fork from a conversation's turn (#2971): each branch forked from `parent`
   * and run as a turn of its own in the same window, all at once. One summary
   * of the parent serves every branch of the fork. Its progress goes to the
   * window for the card in the parent's transcript (#2972); each branch's text
   * streams under its own id, as any turn's does, so the card and an opened
   * branch tab both show it live.
   */
  const forkBranches = async (
    win: Electron.BrowserWindow,
    rootPath: string,
    parent: import('../../shared/conversation').Conversation,
    signal: AbortSignal,
    currentNotePath: string | undefined,
    askUser: ((input: { question: string; choices?: string[] }) => Promise<string>) | undefined,
    specs: ForkBranchSpec[],
  ): Promise<ForkOutcome> => {
    const settings = await getSettings();
    const summary = sharedSummary(defaultBranchDeps);
    const interactions = oneAtATime();
    return runFork({
      parent, signal,
      maxBranches: resolveForkMaxBranches(settings.forkMaxBranches),
      confirmAboveUsd: resolveForkConfirmAboveUsd(settings.forkConfirmAboveUsd),
      timeBudgetMs: FORK_TIME_BUDGET_MS,
      createBranch: (spec) => createBranch(rootPath, parent.id, {
        title: spec.title, instructions: branchInstructions(spec), ...(spec.model ? { model: spec.model } : {}),
      }, summary),
      runTurn: (branch, branchSignal, onChunk) =>
        runTurn(win, rootPath, branch.id, null, undefined, currentNotePath, undefined, { signal: branchSignal, onChunk, oneAtATime: interactions }),
      ask: askUser ? (question, choices) => askUser({ question, choices }) : undefined,
      onProgress: forkProgressTo(win, parent.id),
    }, specs);
  };

  /**
   * "Ask in parallel" (#2974): the user's message, sent as one branch per
   * model, perspective or attempt, each with the conversation so far, then the
   * answers joined into the conversation side by side. It runs as the
   * conversation's turn, so Stop stops it (and every branch); the user chose
   * the fork, so it doesn't ask about cost, but the branch limit holds.
   */
  const askInParallel = async (
    win: Electron.BrowserWindow,
    rootPath: string | null,
    convId: string,
    message: string,
    branches: ParallelBranch[],
    currentNotePath?: string,
  ): Promise<void> => {
    if (!rootPath) throw new Error('No thoughtbase is open — cannot send conversation message.');
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) throw new Error('Ask in parallel needs a message.');
    if (!Array.isArray(branches) || branches.length === 0) throw new Error('Ask in parallel needs at least one branch.');
    const specs: ForkBranchSpec[] = branches.map((b) => {
      if (!b || typeof b.title !== 'string' || !b.title.trim()) throw new Error('Each parallel branch needs a title.');
      return {
        title: b.title.trim().slice(0, 120),
        instructions: parallelMessage(text, b),
        ...(typeof b.model === 'string' && b.model ? { model: b.model } : {}),
      };
    });
    if (runningTurns.has(convId)) throw new Error('This conversation is already answering — wait for it, or stop it first.');
    const controller = new AbortController();
    runningTurns.set(convId, { controller, winId: win.id, rootPath });
    const onWindowClosed = (): void => controller.abort();
    win.once('closed', onWindowClosed);
    try {
      await graph.withLLMContext(async () => {
        const before = await conversation.load(rootPath, convId);
        if (!before) throw new Error(`Conversation not found: ${convId}`);
        const parent = await conversation.appendMessage(rootPath, convId, 'user', text);
        const settings = await getSettings();
        // Branches propose and ask through this conversation, one card at a time (#2973).
        const interactions = oneAtATime();
        const deps: ForkDeps = {
          parent, signal: controller.signal,
          maxBranches: resolveForkMaxBranches(settings.forkMaxBranches),
          confirmAboveUsd: Number.POSITIVE_INFINITY,
          timeBudgetMs: FORK_TIME_BUDGET_MS,
          // The conversation so far, then the message: each branch answers it as this conversation would.
          createBranch: (spec) => createBranch(rootPath, convId, {
            title: spec.title, instructions: spec.instructions, context: 'full', atMessage: before.messages.length,
            ...(spec.model ? { model: spec.model } : {}),
          }),
          runTurn: (branch, branchSignal, onChunk) =>
            runTurn(win, rootPath, branch.id, null, undefined, currentNotePath, undefined, { signal: branchSignal, onChunk, oneAtATime: interactions }),
          onProgress: forkProgressTo(win, convId),
        };
        const outcome = await runFork(deps, specs);
        if (!outcome.ok) throw new Error(outcome.reason);
        const answers: ForkAnswer[] = outcome.results.map((r) => ({
          title: r.title, conversationId: r.conversationId, status: r.status, answer: r.answer, ...(r.note ? { note: r.note } : {}),
        }));
        await conversation.appendMessage(rootPath, convId, 'assistant', joinedAnswersMarkdown(answers), {
          forkAnswers: answers, ...(outcome.costUSD > 0 ? { addCostUSD: outcome.costUSD } : {}),
        });
      });
    } finally {
      if (runningTurns.get(convId)?.controller === controller) runningTurns.delete(convId);
      win.removeListener('closed', onWindowClosed);
    }
  };

  handle(Channels.CONVERSATION_ASK_PARALLEL, (e, convId: string, message: string, branches: ParallelBranch[], currentNotePath?: string) =>
    askInParallel(winFromEvent(e), rootPathFromEvent(e), convId, message, branches, currentNotePath));

  handle(Channels.CONVERSATION_SEND, (e, convId: string, userMessage: string, systemPrompt?: string, currentNotePath?: string, extraTools?: import('../../shared/conversation-tools').ConversationToolKey[]) =>
    runConversationTurn(e, convId, userMessage, systemPrompt, currentNotePath, extraTools));

  // Re-run the last turn after a failure, without re-filing the user's message.
  handle(Channels.CONVERSATION_RETRY, (e, convId: string, systemPrompt?: string, currentNotePath?: string, extraTools?: import('../../shared/conversation-tools').ConversationToolKey[]) =>
    runConversationTurn(e, convId, null, systemPrompt, currentNotePath, extraTools));

  // Stop one conversation's turn (#2969). Only the window that started it may
  // stop it; a conversation that isn't running is a no-op. Stopping a parent
  // stops its branches, and theirs (#2970); stopping a branch stops only it.
  handle(Channels.CONVERSATION_CANCEL, async (e, conversationId: string) => {
    const turn = runningTurns.get(conversationId);
    if (!turn || turn.winId !== winFromEvent(e).id) return;
    turn.controller.abort();
    runningTurns.delete(conversationId);
    if (!turn.rootPath) return;
    for (const b of descendantsOf(await conversation.listAll(turn.rootPath), conversationId)) {
      const child = runningTurns.get(b.id);
      if (!child || child.rootPath !== turn.rootPath) continue;
      child.controller.abort();
      runningTurns.delete(b.id);
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

  handle(Channels.CONVERSATION_SET_TITLE, withRootPath(async (rootPath, convId: string, title: string | null) =>
    (await conversation.setTitle(rootPath, convId, title, 'user')).conversation));

  handle(Channels.CONVERSATION_COMPACT, withRootPath((rootPath, convId: string) =>
    compactConversation(rootPath, convId)));

  handle(Channels.CONVERSATION_BRANCH, withRootPath((rootPath, parentId: string, options: BranchCreateOptions) =>
    createBranch(rootPath, parentId, options)));
}

/**
 * A branch's callbacks (#2973): everything a conversation's turn has, routed to
 * the parent by `buildStreamCallbacks`, except a fork of its own (depth 1) and
 * a drafted extension, and with its streaming text also handed to the fork.
 */
function branchCallbacks(
  callbacks: import('../llm/index').StreamCallbacks,
  onChunk: (text: string) => void,
): import('../llm/index').StreamCallbacks {
  const routed: import('../llm/index').StreamCallbacks = {
    ...callbacks,
    onChunk: (text: string) => { onChunk(text); callbacks.onChunk(text); },
  };
  delete routed.offerExtensionDraft;
  delete routed.runBranches;
  return routed;
}

/** A fork's progress, to the window that started it, for the card in the parent's transcript (#2972). */
function forkProgressTo(win: Electron.BrowserWindow, parentId: string): NonNullable<ForkDeps['onProgress']> {
  const forkId = randomUUID();
  return (progress) => {
    if (!win.isDestroyed()) broadcast(win, Channels.CONVERSATION_FORK, { conversationId: parentId, forkId, ...progress });
  };
}

/**
 * The LLM client, imported lazily and once: the promise is cached, not the
 * module (#2974). A fork starts several turns together, and each used to run
 * its own `import()` of the client.
 */
let llmClientImport: Promise<typeof import('../llm/index')> | null = null;
function llmClient(): Promise<typeof import('../llm/index')> {
  return (llmClientImport ??= import('../llm/index'));
}
