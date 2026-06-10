/**
 * `ingestFile` — dispatch a local file to the right Source pipeline by type:
 * PDF → PDF pipeline, HTML → Readability, text/Markdown → verbatim Document.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ingestFile } from '../../../src/main/sources/ingest-file';

const FIXTURE_PDF = path.resolve(
  __dirname, '..', '..', 'fixtures', 'sample-project', '.minerva', 'sources', 'arxiv-2604.18522', 'original.pdf',
);

const SAMPLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Saved Article</title></head>
<body><article><h1>Saved Article</h1>
<p>This is the lede paragraph, long enough for Readability to score it as real content with enough words and punctuation to clear the bar.</p>
<p>A second paragraph adds weight so the article passes the extraction threshold, which is stricter on sparse pages.</p>
<p>A third paragraph for good measure, since Readability is fussy.</p></article></body></html>`;

describe('ingestFile dispatch', () => {
  let root: string;
  let scratch: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ingest-file-'));
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ingest-file-src-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function write(name: string, content: string): Promise<string> {
    const p = path.join(scratch, name);
    await fsp.writeFile(p, content, 'utf-8');
    return p;
  }

  it('routes a .pdf file to the PDF pipeline', async () => {
    const result = await ingestFile(root, FIXTURE_PDF);
    expect(result.kind).toBe('pdf');
    expect(result.pageCount).toBeGreaterThan(0);
    const dir = path.join(root, '.minerva', 'sources', result.sourceId);
    expect(fs.existsSync(path.join(dir, 'original.pdf'))).toBe(true);
  });

  it('routes a .html file through Readability into a web Source', async () => {
    const result = await ingestFile(root, await write('article.html', SAMPLE_HTML));
    expect(result.kind).toBe('web');
    expect(result.title).toBe('Saved Article');
    const dir = path.join(root, '.minerva', 'sources', result.sourceId);
    const meta = await fsp.readFile(path.join(dir, 'meta.ttl'), 'utf-8');
    expect(meta).toContain('thought:WebPage');
    // Local file → no bibo:uri.
    expect(meta).not.toContain('bibo:uri');
    const body = await fsp.readFile(path.join(dir, 'body.md'), 'utf-8');
    expect(body).toMatch(/lede paragraph/);
  });

  it('ingests a Markdown file as a Document, title from the first heading', async () => {
    const md = '# My Notes\n\nSome body text here.\n';
    const result = await ingestFile(root, await write('notes.md', md));
    expect(result.kind).toBe('text');
    expect(result.title).toBe('My Notes');
    const dir = path.join(root, '.minerva', 'sources', result.sourceId);
    const meta = await fsp.readFile(path.join(dir, 'meta.ttl'), 'utf-8');
    expect(meta).toContain('thought:Document');
    expect(meta).toContain('dc:title "My Notes"');
    const body = await fsp.readFile(path.join(dir, 'body.md'), 'utf-8');
    expect(body).toBe(md); // verbatim
  });

  it('ingests a .txt file as a Document, title from the filename', async () => {
    const result = await ingestFile(root, await write('plain-notes.txt', 'just some text, no heading'));
    expect(result.kind).toBe('text');
    expect(result.title).toBe('plain-notes');
  });

  it('dedupes identical text content to one Source', async () => {
    const a = await ingestFile(root, await write('a.md', '# Same\n\nidentical body'));
    const b = await ingestFile(root, await write('b.md', '# Same\n\nidentical body'));
    expect(b.sourceId).toBe(a.sourceId);
    expect(b.duplicate).toBe(true);
  });

  it('rejects an unsupported file type with a clear message', async () => {
    await expect(ingestFile(root, await write('report.docx', 'binary-ish')))
      .rejects.toThrow(/can't ingest .*docx.*PDF, HTML, text, and Markdown/i);
  });
});
