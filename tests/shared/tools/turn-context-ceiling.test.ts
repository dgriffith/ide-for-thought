/**
 * The per-turn context guard follows the model's window: 90% of it, capped at
 * 500k; 180k for a model whose window isn't known.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TURN_CONTEXT_CEILING,
  MAX_TURN_CONTEXT_CEILING,
  MODEL_CONTEXT_WINDOWS,
  MODEL_OPTIONS,
  turnContextCeiling,
} from '../../../src/shared/tools/models';

describe('turnContextCeiling', () => {
  it('keeps the old 180k on a 200k model', () => {
    expect(turnContextCeiling('claude-haiku-4-5')).toBe(180_000);
  });
  it('caps a 1M model at 500k', () => {
    expect(turnContextCeiling('claude-opus-5-5')).toBe(MAX_TURN_CONTEXT_CEILING);
    expect(turnContextCeiling('gpt-6-sol')).toBe(MAX_TURN_CONTEXT_CEILING);
  });
  it('is conservative for a model with no known window', () => {
    expect(turnContextCeiling('my-local-llama')).toBe(DEFAULT_TURN_CONTEXT_CEILING);
  });
  it('only lists windows for models in the catalog (no stale ids)', () => {
    const ids = new Set(MODEL_OPTIONS.map((m) => m.value));
    expect(Object.keys(MODEL_CONTEXT_WINDOWS).filter((id) => !ids.has(id))).toEqual([]);
  });
});
