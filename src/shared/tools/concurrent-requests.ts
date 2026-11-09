/**
 * The bounds of Settings → AI's "Requests at once, per provider" (#2969),
 * shared by the field and main's request limiter (`llm/request-limiter.ts`).
 */
export const DEFAULT_CONCURRENT_REQUESTS = 4;
export const MIN_CONCURRENT_REQUESTS = 1;
export const MAX_CONCURRENT_REQUESTS = 16;

/** What a conversation's next model request is waiting on, for its status line; null once it runs. */
export type RequestWaitStatus =
  | { kind: 'queued'; ahead: number }
  | { kind: 'rate-limited'; retryInMs: number; attempt: number }
  | null;
