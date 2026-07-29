/**
 * LLM provider registry (BYOM, epic #1492 — child #1493).
 *
 * The provider *implementations* live behind the `LLMProvider` seam in
 * `src/main/llm/provider/` (#1148); this is the shared, renderer-safe metadata
 * that names the providers, drives per-provider credential storage + settings
 * UI, and lets the model registry (`models.ts`) tag each model with its
 * provider. Kept in `shared/` so main and renderer read one source of truth.
 *
 * Adding a provider means: one entry here, one model-catalog block in
 * `models.ts`, and one `LLMProvider` implementation wired into the factory.
 */

/**
 * The set of known providers. `local` is the OpenAI-compatible escape hatch —
 * a user-configured base URL (Ollama, LM Studio, vLLM, llama.cpp, OpenRouter,
 * Together, …) served by the OpenAI implementation, so the whole open-source
 * long tail needs no bespoke code.
 */
export type ProviderId = 'anthropic' | 'openai' | 'google' | 'local';

export interface ProviderMeta {
  id: ProviderId;
  /** Human label for settings / picker group headers. */
  label: string;
  /** Env var consulted as a fallback when no key is stored; null when keyless. */
  envVar: string | null;
  /** Whether a request needs an API key (local endpoints often don't). */
  requiresKey: boolean;
  /** Whether the user configures a custom base URL (surfaced in settings). */
  usesBaseURL: boolean;
  /** Suggested base URL when `usesBaseURL` (Ollama's default). */
  defaultBaseURL?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    requiresKey: true,
    usesBaseURL: false,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    requiresKey: true,
    usesBaseURL: false,
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    requiresKey: true,
    usesBaseURL: false,
  },
  local: {
    id: 'local',
    label: 'Local / OpenAI-compatible',
    envVar: null,
    requiresKey: false,
    usesBaseURL: true,
    defaultBaseURL: 'http://localhost:11434/v1',
  },
};

/** All provider ids, in a stable display order (catalog / settings order). */
export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'google', 'local'];

export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

export function providerLabel(id: ProviderId): string {
  return PROVIDERS[id]?.label ?? id;
}
