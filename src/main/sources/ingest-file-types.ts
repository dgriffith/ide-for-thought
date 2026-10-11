/**
 * The local-file ingestors' implementations (#2629): one per file type, each
 * turning a file into a Source under `.minerva/sources/<id>/`, deduped on a
 * content hash so the same file ingested twice collapses to one Source.
 * `ingestors.ts` registers them by extension; `ingest-file.ts`'s `ingestFile`
 * dispatches through that registry.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalSourceId } from './source-id';
import { ingestPdfBuffer } from './ingest-pdf';
import { ingestHtmlString, type IngestResult } from './ingest';

/** A PDF, through the PDF pipeline (text extraction + OCR fallback). */
export async function ingestPdfFile(rootPath: string, absPath: string): Promise<IngestResult> {
  const buf = await fs.readFile(absPath);
  const pdf = await ingestPdfBuffer(rootPath, buf, { originalFilename: path.basename(absPath) });
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

/** An HTML file, through the same Readability/structured extraction as URL
 *  ingest. No URL for a local file → content-hash id, no bibo:uri; the
 *  filename is the title fallback when the page has no <title>. */
export async function ingestHtmlFile(rootPath: string, absPath: string): Promise<IngestResult> {
  const html = await fs.readFile(absPath, 'utf-8');
  return ingestHtmlString(rootPath, html, { titleFallback: stripExt(path.basename(absPath)) });
}

/** A text or Markdown file, as a thought:Document whose body.md is the file. */
export async function ingestTextFile(rootPath: string, absPath: string): Promise<IngestResult> {
  const content = await fs.readFile(absPath, 'utf-8');
  return ingestTextDocument(rootPath, content, path.basename(absPath));
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
