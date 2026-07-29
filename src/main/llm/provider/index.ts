/**
 * Provider factory — the single place the conversation layer resolves *which*
 * model provider to use (#1148). Today there is one; when a second ships, it
 * branches here on a settings field and nothing above this line changes.
 */
import { getSettings } from '../settings';
import { MISSING_API_KEY_MARKER } from '../../../shared/llm-errors';
import { DEFAULT_WEB_SETTINGS } from '../../../shared/tools/types';
import type { Effort } from '../../../shared/tools/effort';
import { AnthropicProvider } from './anthropic';
import type { LLMProvider, WebToolSettings } from './types';

export type { LLMProvider } from './types';

export interface ResolvedProvider {
  provider: LLMProvider;
  /** The default model for this provider, from settings. */
  model: string;
  web: WebToolSettings;
  /** Global default reasoning effort, before per-call override/clamping. */
  effort: Effort | undefined;
}

/**
 * Build the configured provider plus the settings the caller threads into each
 * request (model, web tools, default effort). Throws the marker error the
 * renderer detects when no API key is set, so the "Open Settings" affordance
 * still fires exactly as before.
 */
export async function getProvider(): Promise<ResolvedProvider> {
  const settings = await getSettings();
  // Anthropic is still the only wired implementation (BYOM #1495 branches this
  // on the selected model's provider). Read its per-provider credentials.
  const apiKey = settings.providers.anthropic?.apiKey;
  if (!apiKey) {
    throw new Error(
      `${MISSING_API_KEY_MARKER}. Set it in the LLM settings or ANTHROPIC_API_KEY environment variable.`,
    );
  }
  const provider = new AnthropicProvider(apiKey);
  return {
    provider,
    model: settings.model,
    web: settings.web ?? { ...DEFAULT_WEB_SETTINGS },
    effort: settings.effort,
  };
}

/**
 * Build a provider bound to an explicit key, bypassing stored settings — used
 * by the "Check connection" validator to test an unsaved typed key. Keeps
 * provider construction (and the SDK) behind the seam.
 */
export function createProviderForKey(apiKey: string): LLMProvider {
  return new AnthropicProvider(apiKey);
}
