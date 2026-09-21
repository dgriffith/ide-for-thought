/**
 * Recovery from the API's `container_id is required` 400 (#2237, epic #2241).
 *
 * A conversation whose history contains a code-execution turn must re-echo the
 * sandbox container id on every subsequent request. If that id is missing or
 * has expired, the API rejects the whole turn — and because the offending
 * history is already persisted, the conversation is stuck: every retry fails
 * the same way. The recovery drops the cached id, strips the turns that demand
 * a container, and tries once more.
 *
 * That is a policy decision (retry once, lossily, only for this one error
 * marker), not IPC plumbing, and it is the kind of thing worth being able to
 * test without a BrowserWindow: the branch that matters most is the one that
 * must NOT fire — any other error has to propagate untouched rather than being
 * silently retried against a mangled history.
 */
import * as conversation from './conversation';
import { logger } from '../../shared/logger';

export type LlmMessage = { role: 'user' | 'assistant'; content: string };
type CompleteWithTools = typeof import('./index').completeWithTools;
type CompletionParams = Parameters<CompleteWithTools>[0];
export type StreamCallbacks = NonNullable<CompletionParams['callbacks']>;

/** The API's "container_id required" 400 marker — matched to trigger the
 *  strip-and-retry recovery in `runCompletionWithContainerRecovery`. */
const CONTAINER_REQUIRED_MARKER = 'container_id is required';

/** Drop assistant turns whose persisted text carries our code-execution markers
 *  (`_🔍 Searching` / `_🌐 Fetching` / `_⚙️ Running code`). Those are the only
 *  history entries that can make the API demand a container; stripping them
 *  (lossy) lets a stuck conversation recover. */
export function stripCodeExecutionTurns(msgs: LlmMessage[]): LlmMessage[] {
  return msgs.filter((m) => {
    if (m.role !== 'assistant' || typeof m.content !== 'string') return true;
    return !/_(?:🔍 Searching|🌐 Fetching|⚙️ Running code)/.test(m.content);
  });
}

/** Run `completeWithTools`, recovering once from the API's `container_id is
 *  required` 400: drop the cached container id, strip code-execution turns from
 *  history, and retry without an initial container id. Any other error — or a
 *  second failure — propagates. */
export async function runCompletionWithContainerRecovery(
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
    logger('conversation').warn(
      `container_id 400 — recovering. conv=${convId} ` +
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
