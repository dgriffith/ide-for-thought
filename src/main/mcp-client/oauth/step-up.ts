/**
 * Step-up reauthorization support (#2030): scope-union logic (pure) and a
 * per-(server, scope-union) retry ceiling (in-memory — resets per app
 * launch, since the spec doesn't require this to be durable).
 */
import { McpStepUpRetryLimitExceededError } from '../errors';

/** Union of everything granted so far with what a 403 challenge demanded —
 *  "don't lose previously granted scope when requesting more." Sorted so
 *  the result is deterministic regardless of input order (used as a map
 *  key and stored back as `StoredOAuthRecord.scope`). */
export function unionScopes(previouslyGranted: string, challenged: string): string {
  const set = new Set([
    ...previouslyGranted.split(/\s+/).filter(Boolean),
    ...challenged.split(/\s+/).filter(Boolean),
  ]);
  return [...set].sort().join(' ');
}

const MAX_STEP_UP_ATTEMPTS = 2;
const attempts = new Map<string, number>();

function attemptKey(serverUrl: string, unionScope: string): string {
  return `${serverUrl}::${unionScope}`;
}

/** Record one attempt for (serverUrl, unionScope); throws
 *  `McpStepUpRetryLimitExceededError` once the ceiling is exceeded. Call
 *  BEFORE running the reauthorization flow, so a server that keeps
 *  demanding the same scope can't drive unbounded browser-popping. */
export function recordStepUpAttempt(serverUrl: string, unionScope: string): void {
  const key = attemptKey(serverUrl, unionScope);
  const count = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, count);
  if (count > MAX_STEP_UP_ATTEMPTS) {
    throw new McpStepUpRetryLimitExceededError(
      `exceeded ${MAX_STEP_UP_ATTEMPTS} step-up attempts for ${serverUrl} (scope: ${unionScope})`,
    );
  }
}

/** Clear the counter for (serverUrl, unionScope) after a successful
 *  reauthorization, so a later, unrelated step-up starts fresh. */
export function clearStepUpAttempts(serverUrl: string, unionScope: string): void {
  attempts.delete(attemptKey(serverUrl, unionScope));
}

/** Test-only reset — clears every tracked attempt regardless of key. */
export function _resetStepUpAttemptsForTests(): void {
  attempts.clear();
}
