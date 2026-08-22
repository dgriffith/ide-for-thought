/**
 * Cross-provider tier mapping for skills (#1158-adjacent; BYOM epic #1492).
 *
 * Every stock skill declares a `model:` preference in ANTHROPIC terms — the
 * heavier ones ask for Opus, the cheap mechanical ones for Sonnet. That's a
 * statement about how much thinking the skill needs, not about who should sell
 * it: "Antithesize deserves the frontier model, Add Term to Glossary doesn't."
 *
 * A user working through OpenAI or Google inherits ids they may have no key
 * for, and re-picking a model for fifty-odd skills by hand is not a thing
 * anyone will do. This module carries that judgement across providers, so
 * "reset every skill to its default, on Gemini" keeps the cheap skills cheap
 * instead of flattening everything onto one flagship.
 *
 * Deliberately a separate module from `models.ts`: the catalog there is a flat
 * list of what exists, and tagging each entry with a tier would imply a total
 * ordering the catalog doesn't have (where does `o3` sit against `gpt-5`?).
 * Only the two ends of the range need naming to make the mapping work.
 */
/**
 * How much model a skill wants. `deep` is the provider's frontier model —
 * reasoning, synthesis, argument. `quick` is its cheaper sibling, for the
 * skills that mostly reformat or extract.
 */
export type ModelTier = 'deep' | 'quick';

/** Providers a skill can be reset onto: the ones with a built-in catalog (a
 *  subset of `ProviderId`). `local` is excluded — its models are whatever the
 *  user configured, so there's no default pair to map onto. */
export const RESETTABLE_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
export type ResettableProvider = (typeof RESETTABLE_PROVIDERS)[number];

export function isResettableProvider(v: string): v is ResettableProvider {
  return (RESETTABLE_PROVIDERS as readonly string[]).includes(v);
}

/** The two ends of each provider's range. Keep in step with `MODEL_OPTIONS`. */
export const TIER_MODELS: Record<ResettableProvider, Record<ModelTier, string>> = {
  anthropic: { deep: 'claude-opus-5', quick: 'claude-sonnet-5' },
  openai: { deep: 'gpt-5', quick: 'gpt-5-mini' },
  google: { deep: 'gemini-2.5-pro', quick: 'gemini-2.5-flash' },
};

/** Models that mean "the cheap one" in their provider's range. Anything else
 *  (including an unknown id, and including every flagship) reads as `deep`, so
 *  a skill is never quietly downgraded by a model we don't recognise. */
const QUICK_MODELS = new Set<string>([
  'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  'gpt-5-mini', 'o4-mini',
  'gemini-2.5-flash',
]);

export function tierForModel(model: string | undefined): ModelTier {
  return model && QUICK_MODELS.has(model) ? 'quick' : 'deep';
}

/** A skill, as far as this mapping cares: its id and its declared preference. */
export interface TieredSkill {
  id: string;
  /** The skill's own `model:` frontmatter preference, if it has one. */
  model?: string | undefined;
}

/**
 * The per-skill override map that puts every skill back on its default tier,
 * expressed in `provider`'s models.
 *
 * An override is only recorded where it's actually needed: when the tier model
 * is already what the skill would resolve to on its own (its `model:`, else the
 * global default), the entry is dropped, so resetting onto the provider a skill
 * was authored for returns the panel to its pristine no-overrides state rather
 * than pinning fifty redundant values.
 *
 * Pure — the caller decides what to do with the result (the Skills panel binds
 * it and persists on Done).
 */
export function defaultOverridesForProvider(
  skills: TieredSkill[],
  provider: ResettableProvider,
  defaultModel?: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const skill of skills) {
    const wanted = TIER_MODELS[provider][tierForModel(skill.model)];
    const resolvesTo = skill.model || defaultModel;
    if (wanted !== resolvesTo) next[skill.id] = wanted;
  }
  return next;
}
