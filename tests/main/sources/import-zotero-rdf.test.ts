import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  importZoteroRdfContent,
  extractIdentifiers,
  normalizeIssuedDate,
} from '../../../src/main/sources/import-zotero-rdf';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-zotero-rdf-test-'));
}

/**
 * Synthetic Zotero-style RDF covering a journal article with DOI + PDF
 * attachment, a book with ISBN, and a no-id @misc that should fall to
 * the content-hash fallback.
 */
const SAMPLE_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
 xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:bib="http://purl.org/net/biblio#"
 xmlns:foaf="http://xmlns.com/foaf/0.1/"
 xmlns:z="http://www.zotero.org/namespaces/export#"
 xmlns:link="http://purl.org/rss/1.0/modules/link/">

  <bib:Article rdf:about="#item_1">
    <z:itemType>journalArticle</z:itemType>
    <dc:title>Neural ISM Survey</dc:title>
    <dcterms:abstract>We present a survey of neutral ISM.</dcterms:abstract>
    <dc:date>2024-10-15</dc:date>
    <dc:identifier>DOI 10.1234/foo.bar</dc:identifier>
    <bib:authors>
      <rdf:Seq>
        <rdf:li>
          <foaf:Person>
            <foaf:surname>Sun</foaf:surname>
            <foaf:givenname>Yang</foaf:givenname>
          </foaf:Person>
        </rdf:li>
        <rdf:li>
          <foaf:Person>
            <foaf:surname>Ji</foaf:surname>
            <foaf:givenname>Zhiyuan</foaf:givenname>
          </foaf:Person>
        </rdf:li>
      </rdf:Seq>
    </bib:authors>
    <dcterms:isPartOf rdf:resource="#journal_1"/>
    <link:link rdf:resource="#item_1_attachment_1"/>
  </bib:Article>

  <bib:Journal rdf:about="#journal_1">
    <dc:title>Astrophysical Journal</dc:title>
  </bib:Journal>

  <z:Attachment rdf:about="#item_1_attachment_1">
    <z:itemType>attachment</z:itemType>
    <dc:title>Full Text PDF</dc:title>
    <link:type>application/pdf</link:type>
    <rdf:resource rdf:resource="files/1/paper.pdf"/>
  </z:Attachment>

  <bib:Book rdf:about="#item_2">
    <z:itemType>book</z:itemType>
    <dc:title>The Pragmatic Programmer</dc:title>
    <dc:date>2020</dc:date>
    <dc:identifier>ISBN 978-0-13-468599-1</dc:identifier>
    <bib:authors>
      <rdf:Seq>
        <rdf:li>
          <foaf:Person>
            <foaf:surname>Smith</foaf:surname>
            <foaf:givenname>John</foaf:givenname>
          </foaf:Person>
        </rdf:li>
      </rdf:Seq>
    </bib:authors>
    <dc:publisher>
      <foaf:Organization>
        <foaf:name>Addison-Wesley</foaf:name>
      </foaf:Organization>
    </dc:publisher>
  </bib:Book>

  <bib:Document rdf:about="#item_3">
    <dc:title>Loose Memo Without Identifiers</dc:title>
    <dc:date>January 2023</dc:date>
  </bib:Document>
</rdf:RDF>
`;

describe('importZoteroRdfContent (#270)', () => {
  let root: string;
  let attachmentBase: string;

  beforeEach(async () => {
    root = mkTempProject();
    attachmentBase = mkTempProject();
    // Create the attachment file referenced in SAMPLE_RDF. The dir layout
    // mirrors what Zotero's `.rdf + files/` export looks like on disk.
    await fsp.mkdir(path.join(attachmentBase, 'files', '1'), { recursive: true });
    await fsp.writeFile(
      path.join(attachmentBase, 'files', '1', 'paper.pdf'),
      'fake-pdf-bytes',
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(attachmentBase, { recursive: true, force: true });
  });

  it('imports one source per bib:* item and picks up DOI / ISBN identifiers', async () => {
    const result = await importZoteroRdfContent(root, SAMPLE_RDF, attachmentBase);
    expect(result.totalItems).toBe(3);
    expect(result.imported).toHaveLength(3);
    expect(result.failed).toEqual([]);

    const ids = result.imported.map((i) => i.sourceId);
    expect(ids).toContain('doi-10.1234_foo.bar');
    expect(ids).toContain('isbn-9780134685991');
    // The no-identifier document falls through to the content-hash fallback.
    expect(ids.some((id) => id.startsWith('sha-'))).toBe(true);
  });

  it('writes a meta.ttl with the expected shape', async () => {
    await importZoteroRdfContent(root, SAMPLE_RDF, attachmentBase);
    const ttl = await fsp.readFile(
      path.join(root, '.minerva/sources/doi-10.1234_foo.bar/meta.ttl'),
      'utf-8',
    );
    expect(ttl).toContain('this: a thought:Article');
    expect(ttl).toContain('dc:title "Neural ISM Survey"');
    // Authors preserved in order.
    expect(ttl).toMatch(/dc:creator "Yang Sun"[\s\S]*dc:creator "Zhiyuan Ji"/);
    expect(ttl).toContain('dc:issued "2024-10-15"^^xsd:date');
    expect(ttl).toContain('schema:inContainer "Astrophysical Journal"');
    expect(ttl).toContain('bibo:doi "10.1234/foo.bar"');
  });

  it('copies an attached PDF into the source folder as original.pdf', async () => {
    const result = await importZoteroRdfContent(root, SAMPLE_RDF, attachmentBase);
    const article = result.imported.find((i) => i.sourceId === 'doi-10.1234_foo.bar');
    expect(article?.pdfAttached).toBe(true);
    const pdfPath = path.join(root, '.minerva/sources/doi-10.1234_foo.bar/original.pdf');
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(await fsp.readFile(pdfPath, 'utf-8')).toBe('fake-pdf-bytes');
  });

  it('silently skips missing attachments (the PDF is advertised but not on disk)', async () => {
    // Delete the file the RDF points at.
    await fsp.rm(path.join(attachmentBase, 'files', '1', 'paper.pdf'));
    const result = await importZoteroRdfContent(root, SAMPLE_RDF, attachmentBase);
    const article = result.imported.find((i) => i.sourceId === 'doi-10.1234_foo.bar');
    expect(article?.pdfAttached).toBe(false);
    // meta.ttl still written.
    expect(
      fs.existsSync(path.join(root, '.minerva/sources/doi-10.1234_foo.bar/meta.ttl')),
    ).toBe(true);
  });

  it('is idempotent: re-importing the same RDF dedupes on canonical id', async () => {
    await importZoteroRdfContent(root, SAMPLE_RDF, attachmentBase);
    const second = await importZoteroRdfContent(root, SAMPLE_RDF, attachmentBase);
    expect(second.imported).toHaveLength(0);
    expect(second.duplicate).toHaveLength(3);
  });

  it('surfaces parse failures as a thrown error, not a silent empty result', async () => {
    await expect(
      importZoteroRdfContent(root, '<not valid xml at all', attachmentBase),
    ).rejects.toThrow(/parse failed/i);
  });
});

describe('extractIdentifiers', () => {
  it('extracts DOI from the "DOI …" literal form', () => {
    expect(extractIdentifiers(['DOI 10.1234/foo']).doi).toBe('10.1234/foo');
  });

  it('normalises a DOI-URL-form identifier', () => {
    expect(extractIdentifiers(['https://doi.org/10.1234/Foo']).doi).toBe('10.1234/foo');
  });

  it('strips whitespace and hyphens from ISBN', () => {
    expect(extractIdentifiers(['ISBN 978-0-13-468599-1']).isbn).toBe('9780134685991');
  });

  it('picks up ISSN', () => {
    expect(extractIdentifiers(['ISSN 1234-5678']).issn).toBe('1234-5678');
  });

  it('collects a plain http URL from the identifier list', () => {
    expect(extractIdentifiers(['https://example.org/paper']).url).toBe('https://example.org/paper');
  });
});

describe('normalizeIssuedDate', () => {
  it('passes ISO-shaped dates through', () => {
    expect(normalizeIssuedDate('2024-10-15')).toBe('2024-10-15');
    expect(normalizeIssuedDate('2024-10')).toBe('2024-10');
    expect(normalizeIssuedDate('2024')).toBe('2024');
  });

  it('extracts the year from a prose date', () => {
    expect(normalizeIssuedDate('October 15, 2024')).toBe('2024');
    expect(normalizeIssuedDate('Jan 2023')).toBe('2023');
  });

  it('returns null for inputs with no year-shaped run', () => {
    expect(normalizeIssuedDate('')).toBeNull();
    expect(normalizeIssuedDate('no year here')).toBeNull();
  });
});

