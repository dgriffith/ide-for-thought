/**
 * MRTR ("re-issue the same request with input responses attached") — the
 * modern era's replacement for independent server-initiated requests
 * (#2029). Protocol-level, not transport-specific: a modern-era server can
 * ask for `roots/list`/`elicitation/create`/`sampling/createMessage` input
 * over EITHER stdio or Streamable HTTP, so this lives outside `http/` and is
 * shared by both `stdio-transport.ts` and `http/modern-http-transport.ts`.
 */
import { McpInputRequiredUnhandledError, McpProtocolError } from './errors';
import type { InputRequiredHandler } from './types';

/** Bounds a buggy/hostile server repeatedly asking for input — the spec
 *  permits repeated `input_required`, but a client still needs a ceiling. */
export const MAX_MRTR_ROUNDS = 5;

/** Shape of a modern-era result — every modern response wraps its payload
 *  in `resultType`; an absent field (shouldn't happen once era is confirmed
 *  modern, but tolerated) reads as `'complete'`. */
export interface ModernResult {
  resultType?: string;
  inputRequests?: Record<string, { method: string; params: Record<string, unknown> }>;
  requestState?: unknown;
  [key: string]: unknown;
}

/**
 * Default v1 handler — there is no sampling/elicitation UI to call into yet,
 * so this answers what it honestly can and refuses to fabricate the rest:
 *   - `roots/list` → `{ roots: [] }` (true: this client exposes none).
 *   - `elicitation/create` → `{ action: 'decline' }` (a spec-legal honest no).
 *   - anything else (chiefly `sampling/createMessage`) → throws, since
 *     inventing an LLM completion here would violate the Trust Principle.
 */
export const defaultInputRequiredHandler: InputRequiredHandler = (requests) => {
  // Not `async` (no `await` in the body) but must still never throw
  // synchronously — `InputRequiredHandler`'s contract is "always returns a
  // promise," so a caller that doesn't immediately `await` the call still
  // observes a rejection rather than an uncaught throw.
  try {
    const responses: Record<string, Record<string, unknown>> = {};
    for (const [key, req] of Object.entries(requests)) {
      if (req.method === 'roots/list') responses[key] = { roots: [] };
      else if (req.method === 'elicitation/create') responses[key] = { action: 'decline' };
      else throw new McpInputRequiredUnhandledError(req.method);
    }
    return Promise.resolve(responses);
  } catch (err) {
    // `prefer-promise-reject-errors` requires this normalization even
    // though the only throw above is already a real Error — the `unknown`
    // catch type is enough to trigger the rule regardless.
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
};

/**
 * Drive the MRTR loop to completion. `reissue` re-sends the original
 * request (same method/params) with `inputResponses` (+ `requestState` when
 * the server sent one) attached, under a NEW request id — the caller owns
 * id generation and the actual transport call, so this stays transport-agnostic.
 */
export async function resolveMrtr(
  initialResult: ModernResult,
  reissue: (inputResponses: Record<string, Record<string, unknown>>, requestState: unknown) => Promise<ModernResult>,
  handler: InputRequiredHandler = defaultInputRequiredHandler,
): Promise<ModernResult> {
  let result = initialResult;
  let rounds = 0;
  while ((result.resultType ?? 'complete') === 'input_required') {
    if (++rounds > MAX_MRTR_ROUNDS) {
      throw new McpProtocolError(`MRTR loop exceeded ${MAX_MRTR_ROUNDS} rounds without completing`);
    }
    const inputResponses = await handler(result.inputRequests ?? {});
    result = await reissue(inputResponses, result.requestState);
  }
  return result;
}
