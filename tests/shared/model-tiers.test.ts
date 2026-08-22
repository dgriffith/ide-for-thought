/**
 * Cross-provider tier mapping for skills (BYOM epic #1492).
 *
 * The rule under test: a skill's declared `model:` is a statement about how
 * much thinking it needs, not about which vendor sells it. Resetting onto
 * another provider has to carry that judgement across — a cheap mechanical
 * skill must not land on the frontier model just because the user switched to
 * Gemini, and a heavy reasoning skill must not be quietly downgraded.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultOverridesForProvider,
  isResettableProvider,
  tierForModel,
  RESETTABLE_PROVIDERS,
  TIER_MODELS,
} from '../../src/shared/tools/model-tiers';
import { MODEL_OPTIONS } from '../../src/shared/tools/models';

describe('tierForModel', () => {
  it('reads the cheap sibling of each provider as the quick tier', () => {
    expect(tierForModel('claude-sonnet-5')).toBe('quick');
    expect(tierForModel('gpt-5-mini')).toBe('quick');
    expect(tierForModel('gemini-2.5-flash')).toBe('quick');
  });

  it('reads flagships as the deep tier', () => {
    expect(tierForModel('claude-opus-5')).toBe('deep');
    expect(tierForModel('gpt-5')).toBe('deep');
    expect(tierForModel('gemini-2.5-pro')).toBe('deep');
  });

  it('defaults an unknown or absent model to deep, never a silent downgrade', () => {
    expect(tierForModel(undefined)).toBe('deep');
    expect(tierForModel('some-local-llama')).toBe('deep');
  });
});

describe('TIER_MODELS', () => {
  it('names only models that are actually in the catalog', () => {
    const known = new Set(MODEL_OPTIONS.map((m) => m.value));
    for (const provider of RESETTABLE_PROVIDERS) {
      for (const tier of ['deep', 'quick'] as const) {
        expect(known.has(TIER_MODELS[provider][tier])).toBe(true);
      }
    }
  });

  it('names models belonging to the provider they are listed under', () => {
    for (const provider of RESETTABLE_PROVIDERS) {
      for (const tier of ['deep', 'quick'] as const) {
        const entry = MODEL_OPTIONS.find((m) => m.value === TIER_MODELS[provider][tier]);
        expect(entry?.provider).toBe(provider);
      }
    }
  });

  it('excludes `local` — its models are user-configured, so there is no default pair', () => {
    expect(isResettableProvider('local')).toBe(false);
    expect(isResettableProvider('anthropic')).toBe(true);
  });
});

describe('defaultOverridesForProvider', () => {
  const skills = [
    { id: 'antithesize', model: 'claude-opus-5' },      // deep
    { id: 'add-term', model: 'claude-sonnet-5' },        // quick
    { id: 'no-preference' },                             // deep by default
  ];

  it('keeps each skill on its own tier when moving to another provider', () => {
    expect(defaultOverridesForProvider(skills, 'google', 'claude-opus-5')).toEqual({
      antithesize: 'gemini-2.5-pro',
      'add-term': 'gemini-2.5-flash',
      'no-preference': 'gemini-2.5-pro',
    });
    expect(defaultOverridesForProvider(skills, 'openai', 'claude-opus-5')).toEqual({
      antithesize: 'gpt-5',
      'add-term': 'gpt-5-mini',
      'no-preference': 'gpt-5',
    });
  });

  it('records no override where the skill already resolves to the tier model', () => {
    // Resetting onto the provider the skills were authored for should return
    // the panel to its pristine state, not pin fifty redundant values.
    expect(defaultOverridesForProvider(skills, 'anthropic', 'claude-opus-5')).toEqual({});
  });

  it('pins a skill whose own preference differs from the global default', () => {
    // With a Sonnet default, the deep skills need an explicit pin and the
    // quick one doesn't.
    expect(defaultOverridesForProvider(skills, 'anthropic', 'claude-sonnet-5')).toEqual({
      'no-preference': 'claude-opus-5',
    });
  });

  it('replaces the whole map rather than merging, so old pins are cleared', () => {
    const result = defaultOverridesForProvider([{ id: 'a', model: 'claude-opus-5' }], 'openai');
    expect(Object.keys(result)).toEqual(['a']);
  });

  it('is a no-op on an empty catalog', () => {
    expect(defaultOverridesForProvider([], 'openai', 'claude-opus-5')).toEqual({});
  });
});
