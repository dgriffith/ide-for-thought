import { describe, it, expect } from 'vitest';
import { parseArxivAtom } from '../../../../src/main/sources/api-adapters/arxiv';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2301.12345v2</id>
    <updated>2023-06-01T12:00:00Z</updated>
    <published>2023-01-15T08:00:00Z</published>
    <title>A Paper Title
With a Line Break</title>
    <summary>
      We study the foo
      and its relation to the bar.
    </summary>
    <author><name>Alice Smith</name></author>
    <author><name>Bob Jones</name></author>
    <arxiv:doi>10.1038/example</arxiv:doi>
    <arxiv:primary_category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <arxiv:journal_ref>Journal of Foo 42 (2024) 101-110</arxiv:journal_ref>
    <link href="http://arxiv.org/abs/2301.12345v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2301.12345v2" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

describe('parseArxivAtom (#96)', () => {
  it('extracts title, authors, abstract, category, DOI, and PDF link', () => {
    const meta = parseArxivAtom(SAMPLE, '2301.12345');
    expect(meta.title).toBe('A Paper Title With a Line Break');
    expect(meta.creators).toEqual(['Alice Smith', 'Bob Jones']);
    expect(meta.abstract).toBe('We study the foo and its relation to the bar.');
    expect(meta.doi).toBe('10.1038/example');
    expect(meta.category).toBe('cs.AI');
    expect(meta.pdfUrl).toBe('http://arxiv.org/pdf/2301.12345v2');
    expect(meta.uri).toBe('http://arxiv.org/abs/2301.12345v2');
    expect(meta.subtype).toBe('Preprint');
    expect(meta.containerTitle).toBe('Journal of Foo 42 (2024) 101-110');
  });

  it('trims the `published` date down to YYYY-MM-DD', () => {
    const meta = parseArxivAtom(SAMPLE, '2301.12345');
    expect(meta.issued).toBe('2023-01-15');
  });

  it('always sets publisher to arXiv and arxiv id to the supplied value', () => {
    const meta = parseArxivAtom(SAMPLE, '2301.12345');
    expect(meta.publisher).toBe('arXiv');
    expect(meta.arxiv).toBe('2301.12345');
  });

  it('throws when no entry is present', () => {
    const empty = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';
    expect(() => parseArxivAtom(empty, '2301.12345')).toThrow();
  });

  it('handles entries without an advertised PDF link', () => {
    const noPdf = SAMPLE.replace(/<link title="pdf"[^>]+>/, '');
    const meta = parseArxivAtom(noPdf, '2301.12345');
    expect(meta.pdfUrl).toBeNull();
  });

  it('falls back to an abs-page URL when the alternate link is absent', () => {
    const noAlt = SAMPLE.replace(/<link href="[^"]+" rel="alternate"[^>]+>/, '');
    const meta = parseArxivAtom(noAlt, '2301.12345');
    expect(meta.uri).toBe('https://arxiv.org/abs/2301.12345');
  });
});
