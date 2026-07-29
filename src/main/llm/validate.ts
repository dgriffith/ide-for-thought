/**
 * Active API-key validation for the settings "Check connection" button (#...).
 *
 * The `hasApiKey` flag is a presence check — it says something is stored, not
 * that the provider will accept it. This makes a real, *free* request via the
 * provider so an expired / revoked / mistyped key (or an unreachable local
 * endpoint) surfaces immediately instead of on the next message.
 *
 * Validates the *effective* credentials for the chosen provider (BYOM #1498): a
 * non-empty `candidateKey` (an unsaved value still in the settings input) takes
 * precedence; otherwise the stored key for that provider is used via
 * `getSettings()`. `baseURL` lets a local / OpenAI-compatible endpoint be tested
 * before it's saved.
 *
 * The actual request lives in the provider (the only place a provider SDK is
 * imported, per the #1148 seam); this module owns credential resolution.
 */
import { createProviderForKey } from './provider';
import { getSettings } from './settings';
import { PROVIDERS, type ProviderId } from '../../shared/tools/providers';
import type { ConnectionCheckResult } from '../../shared/tools/types';

export async function checkConnection(
  providerId: ProviderId,
  candidateKey?: string,
  baseURL?: string,
): Promise<ConnectionCheckResult> {
  const settings = await getSettings();
  const stored = settings.providers[providerId];
  const typed = candidateKey?.trim();
  const key = typed && typed.length > 0 ? typed : (stored?.apiKey ?? '');
  const effectiveBaseURL = baseURL?.trim() || stored?.baseURL;

  // Keyless providers (local) just need an endpoint; keyed providers need a key.
  if (PROVIDERS[providerId].requiresKey && !key) {
    return { ok: false, error: 'No API key to check — enter one above or save it first.' };
  }
  if (PROVIDERS[providerId].usesBaseURL && !effectiveBaseURL) {
    return { ok: false, error: 'No base URL to check — enter the endpoint above first.' };
  }
  return createProviderForKey(providerId, key, effectiveBaseURL).checkConnection();
}
