import { describe, it, expect } from 'vitest';
import { buildMetadata, parseAbstractXml } from '../../../../src/main/sources/api-adapters/pubmed';

describe('buildMetadata (#96)', () => {
  const summary = {
    result: {
      uids: ['12345'],
      '12345': {
        uid: '12345',
        title: 'A PubMed Paper.',
        authors: [
          { name: 'Smith A', authtype: 'Author' },
          { name: 'Jones B', authtype: 'Author' },
          { name: 'Some Committee', authtype: 'CollectiveName' },
        ],
        pubdate: '2023 Jan 15',
        fulljournalname: 'New England Journal of Medicine',
        source: 'N Engl J Med',
        articleids: [
          { idtype: 'pubmed', value: '12345' },
          { idtype: 'doi', value: '10.1056/example' },
        ],
      },
    },
  };

  it('extracts title, authors (only Authors, not collectives), journal', () => {
    const meta = buildMetadata('12345', summary, 'The abstract.');
    expect(meta.title).toBe('A PubMed Paper');
    expect(meta.creators).toEqual(['Smith A', 'Jones B']);
    expect(meta.containerTitle).toBe('New England Journal of Medicine');
  });

  it('normalises pubdate to ISO form', () => {
    expect(buildMetadata('12345', summary, null).issued).toBe('2023-01-15');
  });

  it('falls back to month-only / year-only when pubdate is partial', () => {
    const partial = structuredClone(summary);
    (partial.result['12345'] as { pubdate?: string }).pubdate = '2023 Jan';
    expect(buildMetadata('12345', partial, null).issued).toBe('2023-01');

    (partial.result['12345'] as { pubdate?: string }).pubdate = '2023';
    expect(buildMetadata('12345', partial, null).issued).toBe('2023');
  });

  it('picks the DOI out of articleids', () => {
    expect(buildMetadata('12345', summary, null).doi).toBe('10.1056/example');
  });

  it('sets the canonical PubMed URL as `uri`', () => {
    expect(buildMetadata('12345', summary, null).uri).toBe('https://pubmed.ncbi.nlm.nih.gov/12345/');
  });

  it('throws when the record is missing', () => {
    expect(() => buildMetadata('99999', summary, null)).toThrow(/no record/i);
  });
});

describe('parseAbstractXml (#96)', () => {
  it('returns null for empty documents', () => {
    const empty = '<?xml version="1.0"?><PubmedArticleSet></PubmedArticleSet>';
    expect(parseAbstractXml(empty)).toBeNull();
  });

  it('joins multiple AbstractText parts, prefixing with the Label when present', () => {
    const xml = `<?xml version="1.0"?>
      <PubmedArticleSet>
        <PubmedArticle><MedlineCitation><Article><Abstract>
          <AbstractText Label="BACKGROUND">The problem is complex.</AbstractText>
          <AbstractText Label="METHODS">We ran studies.</AbstractText>
          <AbstractText Label="RESULTS">We found things.</AbstractText>
        </Abstract></Article></MedlineCitation></PubmedArticle>
      </PubmedArticleSet>`;
    expect(parseAbstractXml(xml)).toBe(
      'BACKGROUND: The problem is complex. METHODS: We ran studies. RESULTS: We found things.',
    );
  });

  it('handles a single unlabeled AbstractText', () => {
    const xml = `<?xml version="1.0"?>
      <PubmedArticleSet><PubmedArticle><MedlineCitation><Article><Abstract>
        <AbstractText>Plain abstract.</AbstractText>
      </Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
    expect(parseAbstractXml(xml)).toBe('Plain abstract.');
  });
});
