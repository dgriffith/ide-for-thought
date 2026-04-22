/**
 * Bulk import from a Zotero RDF export (#270 / tail of #98).
 *
 * Zotero's "Zotero RDF" export produces an `.rdf` (RDF/XML) file plus a
 * sibling `files/` directory that holds attached PDFs. This module parses
 * the RDF, maps every bibliographic item onto the shared `ArticleMetadata`
 * shape (same one the BibTeX + identifier-ingest pipelines use), writes
 * a `meta.ttl` under `.minerva/sources/<id>/`, and — when the item has a
 * linked PDF attachment that actually exists on disk — copies it in as
 * `original.pdf`.
 *
 * Canonical id and dedupe semantics match every other ingest path:
 * DOI > arXiv > ISBN > URL > content-hash fallback.
 *
 * The parser is deliberately lenient. Zotero's RDF dialect is under-
 * specified in the wild (different Zotero versions, BetterBibTeX plugins,
 * hand-edited exports); we extract what we can and fall through silently
 * on anything non-fatal rather than rejecting a whole 5000-entry library
 * over a missing predicate in one item.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import * as $rdf from 'rdflib';
import type { IndexedFormula, NamedNode, Node } from 'rdflib';
import { canonicalSourceId } from './source-id';
import { buildMetaTtl } from './ingest-identifier';
import type { ArticleMetadata } from './api-adapters/types';

// ── Namespaces ──────────────────────────────────────────────────────────────

const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  bib: 'http://purl.org/net/biblio#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  z: 'http://www.zotero.org/namespaces/export#',
  link: 'http://purl.org/rss/1.0/modules/link/',
  prism: 'http://prismstandard.org/namespaces/1.2/basic/',
};

function sym(iri: string): NamedNode {
  return $rdf.sym(iri) as NamedNode;
}

// Known bibliographic item classes. Anything else we see is ignored — a
// Zotero export also contains journal/publisher/person resources that we
// only dereference when a bib item points at them.
const BIB_CLASSES: Record<string, ArticleMetadata['subtype']> = {
  [`${NS.bib}Article`]: 'Article',
  [`${NS.bib}Book`]: 'Book',
  [`${NS.bib}BookSection`]: 'Book',
  [`${NS.bib}Thesis`]: 'Source',
  [`${NS.bib}Memo`]: 'Source',
  [`${NS.bib}Letter`]: 'Source',
  [`${NS.bib}Document`]: 'Source',
  [`${NS.bib}Report`]: 'Report',
  [`${NS.bib}Manuscript`]: 'Source',
};

// ── Public API ──────────────────────────────────────────────────────────────

export interface ZoteroImportProgress {
  done: number;
  total: number;
  currentTitle: string;
}

export interface ZoteroImportResult {
  imported: Array<{ sourceId: string; title: string; pdfAttached: boolean }>;
  duplicate: Array<{ sourceId: string; title: string }>;
  failed: Array<{ subject: string; reason: string }>;
  /** Count of bibliographic items the parser emitted. */
  totalItems: number;
}

export interface ZoteroImportOptions {
  onProgress?: (p: ZoteroImportProgress) => void;
}

export async function importZoteroRdf(
  rootPath: string,
  rdfAbsolutePath: string,
  options: ZoteroImportOptions = {},
): Promise<ZoteroImportResult> {
  const content = await fs.readFile(rdfAbsolutePath, 'utf-8');
  // Files are referenced relative to the .rdf's parent directory.
  const baseDir = path.dirname(rdfAbsolutePath);
  return importZoteroRdfContent(rootPath, content, baseDir, options);
}

/** Base URI we hand rdflib when parsing; relative attribute values resolve
 *  against this, and we strip it back off when recovering file paths. */
const PARSE_BASE = 'http://zotero.local/';

export async function importZoteroRdfContent(
  rootPath: string,
  rdfXml: string,
  attachmentBaseDir: string,
  options: ZoteroImportOptions = {},
): Promise<ZoteroImportResult> {
  const store = $rdf.graph();
  try {
    $rdf.parse(rdfXml, store, PARSE_BASE, 'application/rdf+xml');
  } catch (err) {
    throw new Error(`Zotero RDF parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const items = collectBibItems(store);
  const result: ZoteroImportResult = {
    imported: [],
    duplicate: [],
    failed: [],
    totalItems: items.length,
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let titleForProgress = item.value;
    try {
      const { metadata, attachmentRelPath } = extractItem(store, item);
      titleForProgress = metadata.title;

      const { id: sourceId } = canonicalSourceId(
        {
          doi: metadata.doi ?? undefined,
          arxiv: metadata.arxiv ?? undefined,
          pubmed: metadata.pubmed ?? undefined,
          isbn: metadata.isbn ?? undefined,
          url: metadata.uri ?? undefined,
        },
        // Hash fallback: the item's URI + its title gives a stable key
        // even for items Zotero exported without any identifier.
        `zotero:${item.value}:${metadata.title}`,
      );

      const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
      const metaPath = path.join(sourceDir, 'meta.ttl');

      try {
        await fs.access(metaPath);
        result.duplicate.push({ sourceId, title: metadata.title });
        continue;
      } catch { /* not found — proceed */ }

      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(metaPath, buildMetaTtl(metadata), 'utf-8');

      let pdfAttached = false;
      if (attachmentRelPath) {
        pdfAttached = await copyAttachmentIfPresent(
          attachmentBaseDir,
          attachmentRelPath,
          path.join(sourceDir, 'original.pdf'),
        );
      }
      result.imported.push({ sourceId, title: metadata.title, pdfAttached });
    } catch (err) {
      result.failed.push({
        subject: item.value,
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      options.onProgress?.({
        done: i + 1,
        total: items.length,
        currentTitle: titleForProgress,
      });
    }
  }

  return result;
}

// ── Item collection ─────────────────────────────────────────────────────────

function collectBibItems(store: IndexedFormula): NamedNode[] {
  const rdfType = sym(`${NS.rdf}type`);
  const seen = new Set<string>();
  const items: NamedNode[] = [];
  for (const classIri of Object.keys(BIB_CLASSES)) {
    const klass = sym(classIri);
    for (const st of store.statementsMatching(null, rdfType, klass)) {
      const subj = st.subject;
      if (subj.termType !== 'NamedNode' && subj.termType !== 'BlankNode') continue;
      if (seen.has(subj.value)) continue;
      seen.add(subj.value);
      items.push(subj as NamedNode);
    }
  }
  return items;
}

// ── Per-item extraction ─────────────────────────────────────────────────────

export interface ExtractedItem {
  metadata: ArticleMetadata;
  /** Relative path into the sibling `files/` directory; null if no PDF linked. */
  attachmentRelPath: string | null;
}

export function extractItem(store: IndexedFormula, subject: NamedNode): ExtractedItem {
  const subtype = subtypeOf(store, subject);
  const title = literalOf(store, subject, `${NS.dc}title`) ?? '(untitled)';
  const abstract = literalOf(store, subject, `${NS.dcterms}abstract`);
  const dateRaw = literalOf(store, subject, `${NS.dc}date`);
  const issued = normalizeIssuedDate(dateRaw);
  const creators = extractPersonList(store, subject, `${NS.bib}authors`);
  const publisher = extractPublisher(store, subject);
  const containerTitle = extractContainerTitle(store, subject);

  // Identifiers live in `dc:identifier` as prefix-tagged strings
  // ("DOI 10.1234/...", "ISBN 978-..."). A Zotero item commonly has
  // multiple dc:identifier values.
  const identifiers = literalsOf(store, subject, `${NS.dc}identifier`);
  const { doi, isbn, issn: _issn, url: urlFromIdentifier } = extractIdentifiers(identifiers);

  // The item's own URI — when it's an HTTP(S) URL NOT pointing at our
  // synthetic parse base — is a fine source URI. `http://zotero.local/#…`
  // URIs are just rdflib's relative-resolution artifact and shouldn't
  // drive the canonical id or land in meta.ttl.
  const uriFromSubject =
    subject.termType === 'NamedNode' &&
    /^https?:/i.test(subject.value) &&
    !subject.value.startsWith(PARSE_BASE)
      ? subject.value
      : null;

  const attachmentRelPath = extractAttachmentPath(store, subject);

  const metadata: ArticleMetadata = {
    subtype,
    title,
    creators,
    abstract: abstract ?? null,
    issued: issued ?? null,
    publisher: publisher ?? null,
    containerTitle: containerTitle ?? null,
    doi: doi ?? null,
    isbn: isbn ?? null,
    arxiv: null,
    pubmed: null,
    uri: urlFromIdentifier ?? uriFromSubject,
    pdfUrl: null,
    category: null,
  };

  return { metadata, attachmentRelPath };
}

function subtypeOf(store: IndexedFormula, subject: NamedNode): ArticleMetadata['subtype'] {
  const rdfType = sym(`${NS.rdf}type`);
  for (const st of store.statementsMatching(subject, rdfType, null)) {
    const mapped = BIB_CLASSES[st.object.value];
    if (mapped) return mapped;
  }
  return 'Source';
}

function literalOf(store: IndexedFormula, subject: Node, predicate: string): string | null {
  const st = store.statementsMatching(subject as NamedNode, sym(predicate), null)[0];
  if (!st) return null;
  const v = st.object.value;
  return v.trim().length > 0 ? v.trim() : null;
}

function literalsOf(store: IndexedFormula, subject: Node, predicate: string): string[] {
  return store
    .statementsMatching(subject as NamedNode, sym(predicate), null)
    .map((st) => st.object.value)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Resolve `bib:authors` (or `bib:editors`) into ordered "First Last"
 * strings. The predicate points at an `rdf:Seq` whose `rdf:_1`, `rdf:_2`,
 * … slots (or `rdf:li` in list-ish form) are `foaf:Person` nodes.
 */
function extractPersonList(
  store: IndexedFormula,
  subject: NamedNode,
  predicate: string,
): string[] {
  const container = store.statementsMatching(subject, sym(predicate), null)[0]?.object;
  if (!container) return [];
  const members = orderedContainerMembers(store, container as NamedNode);
  const names: string[] = [];
  for (const m of members) {
    const name = personName(store, m);
    if (name) names.push(name);
  }
  return names;
}

function orderedContainerMembers(store: IndexedFormula, container: NamedNode): NamedNode[] {
  // rdf:Seq with rdf:_1..rdf:_N predicates — read the triples and sort by
  // the numeric suffix so authors come out in authored order.
  const entries: Array<{ n: number; node: NamedNode }> = [];
  for (const st of store.statementsMatching(container, null, null)) {
    const m = st.predicate.value.match(/_(\d+)$/);
    if (!m) continue;
    if (st.object.termType !== 'NamedNode' && st.object.termType !== 'BlankNode') continue;
    entries.push({ n: parseInt(m[1], 10), node: st.object as NamedNode });
  }
  entries.sort((a, b) => a.n - b.n);
  return entries.map((e) => e.node);
}

function personName(store: IndexedFormula, person: NamedNode): string | null {
  const given = literalOf(store, person, `${NS.foaf}givenname`);
  const surname = literalOf(store, person, `${NS.foaf}surname`);
  if (given || surname) {
    return [given, surname].filter(Boolean).join(' ').trim();
  }
  // Some Zotero exports use `foaf:name` for institutional authors.
  return literalOf(store, person, `${NS.foaf}name`);
}

function extractPublisher(store: IndexedFormula, subject: NamedNode): string | null {
  // dc:publisher points at a foaf:Organization with foaf:name, or a literal.
  const st = store.statementsMatching(subject, sym(`${NS.dc}publisher`), null)[0];
  if (!st) return null;
  if (st.object.termType === 'Literal') {
    return st.object.value.trim() || null;
  }
  if (st.object.termType !== 'NamedNode' && st.object.termType !== 'BlankNode') return null;
  return literalOf(store, st.object as NamedNode, `${NS.foaf}name`);
}

function extractContainerTitle(store: IndexedFormula, subject: NamedNode): string | null {
  // dcterms:isPartOf → a bib:Journal / bib:Book with dc:title.
  const st = store.statementsMatching(subject, sym(`${NS.dcterms}isPartOf`), null)[0];
  if (!st) return null;
  if (st.object.termType === 'Literal') return st.object.value.trim() || null;
  if (st.object.termType !== 'NamedNode' && st.object.termType !== 'BlankNode') return null;
  return literalOf(store, st.object as NamedNode, `${NS.dc}title`);
}

export function extractIdentifiers(identifiers: string[]): {
  doi: string | null;
  isbn: string | null;
  issn: string | null;
  url: string | null;
} {
  let doi: string | null = null;
  let isbn: string | null = null;
  let issn: string | null = null;
  let url: string | null = null;
  for (const raw of identifiers) {
    const s = raw.trim();
    let m: RegExpMatchArray | null;
    // Order matters: doi.org URLs masquerade as plain http URLs, so they
    // get the DOI lane before the general URL lane picks them up.
    if ((m = s.match(/^\s*DOI[\s:]+(.+)$/i))) doi = normalizeDoiLiteral(m[1]);
    else if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(s)) doi = normalizeDoiLiteral(s);
    else if ((m = s.match(/^\s*ISBN[\s:]+(.+)$/i))) isbn = m[1].replace(/[\s-]/g, '');
    else if ((m = s.match(/^\s*ISSN[\s:]+(.+)$/i))) issn = m[1].replace(/\s/g, '');
    else if (/^https?:\/\//i.test(s)) url = s;
    else if (/^10\.\d+\//.test(s)) doi = normalizeDoiLiteral(s);
  }
  return { doi, isbn, issn, url };
}

function normalizeDoiLiteral(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
}

export function normalizeIssuedDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Already ISO-shaped: YYYY, YYYY-MM, YYYY-MM-DD — passed through.
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(trimmed)) return trimmed;
  // Zotero often stores "October 15, 2024" or "2024-10-15".
  const m = trimmed.match(/(\d{4})/);
  return m ? m[1] : null;
}

// ── Attachments ─────────────────────────────────────────────────────────────

/**
 * Walk `link:link` from the item to find an attachment, then pull the
 * local file path out of the attachment node. Zotero's RDF puts the path
 * in a quirky `<rdf:resource rdf:resource="files/…"/>` element (the
 * attachment → file path predicate is `rdf:resource`), and some exports
 * put it on the attachment's own `rdf:about` URI.
 */
export function extractAttachmentPath(store: IndexedFormula, subject: NamedNode): string | null {
  for (const linkSt of store.statementsMatching(subject, sym(`${NS.link}link`), null)) {
    const attachment = linkSt.object;
    if (attachment.termType !== 'NamedNode' && attachment.termType !== 'BlankNode') continue;

    // Only consider PDF-typed attachments when the export tagged them.
    const linkType = literalOf(store, attachment, `${NS.link}type`);
    if (linkType && !linkType.toLowerCase().includes('pdf')) continue;

    // Preferred: the attachment has a `rdf:resource` predicate (note: this
    // is Zotero's quirk of treating it as a predicate rather than an
    // attribute; rdflib reifies it into a triple).
    const pathFromResource = literalOf(store, attachment, `${NS.rdf}resource`);
    if (pathFromResource) return relativeifyPath(pathFromResource);

    // Fallback: when the attachment's own URI looks like a file path.
    if (attachment.termType === 'NamedNode' && /^files\//.test(attachment.value)) {
      return relativeifyPath(attachment.value);
    }
  }
  return null;
}

function relativeifyPath(raw: string): string | null {
  // rdflib resolves `rdf:resource` attributes against the parse base URI,
  // so a raw `files/1/foo.pdf` comes back as `http://zotero.local/files/1/foo.pdf`.
  // Strip the base back off before treating it as a filesystem path.
  let stripped = raw.startsWith(PARSE_BASE) ? raw.slice(PARSE_BASE.length) : raw;
  stripped = stripped.replace(/^file:\/\//, '').replace(/^\/+/, '');
  // Reject absolute paths and anything with `..` — they could escape the
  // attachment base dir, and Zotero's own export always uses `files/…`.
  if (path.isAbsolute(stripped)) return null;
  if (stripped.split('/').includes('..')) return null;
  return stripped;
}

async function copyAttachmentIfPresent(
  baseDir: string,
  relativePath: string,
  destAbsolute: string,
): Promise<boolean> {
  const src = path.join(baseDir, relativePath);
  try {
    await fs.access(src);
  } catch {
    // File advertised but not on disk — common when a user ships only the
    // .rdf without the `files/` tree. Silent skip; the meta.ttl still
    // records the source.
    return false;
  }
  try {
    await fs.copyFile(src, destAbsolute);
    return true;
  } catch {
    return false;
  }
}
