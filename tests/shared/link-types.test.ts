import { describe, it, expect } from 'vitest';
import { LINK_TYPES, getLinkType, LINK_TYPE_MAP } from '../../src/shared/link-types';

describe('LINK_TYPES registry', () => {
  it('has unique names', () => {
    const names = LINK_TYPES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique predicates', () => {
    const predicates = LINK_TYPES.map((t) => t.predicate);
    expect(new Set(predicates).size).toBe(predicates.length);
  });

  it('first entry is references (the default)', () => {
    expect(LINK_TYPES[0].name).toBe('references');
  });
});

describe('getLinkType', () => {
  it('returns the correct type for a valid name', () => {
    const t = getLinkType('supports');
    expect(t.name).toBe('supports');
    expect(t.predicate).toBe('supports');
  });

  it('falls back to references for an unknown name', () => {
    const t = getLinkType('nonexistent');
    expect(t.name).toBe('references');
  });
});

describe('LINK_TYPE_MAP', () => {
  it('contains all types', () => {
    expect(LINK_TYPE_MAP.size).toBe(LINK_TYPES.length);
  });

  it('returns undefined for unknown keys', () => {
    expect(LINK_TYPE_MAP.get('nonexistent')).toBeUndefined();
  });
});
