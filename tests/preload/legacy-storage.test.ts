/**
 * The one-shot localStorage import from the old file:// origin (#2564).
 */
import { describe, it, expect } from 'vitest';
import { importLegacyOriginStorage } from '../../src/preload/legacy-storage';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

describe('importLegacyOriginStorage (#2564)', () => {
  it('copies keys the new origin lacks, and never overwrites one it has', () => {
    const s = fakeStorage({ theme: 'light' });
    expect(importLegacyOriginStorage(() => ({ theme: 'dark', layout: '{"a":1}' }), () => s)).toBe(1);
    expect(s.data.get('theme')).toBe('light');
    expect(s.data.get('layout')).toBe('{"a":1}');
  });

  it('null from main (every launch but the first) copies nothing', () => {
    const s = fakeStorage();
    expect(importLegacyOriginStorage(() => null, () => s)).toBe(0);
    expect(s.data.size).toBe(0);
  });

  it('a throwing main or storage starts fresh instead of breaking the page', () => {
    expect(importLegacyOriginStorage(() => { throw new Error('main gone'); }, () => fakeStorage())).toBe(0);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    expect(importLegacyOriginStorage(() => ({ k: 'v' }), () => broken)).toBe(0);
    expect(importLegacyOriginStorage(() => ({ k: 'v' }), () => { throw new Error('SecurityError'); })).toBe(0);
  });
});
