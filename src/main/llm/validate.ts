/**
 * Active API-key validation for the settings "Check connection" button (#...).
 *
 * The `hasApiKey` flag is a presence check — it says something is stored, not
 * that Anthropic will accept it. This makes a real, *free* request
 * (`models.list`, a GET that spends no tokens) via the provider so an expired /
 * revoked / mistyped key surfaces immediately instead of on the next message.
 *
 * Validates the *effective* key: a non-empty `candidateKey` (an unsaved value
 * still in the settings input) takes precedence, so the user can test a key
 * before committing it; otherwise the stored key (or `ANTHROPIC_API_KEY`) is
 * used via `getSettings()`.
 *
 * The actual request lives in the provider (the only place the Anthropic SDK is
 * imported, per the #1148 seam); this module owns key resolution and the pure
 * error → reason mapping.
 */
import { createProviderForKey } from './provider';
import { getSettings } from './settings';
import type { ConnectionCheckResult } from '../../shared/tools/types';

export async function checkConnection(candidateKey?: string): Promise<ConnectionCheckResult> {
  const typed = candidateKey?.trim();
  const key = typed && typed.length > 0 ? typed : (await getSettings()).providers.anthropic?.apiKey;
  if (!key) {
    return { ok: false, error: 'No API key to check — enter one above or save it first.' };
  }
  return createProviderForKey(key).checkConnection();
}
