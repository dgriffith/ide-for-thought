import { describe, it, expect } from 'vitest';
import { CONFIRM_KEYS, CONFIRM_REGISTRY, confirmRegistryEntry } from '../../src/renderer/lib/confirm-keys';

describe('CONFIRM_KEYS / CONFIRM_REGISTRY', () => {
  it('every constant in CONFIRM_KEYS has a matching registry entry', () => {
    const registryKeys = new Set(CONFIRM_REGISTRY.map((e) => e.key));
    const unregistered: string[] = [];
    for (const [, key] of Object.entries(CONFIRM_KEYS)) {
      if (!registryKeys.has(key)) unregistered.push(key);
    }
    expect(unregistered).toEqual([]);
  });

  it('every registry entry has a non-empty title and description', () => {
    for (const entry of CONFIRM_REGISTRY) {
      expect(entry.title.trim()).not.toBe('');
      expect(entry.description.trim()).not.toBe('');
    }
  });

  it('registry keys are unique', () => {
    const keys = CONFIRM_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('confirmRegistryEntry looks up known keys', () => {
    expect(confirmRegistryEntry(CONFIRM_KEYS.delete)?.title).toBe('Delete file or folder');
  });

  it('confirmRegistryEntry returns null for unknown keys', () => {
    expect(confirmRegistryEntry('does-not-exist')).toBeNull();
  });
});
