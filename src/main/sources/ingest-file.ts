/**
 * Local-file ingestion → Source (the "Ingest File as Source" command).
 *
 * Dispatches by file type:
 *   - PDF              → the PDF pipeline (text extraction + OCR fallback)
 *   - HTML             → the same Readability/structured extraction as URL ingest
 *   - text / Markdown  → a thought:Document whose body.md is the file content
 *
 * Other types are rejected with a clear message. All three share the Source
 * layout under `.minerva/sources/<id>/` and dedupe on a content hash so the same
 * file ingested twice collapses to one Source.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalSourceId } from './source-id';
import { ingestPdfBuffer } from './ingest-pdf';
import { ingestHtmlString, type IngestResult } from './ingest';

const HTML_EXTS = new Set(['.html', '.htm']);
const TEXT_EXTS = new Set(['.md', '.markdown', '.txt', '.text']);

export async function ingestFile(rootPath: string, absPath: string): Promise<IngestResult> {
  const ext = path.extname(absPath).toLowerCase();
  const base = path.basename(absPath);

  if (ext === '.pdf') {
    const buf = await fs.readFile(absPath);
    const pdf = await ingestPdfBuffer(rootPath, buf, { originalFilename: base });
    return {
      sourceId: pdf.sourceId,
      relativePath: pdf.relativePath,
      duplicate: pdf.duplicate,
      title: pdf.title,
      kind: 'pdf',
      pageCount: pdf.pageCount,
      needsOcr: pdf.needsOcr,
    };
  }

  if (HTML_EXTS.has(ext)) {
    const html = await fs.readFile(absPath, 'utf-8');
    // No URL for a local file → content-hash id, no bibo:uri; filename is the
    // title fallback when the page has no <title>.
    return ingestHtmlString(rootPath, html, { titleFallback: stripExt(base) });
  }

  if (TEXT_EXTS.has(ext)) {
    const content = await fs.readFile(absPath, 'utf-8');
    return ingestTextDocument(rootPath, content, base);
  }

  throw new Error(
    `Can't ingest *${ext || ' (no extension)'} as a source yet — PDF, HTML, text, and Markdown are supported.`,
  );
}

/** A plain-text / Markdown file as a thought:Document source. */
async function ingestTextDocument(
  rootPath: string,
  content: string,
  filename: string,
): Promise<IngestResult> {
  const { id: sourceId } = canonicalSourceId({}, content);
  const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
  const relativePath = `.minerva/sources/${sourceId}/meta.ttl`;
  const title = firstMarkdownHeading(content) ?? stripExt(filename);

  // Dedupe: same content → same id. Leave the existing Source untouched.
  try {
    await fs.access(path.join(sourceDir, 'meta.ttl'));
    return { sourceId, relativePath, duplicate: true, title, kind: 'text' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'body.md'), content.endsWith('\n') ? content : `${content}\n`, 'utf-8');
  await fs.writeFile(path.join(sourceDir, 'meta.ttl'), buildTextMetaTtl(title), 'utf-8');
  return { sourceId, relativePath, duplicate: false, title, kind: 'text' };
}

function buildTextMetaTtl(title: string): string {
  return [
    'this: a thought:Document ;',
    `    dc:title ${ttlString(title)} ;`,
    `    thought:accessedAt ${ttlString(new Date().toISOString())}^^xsd:dateTime .`,
    '',
  ].join('\n');
}

/** First `# H1` heading in a Markdown document, if any. */
function firstMarkdownHeading(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1]!;
    if (line.trim().length > 0) break; // stop at the first non-blank, non-heading line
  }
  return null;
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function ttlString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
