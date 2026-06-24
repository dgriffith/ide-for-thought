/**
 * Reasoning-effort gating + clamping (#825).
 */
import { describe, it, expect } from 'vitest';
import {
  supportedEfforts,
  modelSupportsEffort,
  effortSupported,
  clampEffort,
  resolveEffort,
  isEffort,
} from '../../src/shared/tools/effort';

describe('model gating', () => {
  it('Haiku supports no effort control', () => {
    expect(supportedEfforts('claude-haiku-4-5')).toEqual([]);
    expect(modelSupportsEffort('claude-haiku-4-5')).toBe(false);
  });

  it('Sonnet supports low/medium/high/max but not xhigh', () => {
    expect(supportedEfforts('claude-sonnet-4-6')).toEqual(['low', 'medium', 'high', 'max']);
    expect(effortSupported('claude-sonnet-4-6', 'xhigh')).toBe(false);
    expect(effortSupported('claude-sonnet-4-6', 'high')).toBe(true);
  });

  it('Opus supports xhigh (the UI "Extra")', () => {
    expect(supportedEfforts('claude-opus-4-8')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortSupported('claude-opus-4-8', 'xhigh')).toBe(true);
  });

  it('an unknown model supports nothing (don\'t risk a 400)', () => {
    expect(supportedEfforts('claude-future-9')).toEqual([]);
    expect(modelSupportsEffort('claude-future-9')).toBe(false);
  });
});

describe('clampEffort', () => {
  it('returns undefined for a model with no effort support', () => {
    expect(clampEffort('claude-haiku-4-5', 'high')).toBeUndefined();
  });

  it('passes a supported level through unchanged', () => {
    expect(clampEffort('claude-opus-4-8', 'xhigh')).toBe('xhigh');
    expect(clampEffort('claude-sonnet-4-6', 'high')).toBe('high');
  });

  it('snaps xhigh down to high on Sonnet (nearest, prefer lower on tie)', () => {
    // xhigh (idx 3) is equidistant from high (2) and max (4); prefer lower.
    expect(clampEffort('claude-sonnet-4-6', 'xhigh')).toBe('high');
  });

  it('returns undefined when no effort requested (omit output_config)', () => {
    expect(clampEffort('claude-sonnet-4-6', undefined)).toBeUndefined();
  });
});

describe('resolveEffort', () => {
  it('per-conversation override wins over the global default', () => {
    expect(resolveEffort('claude-opus-4-8', 'max', 'low')).toBe('max');
  });

  it('inherits the global default when no override', () => {
    expect(resolveEffort('claude-opus-4-8', undefined, 'high')).toBe('high');
  });

  it('clamps the resolved value to the model', () => {
    // Override xhigh on Sonnet → clamped to high.
    expect(resolveEffort('claude-sonnet-4-6', 'xhigh', undefined)).toBe('high');
    // Anything on Haiku → undefined (omit output_config).
    expect(resolveEffort('claude-haiku-4-5', 'max', 'high')).toBeUndefined();
  });

  it('omits effort entirely when neither override nor default is set', () => {
    // Preserves prior behavior for callers that never configured effort.
    expect(resolveEffort('claude-sonnet-4-6', undefined, undefined)).toBeUndefined();
  });
});

describe('isEffort', () => {
  it('accepts valid levels, rejects others', () => {
    expect(isEffort('xhigh')).toBe(true);
    expect(isEffort('medium')).toBe(true);
    expect(isEffort('ludicrous')).toBe(false);
    expect(isEffort(undefined)).toBe(false);
    expect(isEffort(3)).toBe(false);
  });
});
