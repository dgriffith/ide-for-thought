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

describe('cite link type', () => {
  const cite = getLinkType('cite');

  it('has predicate cites in the thought namespace', () => {
    expect(cite.predicate).toBe('cites');
    expect(cite.predicateNamespace).toBe('thought');
  });

  it('targets a source, not a note', () => {
    expect(cite.targetKind).toBe('source');
  });
});

describe('quote link type', () => {
  const quote = getLinkType('quote');

  it('has predicate quotes in the thought namespace', () => {
    expect(quote.predicate).toBe('quotes');
    expect(quote.predicateNamespace).toBe('thought');
  });

  it('targets an excerpt', () => {
    expect(quote.targetKind).toBe('excerpt');
  });
});

describe('load-bearing-for link type (#413)', () => {
  const lbf = getLinkType('load-bearing-for');

  it('uses the thought-namespaced predicate loadBearingFor', () => {
    // The research tool's system prompt instructs the model to emit
    // `[[load-bearing-for::source]]`; that has to materialise as
    // `thought:loadBearingFor` in the graph. The indexer derives the
    // predicate from this entry — keep them aligned.
    expect(lbf.name).toBe('load-bearing-for');
    expect(lbf.predicate).toBe('loadBearingFor');
    expect(lbf.predicateNamespace).toBe('thought');
  });

  it('targets a note (default), not a source/excerpt', () => {
    expect(lbf.targetKind ?? 'note').toBe('note');
  });
});
