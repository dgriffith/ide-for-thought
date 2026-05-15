/**
 * Stable marker substring carried by the Error thrown when the
 * Anthropic API key is not configured. Lives in `shared/` so both the
 * main process (which throws it) and the renderer (which detects it
 * across the IPC boundary) reference the same constant — IPC strips
 * the Error class, so message-matching is what we have.
 *
 * Detection across IPC: Electron's `invoke` rejects with a plain Error
 * whose `.message` carries the main-process error's message (prefixed
 * with "Error invoking remote method '…': "), so the marker still
 * appears as a substring in the rejection's message.
 */
export const MISSING_API_KEY_MARKER = 'Anthropic API key not configured';

export function isMissingApiKeyError(err: unknown): boolean {
  if (err == null) return false;
  if (err instanceof Error) return err.message.includes(MISSING_API_KEY_MARKER);
  if (typeof err === 'string') return err.includes(MISSING_API_KEY_MARKER);
  return false;
}
