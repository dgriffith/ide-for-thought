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
 * calling window, wire abort controllers and the `ask_user` round-trip, and
 * delegate.
 */
import { Channels } from '../../shared/channels';
import * as graph from '../graph/index';
import * as conversation from '../llm/conversation';
import { buildConversationSystemPrompt } from '../llm/conversation-prompt';
import { runCompletionWithContainerRecovery } from '../llm/container-recovery';
import { compactConversation } from '../llm/compact';
import { buildStreamCallbacks, type PendingAskUser } from './conversation-stream';
import type { ContextBundle, ConversationCreateOptions, ConversationMessage } from '../../shared/conversation';
import { rootPathFromEvent, winFromEvent, withRootPath, withRootPathOr } from './helpers';
import { handle } from './typed-ipc';
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
    withRootPath((rootPath, state: import('../../shared/conversation').ConversationsUIState) =>
      conversation.saveUIState(rootPath, state)),
  );

  // Conversation send + LLM streaming
  const convAbortControllers = new Map<number, AbortController>();
  // Pending ask_user prompts keyed by question id. The CONVERSATION_SEND
  // handler creates an entry when the agent calls ask_user, and the
  // CONVERSATION_ASK_USER_REPLY handler resolves (or rejects) it. Aborting
  // the send rejects every pending question for that window so the agent
  // loop unwinds cleanly instead of hanging on an answered-never promise.
  const pendingAskUser: PendingAskUser = new Map();

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
    logger('conversation').info(`${userMessage === null ? 'RETRY' : 'SEND'} start: conv=${convId} userMsgLen=${userMessage?.length ?? 0}`);

    try {
      return await graph.withLLMContext(async () => {
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
        const stream = buildStreamCallbacks(win, convId, controller.signal, pendingAskUser);

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
              toolContext: { rootPath, conversationId: convId },
              model: conv.model,
              effort: conv.effort,
              extraTools,
              ...webOverride,
            },
            messages,
            conv.containerId,
            stream.callbacks,
          );
        } finally {
          stream.flush();
        }

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
      });
    } finally {
      convAbortControllers.delete(win.id);
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
