/**
 * Source meta.ttl single-predicate writers (#103) — extracted from read-status
 * (#116) and reused by the source-property approval path. Covers the abstract /
 * TL;DR upserts that "Propose Summary" lands on a source.
 */
import { describe, it, expect } from 'vitest';
import {
  upsertSingleValuedPredicate,
  ttlString,
} from '../../../src/main/sources/source-meta-write';

const META = `this: a thought:Article ;
    dc:title "Test paper" ;
    dc:creator "Alice" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;

describe('source summary predicates', () => {
  it('inserts dc:abstract before the closing dot', () => {
    const out = upsertSingleValuedPredicate(META, 'dc:abstract', ttlString('An abstract.'));
    expect(out).toContain('dc:abstract "An abstract." ;');
    expect(out.indexOf('dc:abstract')).toBeLessThan(out.indexOf('thought:accessedAt'));
    expect(out).toContain('dc:title "Test paper"'); // existing predicates survive
  });

  it('inserts thought:tldr', () => {
    const out = upsertSingleValuedPredicate(META, 'thought:tldr', ttlString('Plain-language gist.'));
    expect(out).toContain('thought:tldr "Plain-language gist." ;');
  });

  it('replaces an existing value in place (no duplicate line)', () => {
    let ttl = upsertSingleValuedPredicate(META, 'thought:tldr', ttlString('first'));
    ttl = upsertSingleValuedPredicate(ttl, 'thought:tldr', ttlString('second'));
    expect(ttl).toContain('thought:tldr "second"');
    expect(ttl).not.toContain('"first"');
    expect((ttl.match(/thought:tldr/g) ?? []).length).toBe(1);
  });

  it('upserting the same value twice is idempotent', () => {
    const once = upsertSingleValuedPredicate(META, 'dc:abstract', ttlString('stable'));
    const twice = upsertSingleValuedPredicate(once, 'dc:abstract', ttlString('stable'));
    expect(twice).toBe(once);
  });

  it('applying both abstract and tldr keeps the TTL well-formed', () => {
    let ttl = upsertSingleValuedPredicate(META, 'dc:abstract', ttlString('A.'));
    ttl = upsertSingleValuedPredicate(ttl, 'thought:tldr', ttlString('T.'));
    // Exactly one trailing dot, every non-final predicate ends with ';'.
    expect(ttl.trimEnd().endsWith('.')).toBe(true);
    expect(ttl).toContain('dc:abstract "A." ;');
    expect(ttl).toContain('thought:tldr "T." ;');
  });
});

describe('ttlString', () => {
  it('escapes quotes, backslashes, and newlines', () => {
    expect(ttlString('he said "hi"\nline2')).toBe('"he said \\"hi\\"\\nline2"');
    expect(ttlString('a\\b')).toBe('"a\\\\b"');
  });
});
