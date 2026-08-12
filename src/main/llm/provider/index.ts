/**
 * Provider factory — the single place the conversation layer resolves *which*
 * model provider to use (#1148). The provider is chosen from the EFFECTIVE
 * model (per-conversation override beats the global default), because a
 * per-conversation model can belong to a different provider than the default
 * (BYOM #1495) — so the caller passes its resolved model in.
 */
import { getSettings } from '../settings';
import { missingApiKeyMessage, missingBaseUrlMessage } from '../../../shared/llm-errors';
import { DEFAULT_WEB_SETTINGS, type LLMSettings } from '../../../shared/tools/types';
import type { Effort } from '../../../shared/tools/effort';
import { providerForModel } from '../../../shared/tools/models';
import { type ProviderId } from '../../../shared/tools/providers';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';
import type { LLMProvider, WebToolSettings } from './types';

export type { LLMProvider } from './types';

export interface ResolvedProvider {
  provider: LLMProvider;
  /** Which provider this is — so a failure can be attributed to the provider
   *  the user actually chose rather than a hardcoded one (#1804). */
  id: ProviderId;
  /** The effective model this provider will run (override ?? default). */
  model: string;
  web: WebToolSettings;
  /** Global default reasoning effort, before per-call override/clamping. */
  effort: Effort | undefined;
}

/** The marker error the renderer detects to show the "Open Settings"
 *  affordance. Built in `shared/llm-errors.ts` beside the parser that reads
 *  the provider back out, so the two can't drift. */
function missingKeyError(id: ProviderId): Error {
  return new Error(missingApiKeyMessage(id));
}

/**
 * Which provider a model belongs to. Built-in models carry it in the catalog;
 * a user-defined custom model (settings.customModels) routes to `local`; an
 * otherwise-unknown id falls back to Anthropic.
 */
function resolveProviderId(model: string, settings: LLMSettings): ProviderId {
  const builtIn = providerForModel(model);
  if (builtIn) return builtIn;
  if (settings.customModels?.some((m) => m.id === model)) return 'local';
  return 'anthropic';
}

/** Construct the provider for `id`, reading its credentials from settings.
 *  Throws the missing-key marker when the required key is absent. */
function buildProvider(id: ProviderId, settings: LLMSettings): LLMProvider {
  switch (id) {
    case 'anthropic': {
      const key = settings.providers.anthropic?.apiKey;
      if (!key) throw missingKeyError('anthropic');
      return new AnthropicProvider(key);
    }
    case 'openai': {
      const c = settings.providers.openai;
      if (!c?.apiKey) throw missingKeyError('openai');
      return new OpenAIProvider(c.apiKey, c.baseURL);
    }
    case 'google': {
      const c = settings.providers.google;
      if (!c?.apiKey) throw missingKeyError('google');
      return new GoogleProvider(c.apiKey);
    }
    case 'local': {
      // OpenAI-compatible endpoint (Ollama/LM Studio/vLLM/…). Reuses the OpenAI
      // implementation with a custom base URL; the key is optional (keyless
      // local servers). Reports id 'local' for provenance.
      const c = settings.providers.local;
      if (!c?.baseURL) {
        // Same channel as a missing key — the renderer's "open Settings"
        // affordance fires for either — but the local provider needs an
        // ADDRESS, not a key, so it says so.
        throw new Error(missingBaseUrlMessage('local'));
      }
      return new OpenAIProvider(c.apiKey ?? '', c.baseURL, undefined, 'local');
    }
  }
}

/**
 * Build the provider for the given model (or the global default when omitted)
 * plus the settings the caller threads into each request (resolved model, web
 * tools, default effort). Throws the marker error the renderer detects when the
 * chosen provider has no API key, so the "Open Settings" affordance fires.
 */
export async function getProvider(modelOverride?: string): Promise<ResolvedProvider> {
  const settings = await getSettings();
  const model = modelOverride ?? settings.model;
  const id = resolveProviderId(model, settings);
  const provider = buildProvider(id, settings);
  return {
    provider,
    id,
    model,
    web: settings.web ?? { ...DEFAULT_WEB_SETTINGS },
    effort: settings.effort,
  };
}

/**
 * Build a provider bound to an explicit key, bypassing stored settings — used
 * by the "Check connection" validator to test an unsaved typed key. Keeps
 * provider construction (and the SDKs) behind the seam.
 */
export function createProviderForKey(providerId: ProviderId, apiKey: string, baseURL?: string): LLMProvider {
  switch (providerId) {
    case 'openai':
      return new OpenAIProvider(apiKey, baseURL);
    case 'local':
      return new OpenAIProvider(apiKey, baseURL, undefined, 'local');
    case 'google':
      return new GoogleProvider(apiKey);
    case 'anthropic':
    default:
      return new AnthropicProvider(apiKey);
  }
}
