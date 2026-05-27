/**
 * Conservative metadata merge for re-ingested sources (#90).
 */

import { describe, it, expect } from 'vitest';
import { Parser } from 'n3';
import { mergeMetaTtl } from '../../../src/main/sources/source-merge';

const PREAMBLE = '@prefix this: <minerva://this#> .\n@prefix dc: <http://purl.org/dc/terms/> .\n@prefix bibo: <http://purl.org/ontology/bibo/> .\n@prefix schema: <http://schema.org/> .\n@prefix thought: <https://minerva.dev/ontology/thought#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n';

function makeExisting(predicates: string[]): string {
  const lines = ['this: a thought:Article ;'];
  for (const p of predicates) lines.push(`    ${p} ;`);
  lines.push('    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .');
  return lines.join('\n') + '\n';
}

/** Sanity: every assertion below should still produce parseable Turtle. */
function assertParses(ttl: string): void {
  const errors: Error[] = [];
  new Parser().parse(PREAMBLE + ttl, (err) => { if (err) errors.push(err); });
  if (errors.length > 0) {
    throw new Error(`TTL did not parse:\n${ttl}\n\nerror: ${errors[0].message}`);
  }
}

describe('mergeMetaTtl (#90)', () => {
  it('adds a missing bibo:doi when the existing file lacks one', () => {
    const existing = makeExisting(['dc:title "Foo"']);
    const { ttl, added } = mergeMetaTtl(existing, { doi: '10.1/foo' });
    expect(added).toEqual(['doi']);
    expect(ttl).toContain('bibo:doi "10.1/foo"');
    // Inserted before the final `.`, not after.
    expect(ttl.indexOf('bibo:doi')).toBeLessThan(ttl.indexOf('thought:accessedAt'));
    assertParses(ttl);
  });

  it('does NOT overwrite an existing bibo:doi', () => {
    const existing = makeExisting(['dc:title "Foo"', 'bibo:doi "10.1/old"']);
    const { ttl, added } = mergeMetaTtl(existing, { doi: '10.1/new' });
    expect(added).toEqual([]);
    expect(ttl).toContain('bibo:doi "10.1/old"');
    expect(ttl).not.toContain('10.1/new');
  });

  it('adds multiple missing predicates in one merge', () => {
    const existing = makeExisting(['dc:title "Foo"']);
    const { ttl, added } = mergeMetaTtl(existing, {
      doi: '10.1/foo',
      isbn: '9780140449136',
      publisher: 'Acme Books',
      containerTitle: 'Journal of Foo',
      abstract: 'Some abstract.',
      issued: '2024',
    });
    expect(added.sort()).toEqual(['abstract', 'containerTitle', 'doi', 'isbn', 'issued', 'publisher']);
    expect(ttl).toContain('bibo:doi "10.1/foo"');
    expect(ttl).toContain('bibo:isbn "9780140449136"');
    expect(ttl).toContain('dc:publisher "Acme Books"');
    expect(ttl).toContain('schema:inContainer "Journal of Foo"');
    expect(ttl).toContain('dc:abstract "Some abstract."');
    expect(ttl).toContain('dc:issued "2024"^^xsd:gYear');
    assertParses(ttl);
  });

  it('emits dc:issued with the right XSD datatype for each date shape', () => {
    expect(mergeMetaTtl(makeExisting([]), { issued: '2024' }).ttl).toContain('"2024"^^xsd:gYear');
    expect(mergeMetaTtl(makeExisting([]), { issued: '2024-05' }).ttl).toContain('"2024-05"^^xsd:gYearMonth');
    expect(mergeMetaTtl(makeExisting([]), { issued: '2024-05-27' }).ttl).toContain('"2024-05-27"^^xsd:date');
  });

  it('skips dc:creator when any creator is already present', () => {
    const existing = makeExisting(['dc:title "Foo"', 'dc:creator "Smith, A."']);
    const { ttl, added } = mergeMetaTtl(existing, { creators: ['Smith, A.', 'Jones, B.'] });
    expect(added).toEqual([]);
    expect(ttl).toContain('dc:creator "Smith, A."');
    expect(ttl).not.toContain('Jones, B.');
  });

  it('adds every creator when none exist', () => {
    const existing = makeExisting(['dc:title "Foo"']);
    const { ttl, added } = mergeMetaTtl(existing, { creators: ['Smith, A.', 'Jones, B.'] });
    expect(added).toEqual(['creator']);
    expect(ttl).toContain('dc:creator "Smith, A."');
    expect(ttl).toContain('dc:creator "Jones, B."');
    assertParses(ttl);
  });

  it('is a no-op when nothing new to add', () => {
    const existing = makeExisting(['dc:title "Foo"', 'bibo:doi "10.1/x"']);
    const { ttl, added } = mergeMetaTtl(existing, { doi: '10.1/x', isbn: undefined });
    expect(added).toEqual([]);
    expect(ttl).toBe(existing);
  });

  it('treats null and undefined fields as "no update"', () => {
    const existing = makeExisting(['dc:title "Foo"']);
    const { ttl, added } = mergeMetaTtl(existing, {
      doi: null,
      isbn: undefined,
      publisher: null,
      creators: null,
    });
    expect(added).toEqual([]);
    expect(ttl).toBe(existing);
  });

  it('preserves hand-added predicates the writer doesn\'t know about', () => {
    const existing = makeExisting([
      'dc:title "Foo"',
      'dc:subject "hand-added"',
      'thought:hasStatus thought:established',
    ]);
    const { ttl } = mergeMetaTtl(existing, { doi: '10.1/foo' });
    expect(ttl).toContain('dc:subject "hand-added"');
    expect(ttl).toContain('thought:hasStatus thought:established');
    expect(ttl).toContain('bibo:doi "10.1/foo"');
    assertParses(ttl);
  });

  it('escapes special characters in string literals', () => {
    const existing = makeExisting(['dc:title "Foo"']);
    const { ttl } = mergeMetaTtl(existing, { abstract: 'Has "quotes" and\nnewlines.' });
    // Quotes escaped, newlines escaped as \n.
    expect(ttl).toContain('Has \\"quotes\\" and\\nnewlines.');
    assertParses(ttl);
  });
});
