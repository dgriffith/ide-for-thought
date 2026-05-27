/**
 * Reference mining helpers (#106) — pure-function tests for the
 * section detector, the entry splitter, and the LLM-response
 * parser. The end-to-end mineSourceReferences orchestrator is
 * exercised in the IPC tests with a stubbed LLM.
 */

import { describe, it, expect } from 'vitest';
import {
  extractReferenceSection,
  splitReferenceEntries,
  parseLLMResponse,
} from '../../../src/main/sources/mine-references';

describe('extractReferenceSection', () => {
  it('finds a level-2 References heading and returns its body', () => {
    const body = `# Introduction

Some prose.

## References

Smith, J. (2024). Foo bar.

Jones, K. (2023). Baz quux.`;
    expect(extractReferenceSection(body)).toBe(
      'Smith, J. (2024). Foo bar.\n\nJones, K. (2023). Baz quux.',
    );
  });

  it('finds "Bibliography" too', () => {
    const body = `# Body\n\n## Bibliography\n\nentry one\n\nentry two`;
    expect(extractReferenceSection(body)).toBe('entry one\n\nentry two');
  });

  it('finds "Works Cited" (case-insensitive)', () => {
    const body = `# Body\n\n### WORKS CITED\n\nentry`;
    expect(extractReferenceSection(body)).toBe('entry');
  });

  it('stops at the next equal-or-shallower heading', () => {
    const body = `# A\n\n## References\n\nentry one\n\nentry two\n\n## Appendix\n\nnot a ref`;
    expect(extractReferenceSection(body)).toBe('entry one\n\nentry two');
  });

  it('continues past deeper subheadings', () => {
    const body = `## References\n\nentry one\n\n### Secondary\n\nentry two\n\n## Appendix`;
    const section = extractReferenceSection(body);
    expect(section).toContain('entry one');
    expect(section).toContain('entry two');
    expect(section).not.toContain('Appendix');
  });

  it('returns null when no References-like heading exists', () => {
    expect(extractReferenceSection('# Just a body\n\nno refs here')).toBeNull();
  });

  it('returns null for an empty section', () => {
    expect(extractReferenceSection('# A\n\n## References\n\n   \n')).toBeNull();
  });
});

describe('splitReferenceEntries', () => {
  it('splits on numbered list prefixes', () => {
    const section = `1. Smith, J. (2024). Foo bar.
2. Jones, K. (2023). Baz quux.
3. Lin, R. (2022). Title here.`;
    const entries = splitReferenceEntries(section);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toContain('Smith, J.');
    expect(entries[2]).toContain('Lin, R.');
    // Numbered prefix stripped.
    expect(entries[0]).not.toMatch(/^1\./);
  });

  it('splits on bracket-style numbering', () => {
    const section = `[1] Smith 2024.\n[2] Jones 2023.`;
    expect(splitReferenceEntries(section)).toHaveLength(2);
  });

  it('splits on bullets', () => {
    const section = `- Smith 2024.\n- Jones 2023.\n- Lin 2022.`;
    expect(splitReferenceEntries(section)).toHaveLength(3);
  });

  it('falls back to paragraph splitting', () => {
    const section = `Smith, J. (2024). Foo.\n\nJones, K. (2023). Bar.\n\nLin (2022). Baz.`;
    expect(splitReferenceEntries(section)).toHaveLength(3);
  });

  it('returns a single entry when no separator works', () => {
    expect(splitReferenceEntries('one line only')).toEqual(['one line only']);
  });
});

describe('parseLLMResponse', () => {
  const ORIGINALS = ['Smith 2024 raw', 'Jones 2023 raw'];

  it('parses a clean JSON array', () => {
    const out = parseLLMResponse(
      JSON.stringify([
        { raw: 'Smith 2024 raw', title: 'Foo', authors: ['Smith, J.'], year: '2024', doi: '10.1/foo', subtype: 'Article' },
        { raw: 'Jones 2023 raw', title: 'Bar', authors: ['Jones, K.'], year: '2023', subtype: 'Book' },
      ]),
      ORIGINALS,
    );
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('Foo');
    expect(out[0].doi).toBe('10.1/foo');
    expect(out[0].subtype).toBe('Article');
    expect(out[1].subtype).toBe('Book');
  });

  it('strips a leading ```json fence', () => {
    const fenced = '```json\n' + JSON.stringify([{ raw: 'r', title: 'T', authors: [], year: null, subtype: 'Article' }]) + '\n```';
    const out = parseLLMResponse(fenced, ['r']);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('T');
  });

  it('drops entries with no title (LLM said "nothing useful here")', () => {
    const out = parseLLMResponse(JSON.stringify([
      { raw: 'r1', title: '', subtype: 'Article' },
      { raw: 'r2', title: 'Real', subtype: 'Article' },
    ]), ['r1', 'r2']);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Real');
  });

  it('defaults missing scalar fields to null', () => {
    const out = parseLLMResponse(JSON.stringify([{ raw: 'r', title: 'T', subtype: 'Article' }]), ['r']);
    expect(out[0].year).toBeNull();
    expect(out[0].doi).toBeNull();
    expect(out[0].containerTitle).toBeNull();
    expect(out[0].authors).toEqual([]);
  });

  it('rejects an invalid subtype by falling back to Source', () => {
    const out = parseLLMResponse(JSON.stringify([{ raw: 'r', title: 'T', subtype: 'Periodical' }]), ['r']);
    expect(out[0].subtype).toBe('Source');
  });

  it('falls back to the original entry text when raw is missing', () => {
    const out = parseLLMResponse(JSON.stringify([{ title: 'T', subtype: 'Article' }]), ['original-text']);
    expect(out[0].raw).toBe('original-text');
  });

  it('throws on non-JSON', () => {
    expect(() => parseLLMResponse('plain prose, no json', [])).toThrow(/non-JSON/);
  });

  it('throws when the response is not an array', () => {
    expect(() => parseLLMResponse(JSON.stringify({ title: 'T' }), [])).toThrow(/not a JSON array/);
  });

  it('coerces malformed year values to null', () => {
    const out = parseLLMResponse(JSON.stringify([{ raw: 'r', title: 'T', year: 'not-a-year', subtype: 'Article' }]), ['r']);
    expect(out[0].year).toBeNull();
  });
});
