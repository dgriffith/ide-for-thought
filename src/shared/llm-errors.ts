/**
 * The "this provider isn't set up" error contract, shared by the process that
 * throws it and the one that reacts to it.
 *
 * IPC strips the Error class, so message-matching is what we have: main throws
 * a message containing `PROVIDER_UNCONFIGURED_MARKER`, and the renderer detects
 * it across the boundary (Electron's `invoke` rejects with a plain Error whose
 * `.message` carries the main-process text, prefixed with "Error invoking
 * remote method '…': ", so the marker survives as a substring).
 *
 * The message BUILDERS live here beside the parser on purpose (#1796
 * follow-up). The marker used to be hardcoded to "Anthropic API key not
 * configured" and every provider borrowed it, so choosing a Gemini model with
 * no Gemini key produced "Anthropic API key not configured. Set the Google
 * Gemini API key…" — and the renderer's dialog, having no way to know better,
 * told you to set ANTHROPIC_API_KEY. Keeping both halves in one file is what
 * makes the round-trip testable.
 *
 * "Unconfigured" rather than "missing key" because the local /
 * OpenAI-compatible provider needs a base URL, not a key, and reports through
 * the same channel — a message about an API key would be wrong for it.
 */

import { PROVIDERS, PROVIDER_IDS, type ProviderId } from './tools/providers';

/** Stable substring identifying an unconfigured-provider failure. Neutral: the
 *  provider is named around it, never inside it. */
export const PROVIDER_UNCONFIGURED_MARKER = 'is not set up yet';

function messageOf(err: unknown): string | null {
  if (err == null) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return null;
}

function prefix(id: ProviderId): string {
  return `${PROVIDERS[id].label} ${PROVIDER_UNCONFIGURED_MARKER}`;
}

/** "This provider has no API key." Names the provider and its env var. */
export function missingApiKeyMessage(id: ProviderId): string {
  const env = PROVIDERS[id].envVar ? ` or set ${PROVIDERS[id].envVar}` : '';
  return `${prefix(id)}. Add an API key in Settings → AI${env}.`;
}

/** "This provider has no endpoint." The local provider's equivalent. */
export function missingBaseUrlMessage(id: ProviderId): string {
  return `${prefix(id)}. Add a base URL in Settings → AI.`;
}

/** Did this failure come from a provider that isn't set up? */
export function isProviderUnconfiguredError(err: unknown): boolean {
  const msg = messageOf(err);
  return msg !== null && msg.includes(PROVIDER_UNCONFIGURED_MARKER);
}

/**
 * Which provider isn't set up, or null when the error isn't one of ours.
 * Callers should treat null as "say something generic" rather than guessing a
 * provider — guessing is the bug this replaced.
 */
export function unconfiguredProvider(err: unknown): ProviderId | null {
  const msg = messageOf(err);
  if (msg === null) return null;
  return PROVIDER_IDS.find((id) => msg.includes(prefix(id))) ?? null;
}
