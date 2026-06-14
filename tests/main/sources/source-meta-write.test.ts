/**
 * Source meta.ttl single-predicate writers (#103) — extracted from read-status
 * (#116) and reused by the source-property approval path. Covers the abstract /
 * TL;DR upserts that "Propose Summary" lands on a source.
 */
import { describe, it, expect } from 'vitest';
import {
  upsertSingleValuedPredicate,
  ttlString,
  setSourceTitle,
  addTagLine,
  removeTagLines,
  addSourceTag,
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

describe('setSourceTitle (rename, #765)', () => {
  it('replaces dc:title in place — no duplicate line, old title gone', () => {
    const out = upsertSingleValuedPredicate(META, 'dc:title', ttlString('Renamed paper'));
    expect(out).toContain('dc:title "Renamed paper" ;');
    expect(out).not.toContain('"Test paper"');
    expect((out.match(/dc:title/g) ?? []).length).toBe(1);
  });

  it('inserts dc:title when a source has none yet', () => {
    const noTitle = `this: a thought:Article ;\n    dc:creator "Alice" .\n`;
    const out = upsertSingleValuedPredicate(noTitle, 'dc:title', ttlString('Fresh'));
    expect(out).toContain('dc:title "Fresh" ;');
    expect(out.trimEnd().endsWith('.')).toBe(true);
  });

  it('rejects an empty/whitespace title before touching disk', async () => {
    await expect(setSourceTitle('/nonexistent/root', 'src-x', '   ')).rejects.toThrow(/cannot be empty/);
  });
});

describe('source tags (#766)', () => {
  it('adds a minerva:tag line before the closing dot', () => {
    const { ttl, added } = addTagLine(META, 'methods');
    expect(added).toBe(true);
    expect(ttl).toContain('minerva:tag "methods" ;');
    expect(ttl.indexOf('minerva:tag')).toBeLessThan(ttl.indexOf('thought:accessedAt'));
    expect(ttl.trimEnd().endsWith('.')).toBe(true);
  });

  it('does not duplicate a tag already present as a user OR upstream tag', () => {
    const withUser = addTagLine(META, 'ml').ttl;
    expect(addTagLine(withUser, 'ml').added).toBe(false);
    const upstream = `this: a thought:Article ;\n    minerva:upstreamTag "ml" ;\n    dc:title "X" .\n`;
    expect(addTagLine(upstream, 'ml').added).toBe(false);
  });

  it('removes both user (minerva:tag) and upstream (minerva:upstreamTag) lines', () => {
    const ttl = `this: a thought:Article ;\n    minerva:tag "ml" ;\n    minerva:upstreamTag "ml" ;\n    dc:title "X" .\n`;
    const { ttl: out, removed } = removeTagLines(ttl, 'ml');
    expect(removed).toBe(true);
    expect(out).not.toContain('"ml"');
    expect(out).toContain('dc:title "X"');
    expect(out.trimEnd().endsWith('.')).toBe(true);
  });

  it('removing a tag that is the last predicate keeps the TTL well-formed', () => {
    const ttl = `this: a thought:Article ;\n    minerva:tag "only" .\n`;
    const { ttl: out } = removeTagLines(ttl, 'only');
    expect(out).not.toContain('minerva:tag');
    expect(out.trimEnd().endsWith('.')).toBe(true);
  });

  it('removeTagLines is a no-op for an absent tag', () => {
    expect(removeTagLines(META, 'nope').removed).toBe(false);
  });

  it('addSourceTag rejects an empty tag before touching disk', async () => {
    await expect(addSourceTag('/nonexistent/root', 'src-x', '  ')).rejects.toThrow(/cannot be empty/);
  });
});

describe('ttlString', () => {
  it('escapes quotes, backslashes, and newlines', () => {
    expect(ttlString('he said "hi"\nline2')).toBe('"he said \\"hi\\"\\nline2"');
    expect(ttlString('a\\b')).toBe('"a\\\\b"');
  });
});
