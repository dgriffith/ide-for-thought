import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  ingestPdf,
  finishPdfOcrIngest,
  readOriginalPdf,
  readPdfMeta,
  buildBodyMarkdown,
  buildMetaTtl,
  parsePdfDate,
} from '../../../src/main/sources/ingest-pdf';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ingest-pdf-test-'));
}

// Reuse the arXiv fixture already committed for demo purposes — avoids
// shipping a separate test fixture PDF.
const FIXTURE_PDF = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'sample-project',
  '.minerva',
  'sources',
  'arxiv-2604.18522',
  'original.pdf',
);

describe('ingestPdf (#94)', () => {
  let root: string;

  beforeEach(() => {
    root = mkTempProject();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('writes original.pdf + body.md + meta.ttl under a content-hash id', async () => {
    const result = await ingestPdf(root, FIXTURE_PDF);

    // Content-hash ids start with `sha-` and are 16 chars total (sha- + 12 hex).
    expect(result.sourceId).toMatch(/^sha-[0-9a-f]{12}$/);
    expect(result.duplicate).toBe(false);
    expect(result.pageCount).toBeGreaterThan(0);

    const sourceDir = path.join(root, '.minerva', 'sources', result.sourceId);
    expect(fs.existsSync(path.join(sourceDir, 'original.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, 'body.md'))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, 'meta.ttl'))).toBe(true);

    const body = await fsp.readFile(path.join(sourceDir, 'body.md'), 'utf-8');
    // Title line present and at least a couple of page markers.
    expect(body).toMatch(/^# .+/m);
    expect(body).toContain('<!-- page 1 -->');
    expect(body).toContain('<!-- page 2 -->');

    const meta = await fsp.readFile(path.join(sourceDir, 'meta.ttl'), 'utf-8');
    expect(meta).toContain('thought:PDFSource');
    expect(meta).toContain('dc:title');
    expect(meta).toMatch(/dc:extent\s+"\d+\s+pages"/);
  });

  it('is idempotent: re-ingesting the same bytes returns duplicate=true', async () => {
    const first = await ingestPdf(root, FIXTURE_PDF);
    const second = await ingestPdf(root, FIXTURE_PDF);

    expect(first.sourceId).toBe(second.sourceId);
    expect(second.duplicate).toBe(true);
  });

  it('stamps thought:extractionMethod "text-layer" on a successful text ingest', async () => {
    const result = await ingestPdf(root, FIXTURE_PDF);
    const meta = await fsp.readFile(
      path.join(root, '.minerva', 'sources', result.sourceId, 'meta.ttl'),
      'utf-8',
    );
    expect(meta).toContain('thought:extractionMethod "text-layer"');
    expect(result.needsOcr).toBe(false);
  });

  it('surfaces arXiv Custom.DOI as bibo:doi when present', async () => {
    const result = await ingestPdf(root, FIXTURE_PDF);
    const meta = await fsp.readFile(
      path.join(root, '.minerva', 'sources', result.sourceId, 'meta.ttl'),
      'utf-8',
    );
    // The arXiv fixture embeds a DOI in /Custom/DOI — the ingester should
    // normalize and record it.
    expect(meta).toMatch(/bibo:doi\s+"10\.48550\/arxiv\.2604\.18522"/);
  });

  it('splits the semicolon-separated /Author field into dc:creator lines', async () => {
    const result = await ingestPdf(root, FIXTURE_PDF);
    const meta = await fsp.readFile(
      path.join(root, '.minerva', 'sources', result.sourceId, 'meta.ttl'),
      'utf-8',
    );
    // At least a handful of creators for this 14-author paper — no trailing
    // `;` on any creator line, each on its own line.
    const creatorLines = meta.match(/^\s+dc:creator\s+".+"/gm) ?? [];
    expect(creatorLines.length).toBeGreaterThan(5);
    for (const line of creatorLines) {
      // Trim + end-of-line checks: creators aren't empty and don't contain
      // stray semicolons from a failed split.
      expect(line).not.toContain(';');
    }
  });
});

describe('finishPdfOcrIngest (#95)', () => {
  let root: string;
  beforeEach(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), 'minerva-pdf-ocr-')); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('rewrites body.md with OCR pages and stamps extractionMethod "ocr"', async () => {
    // Use the real fixture to stage a source on disk (original.pdf etc.),
    // then simulate "the renderer just finished OCR and is handing back text."
    const { sourceId } = await ingestPdf(root, FIXTURE_PDF);
    const pages = ['ocr page one\nmore ocr text', 'ocr page two'];
    await finishPdfOcrIngest(root, sourceId, pages);

    const body = await fsp.readFile(path.join(root, '.minerva', 'sources', sourceId, 'body.md'), 'utf-8');
    expect(body).toContain('<!-- page 1 -->');
    expect(body).toContain('ocr page one');
    expect(body).toContain('<!-- page 2 -->');
    expect(body).toContain('ocr page two');

    const meta = await fsp.readFile(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
    expect(meta).toContain('thought:extractionMethod "ocr"');
    // Old text-layer marker is replaced, not duplicated.
    expect(meta.match(/thought:extractionMethod/g)).toHaveLength(1);
  });

  it('readOriginalPdf returns the persisted bytes', async () => {
    const { sourceId } = await ingestPdf(root, FIXTURE_PDF);
    const bytes = await readOriginalPdf(root, sourceId);
    // PDF spec: bytes start with %PDF-
    expect(bytes.slice(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
  });
});

describe('readPdfMeta', () => {
  it('reads /Info fields into a normalized shape', async () => {
    const bytes = new Uint8Array(await fsp.readFile(FIXTURE_PDF));
    const meta = await readPdfMeta(bytes);
    expect(meta.title).toBeTruthy();
    expect(meta.creators.length).toBeGreaterThan(1);
    expect(meta.doi).toBe('10.48550/arxiv.2604.18522');
  });
});

describe('parsePdfDate', () => {
  it('extracts the YYYY-MM-DD prefix from a PDF date literal', () => {
    expect(parsePdfDate("D:20241015123045+00'00'")).toBe('2024-10-15');
  });

  it('falls back to year-month or year when the day is missing', () => {
    expect(parsePdfDate('D:202410')).toBe('2024-10');
    expect(parsePdfDate('D:2024')).toBe('2024');
  });

  it('returns null for unparseable inputs', () => {
    expect(parsePdfDate('')).toBeNull();
    expect(parsePdfDate('nonsense')).toBeNull();
  });
});

describe('buildBodyMarkdown', () => {
  it('emits title + per-page markers + page text, in that order', () => {
    const md = buildBodyMarkdown('Hello World', ['first page', 'second page']);
    expect(md).toBe(
      [
        '# Hello World',
        '',
        '<!-- page 1 -->',
        '',
        'first page',
        '',
        '<!-- page 2 -->',
        '',
        'second page',
        '',
      ].join('\n'),
    );
  });
});

describe('buildMetaTtl', () => {
  it('emits a PDFSource with all supplied fields', () => {
    const ttl = buildMetaTtl(
      {
        title: 'Thing',
        creators: ['A. Author', 'B. Author'],
        subject: null,
        keywords: null,
        creationDate: '2024-10-15',
        doi: '10.1234/foo',
      },
      { originalFilename: 'thing.pdf', pageCount: 5, extractionMethod: 'text-layer' },
    );
    expect(ttl).toContain('this: a thought:PDFSource');
    expect(ttl).toContain('dc:title "Thing"');
    expect(ttl).toContain('dc:creator "A. Author"');
    expect(ttl).toContain('dc:creator "B. Author"');
    expect(ttl).toContain('dc:issued "2024-10-15"^^xsd:date');
    expect(ttl).toContain('bibo:doi "10.1234/foo"');
    expect(ttl).toContain('thought:extractionMethod "text-layer"');
    expect(ttl).toContain('minerva:originalFilename "thing.pdf"');
    expect(ttl).toContain('dc:extent "5 pages"');
  });

  it('omits absent fields cleanly', () => {
    const ttl = buildMetaTtl(
      {
        title: null,
        creators: [],
        subject: null,
        keywords: null,
        creationDate: null,
        doi: null,
      },
      { originalFilename: 'bare.pdf', pageCount: 1, extractionMethod: null },
    );
    expect(ttl).not.toContain('dc:title');
    expect(ttl).not.toContain('dc:creator');
    expect(ttl).not.toContain('dc:issued');
    expect(ttl).not.toContain('bibo:doi');
    expect(ttl).toContain('minerva:originalFilename "bare.pdf"');
    expect(ttl).not.toContain('thought:extractionMethod');
  });

  it('stamps thought:extractionMethod "ocr" when OCR was used', () => {
    const ttl = buildMetaTtl(
      { title: null, creators: [], subject: null, keywords: null, creationDate: null, doi: null },
      { originalFilename: 'scan.pdf', pageCount: 3, extractionMethod: 'ocr' },
    );
    expect(ttl).toContain('thought:extractionMethod "ocr"');
  });
});
