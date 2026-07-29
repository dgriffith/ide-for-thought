/**
 * Model-registry parity guardrail (BYOM epic #1492, child #1493).
 *
 * The model catalog is split across three co-located-but-separate tables:
 *   - `MODEL_OPTIONS`  (models.ts)  — the models + their provider
 *   - `MODEL_PRICING`  (models.ts)  — $/MTok per model
 *   - `SUPPORT`        (effort.ts)  — supported reasoning-effort levels per model
 *
 * Before this test the only thing keeping them in sync was hand-written
 * per-model cases, so adding a model but forgetting its pricing/effort entry
 * degraded SILENTLY (unpriced cost, no effort control) rather than failing CI.
 * These assertions make the forward coupling — every catalog model is fully
 * described — a hard gate, and check each model names a real provider.
 *
 * Orphans (a pricing/effort entry with no catalog model) are intentionally NOT
 * failed: a deprecated id may keep its price so historical conversation costs
 * still render.
 */
import { describe, it, expect } from 'vitest';
import { MODEL_OPTIONS, MODEL_PRICING, customModelOptions, allModelOptions } from '../../src/shared/tools/models';
import { EFFORT_ENTRY_MODEL_IDS } from '../../src/shared/tools/effort';
import { isProviderId } from '../../src/shared/tools/providers';

const ids = MODEL_OPTIONS.map((m) => m.value);

describe('model-registry parity', () => {
  it('has no duplicate model ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every catalog model has an effort-support entry', () => {
    for (const id of ids) {
      expect(EFFORT_ENTRY_MODEL_IDS, `${id} missing from SUPPORT (effort.ts)`).toContain(id);
    }
  });

  it('every catalog model has a pricing entry', () => {
    for (const id of ids) {
      expect(
        Object.prototype.hasOwnProperty.call(MODEL_PRICING, id),
        `${id} missing from MODEL_PRICING`,
      ).toBe(true);
    }
  });

  it('every catalog model names a known provider', () => {
    for (const m of MODEL_OPTIONS) {
      expect(isProviderId(m.provider), `${m.value} has unknown provider "${m.provider}"`).toBe(true);
    }
  });
});

describe('custom (local) model options (#1497)', () => {
  it('tags each custom model local, label falls back to id, blanks dropped', () => {
    expect(customModelOptions([{ id: 'llama3.1', label: 'Llama' }, { id: 'qwen' }, { id: '' }])).toEqual([
      { value: 'llama3.1', label: 'Llama', provider: 'local' },
      { value: 'qwen', label: 'qwen', provider: 'local' },
    ]);
    expect(customModelOptions(undefined)).toEqual([]);
  });

  it('allModelOptions appends custom models after the built-in catalog', () => {
    expect(allModelOptions([{ id: 'llama3.1' }])).toEqual([
      ...MODEL_OPTIONS,
      { value: 'llama3.1', label: 'llama3.1', provider: 'local' },
    ]);
  });
});
