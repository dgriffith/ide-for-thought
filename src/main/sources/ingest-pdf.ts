/**
 * PDF ingestion (#94).
 *
 * Read a local PDF, extract its text layer page-by-page, pull a first pass
 * of metadata out of the /Info dict, and persist under `.minerva/sources/<id>/`
 * as:
 *   - `original.pdf` — the raw PDF bytes
 *   - `body.md`     — markdown with the title + `<!-- page N -->` markers
 *   - `meta.ttl`    — a thought:PDFSource with whatever the /Info dict gave us
 *
 * Scanned PDFs (no text layer) are out of scope here — they fall through
 * to the OCR path (#95). Encrypted PDFs are rejected with a clean error.
 *
 * Source id: content-hash of the PDF bytes. PDFs rarely embed a DOI that
 * our canonical-id layer can key on directly, so we take the hash path
 * and let the user merge-by-hand if the same paper also arrives via a
 * DOI/arXiv route (#96).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { extractText, getMeta } from 'unpdf';
import { canonicalSourceId } from './source-id';

export interface PdfIngestResult {
  sourceId: string;
  relativePath: string;
  /** True when the source already existed; no files were overwritten. */
  duplicate: boolean;
  title: string;
  pageCount: number;
  /**
   * True when the PDF had no text layer. original.pdf + meta.ttl are
   * persisted; body.md is empty. The renderer is expected to confirm
   * with the user, run OCR on the pages, and call finishPdfOcrIngest
   * (#95) to fill in body.md + stamp thought:extractionMethod "ocr".
   */
  needsOcr: boolean;
}

export async function ingestPdf(
  rootPath: string,
  pdfAbsolutePath: string,
): Promise<PdfIngestResult> {
  const buf = await fs.readFile(pdfAbsolutePath);
  // pdfjs transfers the underlying ArrayBuffer when we hand it a Uint8Array,
  // so every pdfjs call needs a fresh copy and we compute the content hash
  // up front from the untouched Node Buffer.
  const contentSeed = buf.toString('base64');
  const { id: sourceId } = canonicalSourceId({}, contentSeed);
  const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
  const relativePath = `.minerva/sources/${sourceId}/meta.ttl`;

  const meta = await readPdfMeta(freshCopy(buf));

  // Dedupe on the destination meta.ttl — matches the URL / identifier flows.
  try {
    await fs.access(path.join(sourceDir, 'meta.ttl'));
    return {
      sourceId,
      relativePath,
      duplicate: true,
      title: meta.title ?? path.basename(pdfAbsolutePath),
      pageCount: 0,
      needsOcr: false,
    };
  } catch { /* not found — proceed */ }

  const { pages, totalPages } = await extractTextOrFail(freshCopy(buf));
  const needsOcr = pages.every((p) => p.trim().length === 0) && totalPages > 0;

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'original.pdf'), buf);
  const title = meta.title ?? path.basename(pdfAbsolutePath);
  await fs.writeFile(
    path.join(sourceDir, 'body.md'),
    needsOcr
      ? `# ${title}\n\n<!-- OCR pending: this PDF has no text layer. -->\n`
      : buildBodyMarkdown(title, pages),
    'utf-8',
  );
  await fs.writeFile(
    path.join(sourceDir, 'meta.ttl'),
    buildMetaTtl(meta, {
      originalFilename: path.basename(pdfAbsolutePath),
      pageCount: totalPages,
      extractionMethod: needsOcr ? null : 'text-layer',
    }),
    'utf-8',
  );

  return {
    sourceId,
    relativePath,
    duplicate: false,
    title,
    pageCount: totalPages,
    needsOcr,
  };
}

/**
 * Final step of the OCR ingest flow (#95). The renderer has run
 * Tesseract.js on the pre-persisted original.pdf and hands us back one
 * string per page. We rewrite body.md with the real text and rewrite
 * meta.ttl to stamp the source with \`thought:extractionMethod "ocr"\`
 * for provenance.
 */
export async function finishPdfOcrIngest(
  rootPath: string,
  sourceId: string,
  pages: string[],
): Promise<void> {
  const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
  const originalPdf = path.join(sourceDir, 'original.pdf');
  const buf = await fs.readFile(originalPdf);
  const meta = await readPdfMeta(freshCopy(buf));
  const title = meta.title ?? sourceId;
  await fs.writeFile(
    path.join(sourceDir, 'body.md'),
    buildBodyMarkdown(title, pages),
    'utf-8',
  );
  await fs.writeFile(
    path.join(sourceDir, 'meta.ttl'),
    buildMetaTtl(meta, {
      originalFilename: sourceId,
      pageCount: pages.length,
      extractionMethod: 'ocr',
    }),
    'utf-8',
  );
}

/** Read bytes of a previously-persisted original.pdf — used by the OCR flow (#95). */
export async function readOriginalPdf(rootPath: string, sourceId: string): Promise<Uint8Array> {
  const p = path.join(rootPath, '.minerva', 'sources', sourceId, 'original.pdf');
  const buf = await fs.readFile(p);
  return new Uint8Array(buf);
}

/**
 * Copy a Node Buffer into a fresh standalone Uint8Array. pdfjs transfers
 * (detaches) the underlying ArrayBuffer of whatever we pass it, so every
 * pdfjs call needs an independent copy — sharing one would zero out our
 * cached bytes between calls.
 */
function freshCopy(buf: Buffer): Uint8Array {
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}

// ── PDF parsing ─────────────────────────────────────────────────────────────

export interface PdfMeta {
  title: string | null;
  creators: string[];
  subject: string | null;
  keywords: string | null;
  creationDate: string | null;
  doi: string | null;
}

/**
 * Pull the first-pass metadata out of the /Info dict. Rejects encrypted PDFs
 * here so the caller gets a clean error before we attempt text extraction
 * (which would throw an opaque pdfjs message).
 */
export async function readPdfMeta(bytes: Uint8Array): Promise<PdfMeta> {
  const { info } = await getMeta(bytes);
  const rec = info;

  if (rec.EncryptFilterName != null) {
    throw new Error('This PDF is encrypted. Remove the password protection first, then try again.');
  }

  const titleRaw = typeof rec.Title === 'string' ? rec.Title.trim() : '';
  const authorRaw = typeof rec.Author === 'string' ? rec.Author.trim() : '';
  const subjectRaw = typeof rec.Subject === 'string' ? rec.Subject.trim() : '';
  const keywordsRaw = typeof rec.Keywords === 'string' ? rec.Keywords.trim() : '';
  const createdRaw = typeof rec.CreationDate === 'string' ? rec.CreationDate.trim() : '';

  // PDFs commonly pack multi-author bylines into a single Author string.
  // `;` is the de-facto separator (arXiv uses it); fall back to `,` where
  // there's no semicolon but clearly more than one human name.
  const creators = splitAuthors(authorRaw);

  // DOI sometimes shows up in the Custom dictionary — arXiv and a few
  // publishers populate it; cross-reference it into meta.ttl when present.
  const custom = (rec.Custom as Record<string, unknown> | undefined) ?? undefined;
  const doi = typeof custom?.DOI === 'string' ? normalizeEmbeddedDoi(custom.DOI) : null;

  return {
    title: titleRaw || null,
    creators,
    subject: subjectRaw || null,
    keywords: keywordsRaw || null,
    creationDate: parsePdfDate(createdRaw),
    doi,
  };
}

function splitAuthors(raw: string): string[] {
  if (!raw) return [];
  const byS = raw.split(';').map((s) => s.trim()).filter(Boolean);
  if (byS.length > 1) return byS;
  // A single-string Author that clearly contains multiple commas — e.g.
  // "Sun, Yang, Ji, Zhiyuan" — isn't split further here; the comma can
  // also be a "Last, First" separator for a single author, so we'd false-
  // positive. User can edit meta.ttl.
  return raw ? [raw] : [];
}

/**
 * PDF dates are formatted like `D:20241015123045+00'00'`. Extract the
 * `YYYY-MM-DD` prefix so meta.ttl gets a usable xsd:date; anything we
 * can't parse returns null and the field is omitted.
 */
export function parsePdfDate(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/^D?:?(\d{4})(\d{2})?(\d{2})?/);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (y && mo && d) return `${y}-${mo}-${d}`;
  if (y && mo) return `${y}-${mo}`;
  if (y) return y;
  return null;
}

function normalizeEmbeddedDoi(raw: string): string | null {
  const trimmed = raw.trim();
  // Accept both the bare DOI and the https://doi.org/ URL form.
  const stripped = trimmed
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  return /^10\.\d+\/.+/.test(stripped) ? stripped.toLowerCase() : null;
}

async function extractTextOrFail(
  bytes: Uint8Array,
): Promise<{ pages: string[]; totalPages: number }> {
  try {
    const { text, totalPages } = await extractText(bytes);
    const pages = Array.isArray(text) ? text : [text];
    return { pages, totalPages };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // pdfjs throws a generic "No password given" for encrypted PDFs it
    // couldn't classify earlier. Translate for clarity.
    if (/password/i.test(msg) || /encrypt/i.test(msg)) {
      throw new Error('This PDF is encrypted. Remove the password protection first, then try again.', { cause: err });
    }
    throw new Error(`PDF text extraction failed: ${msg}`, { cause: err });
  }
}

// ── Markdown body ───────────────────────────────────────────────────────────

export function buildBodyMarkdown(title: string, pages: string[]): string {
  const parts: string[] = [`# ${title}`, ''];
  for (let i = 0; i < pages.length; i++) {
    parts.push(`<!-- page ${i + 1} -->`);
    parts.push('');
    // Trim trailing whitespace per page but preserve internal layout —
    // pdfjs text extraction is already the best we can do without the
    // position info. Users clean up post-ingest if they want prose.
    parts.push(pages[i].trimEnd());
    parts.push('');
  }
  return parts.join('\n');
}

// ── Turtle meta ─────────────────────────────────────────────────────────────

export function buildMetaTtl(
  meta: PdfMeta,
  extras: {
    originalFilename: string;
    pageCount: number;
    /**
     * "text-layer" when pdfjs pulled real text, "ocr" when the renderer
     * Tesseract'd the pages. Null when ingest isn't yet complete (a
     * scanned PDF waiting for the user's OCR confirmation).
     */
    extractionMethod: 'text-layer' | 'ocr' | null;
  },
): string {
  const lines: string[] = [
    'this: a thought:PDFSource ;',
  ];
  if (meta.title) lines.push(`    dc:title ${ttlString(meta.title)} ;`);
  for (const c of meta.creators) lines.push(`    dc:creator ${ttlString(c)} ;`);
  if (meta.creationDate) {
    const iso = meta.creationDate;
    if (/^\d{4}$/.test(iso)) lines.push(`    dc:issued ${ttlString(iso)}^^xsd:gYear ;`);
    else if (/^\d{4}-\d{2}$/.test(iso)) lines.push(`    dc:issued ${ttlString(iso)}^^xsd:gYearMonth ;`);
    else lines.push(`    dc:issued ${ttlString(iso)}^^xsd:date ;`);
  }
  if (meta.subject) lines.push(`    dc:description ${ttlString(meta.subject)} ;`);
  if (meta.keywords) lines.push(`    dc:subject ${ttlString(meta.keywords)} ;`);
  if (meta.doi) lines.push(`    bibo:doi ${ttlString(meta.doi)} ;`);
  lines.push(`    minerva:originalFilename ${ttlString(extras.originalFilename)} ;`);
  lines.push(`    dc:extent ${ttlString(`${extras.pageCount} pages`)} ;`);
  if (extras.extractionMethod) {
    lines.push(`    thought:extractionMethod ${ttlString(extras.extractionMethod)} ;`);
  }
  lines.push(`    thought:accessedAt ${ttlString(new Date().toISOString())}^^xsd:dateTime .`);
  return lines.join('\n') + '\n';
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
