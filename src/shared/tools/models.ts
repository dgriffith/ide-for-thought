/**
 * Canonical list of Anthropic models surfaced in the UI.
 *
 * Kept in `shared/` so both the Settings dialog and the per-conversation
 * picker read from the same source of truth. Callers that need the
 * current default read it from LLMSettings.model, which is validated
 * against this list.
 */

export interface ModelOption {
  value: string;
  label: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  // Opus 4.8 and Sonnet 4.6 ship with a 1M-token context window by default —
  // there is no separate "1M context" model ID at the Anthropic API, so we
  // don't list duplicate entries for it.
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

export function modelLabel(value: string): string {
  return MODEL_OPTIONS.find((m) => m.value === value)?.label ?? value;
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
  'claude-opus-4-8': { input: 5, output: 25 },
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
