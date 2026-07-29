/**
 * Canonical list of built-in models surfaced in the UI, grouped by provider
 * (BYOM, epic #1492). Each entry declares its `provider` (see `providers.ts`)
 * so the settings/picker UI can group models and route each to the right
 * `LLMProvider` implementation.
 *
 * Kept in `shared/` so both the Settings dialog and the per-conversation
 * picker read from the same source of truth. Callers that need the
 * current default read it from LLMSettings.model. Note ids are NOT validated
 * against this list at call time — user-defined local models (BYOM #1497) are
 * legitimate ids absent here — so treat this as the built-in catalog, not an
 * allowlist.
 */

import type { ProviderId } from './providers';

export interface ModelOption {
  value: string;
  label: string;
  provider: ProviderId;
}

export const MODEL_OPTIONS: ModelOption[] = [
  // Opus 5, Fable 5, Opus 4.8, and Sonnet 5 all ship with a 1M-token context
  // window by default — there is no separate "1M context" model ID at the
  // Anthropic API, so we don't list duplicate entries for it. Ordered
  // most→least capable. Opus 5 is the current flagship and the default (see
  // DEFAULT_MODEL in main/llm/settings.ts). Opus 4.8 is kept (still active) so
  // a user who explicitly selected it isn't reset to the default. Sonnet 4.6 is
  // likewise kept; Sonnet 5 is its successor tier.
  { value: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic' },
  { value: 'claude-fable-5', label: 'Claude Fable 5', provider: 'anthropic' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
];

export function modelLabel(value: string): string {
  return MODEL_OPTIONS.find((m) => m.value === value)?.label ?? value;
}

/**
 * The provider a built-in model belongs to, or `undefined` for an id not in the
 * catalog (e.g. a user-defined local model). Callers that need a concrete
 * provider for an unknown id resolve it from settings, not from here.
 */
export function providerForModel(value: string): ProviderId | undefined {
  return MODEL_OPTIONS.find((m) => m.value === value)?.provider;
}

// ── Pricing (#821) ───────────────────────────────────────────────────────────

/** Per-model token price in US dollars per million tokens (`$/MTok`). */
export interface ModelPrice {
  /** Input (and the base for cache multipliers). */
  input: number;
  /** Output. */
  output: number;
}

/**
 * Pricing keyed by model id, co-located with `MODEL_OPTIONS` so adding a model
 * means adding its price in one place. A model absent here is "unpriced" —
 * cost degrades to a token count with no dollar figure rather than a guess.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Opus 5 at the standard Opus tier ($5/$25), matching every prior Opus 4.x
  // release (confirmed at GA — no flagship premium).
  'claude-opus-5': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 5, output: 25 },
  // Sonnet 5 standard rate. It has introductory pricing of $2/$10 through
  // 2026-08-31, but this map has no expiry mechanism — using the standard rate
  // slightly over-estimates cost during the intro window rather than silently
  // under-reporting after it ends. Revisit if we add time-aware pricing.
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/**
 * Cache-token price multipliers relative to the model's input rate. A cache
 * read is far cheaper than fresh input; writing the cache carries a premium.
 * Anthropic prices these uniformly as multiples of the input rate, so one pair
 * covers every model.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Minimal usage shape the cost function needs — matches `TurnUsage`. */
interface UsageLike {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Cost in USD for one turn's usage under a given model, or `null` if the model
 * isn't priced (caller should show tokens only — don't invent a price).
 *
 *   input·in + output·out + cacheRead·in·0.1 + cacheWrite·in·1.25   (per MTok)
 */
export function costForUsage(usage: UsageLike, model: string): number | null {
  const price = MODEL_PRICING[model];
  if (!price) return null;
  const perToken = (rate: number) => rate / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheReadTokens * perToken(price.input * CACHE_READ_MULTIPLIER) +
    usage.cacheCreationTokens * perToken(price.input * CACHE_WRITE_MULTIPLIER)
  );
}
