import { describe, it, expect } from 'vitest';
import {
  detectSparqlPhase,
  extractQueryVariables,
  extractUserPrefixes,
  STANDARD_PREFIXES,
} from '../../src/shared/sparql-completions';

const KNOWN = new Set(STANDARD_PREFIXES.map((p) => p.prefix));

function at(src: string): { before: string; pos: number } {
  // `|` marks the cursor in the test string.
  const pos = src.indexOf('|');
  if (pos < 0) throw new Error(`missing cursor marker in test input: ${src}`);
  return { before: src.slice(0, pos), pos };
}

describe('detectSparqlPhase (issue #198)', () => {
  it('variable phase: right after `?`', () => {
    const { before, pos } = at('SELECT ?|');
    expect(detectSparqlPhase(before, pos, KNOWN))
      .toEqual({ kind: 'variable', from: pos, prefix: '' });
  });

  it('variable phase: partial variable name', () => {
    const { before, pos } = at('SELECT ?no|');
    expect(detectSparqlPhase(before, pos, KNOWN))
      .toEqual({ kind: 'variable', from: pos - 2, prefix: 'no' });
  });

  it('variable phase: `$y` sigil', () => {
    const { before, pos } = at('SELECT $yea|');
    expect(detectSparqlPhase(before, pos, KNOWN))
      .toEqual({ kind: 'variable', from: pos - 3, prefix: 'yea' });
  });

  it('prefixed phase: known prefix, empty local', () => {
    const { before, pos } = at('?x minerva:|');
    const phase = detectSparqlPhase(before, pos, KNOWN);
    expect(phase.kind).toBe('prefixed');
    if (phase.kind === 'prefixed') {
      expect(phase.prefix).toBe('minerva');
      expect(phase.local).toBe('');
      expect(phase.localFrom).toBe(pos);
    }
  });

  it('prefixed phase: known prefix with partial local', () => {
    const { before, pos } = at('?x minerva:ha|');
    const phase = detectSparqlPhase(before, pos, KNOWN);
    expect(phase.kind).toBe('prefixed');
    if (phase.kind === 'prefixed') {
      expect(phase.prefix).toBe('minerva');
      expect(phase.local).toBe('ha');
      expect(phase.localFrom).toBe(pos - 2);
    }
  });

  it('general phase: unknown prefix falls through', () => {
    const { before, pos } = at('?x mystery:|');
    // `mystery` isn\u2019t in KNOWN, so this is not prefixed-phase; the
    // current identifier word is "mystery".
    const phase = detectSparqlPhase(before, pos, KNOWN);
    expect(phase.kind).toBe('general');
  });

  it('general phase: mid-keyword', () => {
    const { before, pos } = at('SEL|');
    expect(detectSparqlPhase(before, pos, KNOWN))
      .toEqual({ kind: 'general', from: 0, prefix: 'SEL' });
  });

  it('general phase: on whitespace (Ctrl+Space invocation)', () => {
    const { before, pos } = at('SELECT |');
    expect(detectSparqlPhase(before, pos, KNOWN))
      .toEqual({ kind: 'general', from: pos, prefix: '' });
  });
});

describe('extractQueryVariables', () => {
  it('returns sorted unique variable names without sigils', () => {
    const src = 'SELECT ?note ?title WHERE { ?note dc:title ?title . ?note minerva:hasTag $tag }';
    expect(extractQueryVariables(src)).toEqual(['note', 'tag', 'title']);
  });

  it('returns [] for a variableless query', () => {
    expect(extractQueryVariables('ASK { <urn:a> <urn:p> <urn:b> }')).toEqual([]);
  });
});

describe('extractUserPrefixes', () => {
  it('extracts PREFIX declarations in order, deduplicating', () => {
    const src = `PREFIX a: <urn:a>
PREFIX b:  <urn:b>
prefix c: <urn:c>
PREFIX a: <urn:a-dup>
SELECT ?x WHERE { ?x a:p ?y }`;
    expect(extractUserPrefixes(src)).toEqual([
      { prefix: 'a', iri: 'urn:a' },
      { prefix: 'b', iri: 'urn:b' },
      { prefix: 'c', iri: 'urn:c' },
    ]);
  });

  it('returns [] when there are no PREFIX lines', () => {
    expect(extractUserPrefixes('SELECT ?x WHERE { ?x <urn:p> ?y }')).toEqual([]);
  });
});
