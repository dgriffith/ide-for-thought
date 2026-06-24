/**
 * Reasoning-effort levels and per-model gating (#825).
 *
 * Effort is sent as `output_config: { effort }` on the Messages call — NOT
 * `budget_tokens` (deprecated on Sonnet 4.6, 400s on Opus 4.7/4.8). Support is
 * model-gated, so the picker must only offer levels the selected model accepts,
 * or the request 400s:
 *
 *   | Model       | Supported effort                    |
 *   |-------------|-------------------------------------|
 *   | Haiku 4.5   | none (sending effort 400s)          |
 *   | Sonnet 4.6  | low / medium / high / max           |
 *   | Opus 4.8    | low / medium / high / xhigh / max   |
 *
 * The UI label "Extra" maps to `xhigh`, which is Opus-only.
 *
 * Kept in `shared/` so the renderer picker, the Settings default, and the
 * main-side guard all gate from one source of truth.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Canonical ordering low→max, used for the picker order and clamp distance. */
export const EFFORT_LEVELS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra' },
  { value: 'max', label: 'Max' },
];

const ORDER: Effort[] = EFFORT_LEVELS.map((l) => l.value);

/** Sensible middle default when none is configured. */
export const DEFAULT_EFFORT: Effort = 'medium';

/**
 * Supported effort levels per model. A model absent here (an unknown/future id)
 * yields `[]` — we send no effort rather than risk a 400.
 */
const SUPPORT: Record<string, Effort[]> = {
  'claude-opus-4-8': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-sonnet-4-6': ['low', 'medium', 'high', 'max'],
  'claude-haiku-4-5': [],
};

export function supportedEfforts(model: string): Effort[] {
  return SUPPORT[model] ?? [];
}

/** True when the model accepts any effort control at all (Haiku: false). */
export function modelSupportsEffort(model: string): boolean {
  return supportedEfforts(model).length > 0;
}

export function isEffort(v: unknown): v is Effort {
  return typeof v === 'string' && (ORDER as string[]).includes(v);
}

export function effortSupported(model: string, effort: Effort): boolean {
  return supportedEfforts(model).includes(effort);
}

/**
 * Clamp an effort to what the model supports. Returns `undefined` when there's
 * nothing to send — either the model has no effort support (Haiku) or no effort
 * was requested (so the caller omits `output_config` and the API uses its own
 * default; this preserves prior behavior for callers that never set effort).
 * When the requested level is unsupported (e.g. `xhigh` on Sonnet), snaps to
 * the nearest supported level by canonical distance, preferring the lower
 * (cheaper) side on ties.
 */
export function clampEffort(model: string, effort: Effort | undefined): Effort | undefined {
  const supported = supportedEfforts(model);
  if (supported.length === 0) return undefined;
  if (!effort) return undefined;
  if (supported.includes(effort)) return effort;
  const targetIdx = ORDER.indexOf(effort);
  let best = supported[0];
  let bestDist = Infinity;
  for (const s of supported) {
    const dist = Math.abs(ORDER.indexOf(s) - targetIdx);
    // Strict `<` keeps the first (lower, since `supported` is in canonical
    // order) on a tie — prefer stepping down over up.
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/** The effort actually sent for a turn: per-conversation override (if set) else
 *  the global default, clamped to the model. `undefined` ⇒ omit output_config. */
export function resolveEffort(
  model: string,
  override: Effort | undefined,
  globalDefault: Effort | undefined,
): Effort | undefined {
  return clampEffort(model, override ?? globalDefault);
}
