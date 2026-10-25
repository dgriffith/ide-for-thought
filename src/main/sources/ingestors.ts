/**
 * Every way a Source comes in (#2629, epic #2622): ONE registry, and ONE path
 * that dispatches by it — `ingestSource`.
 *
 * Ingestion used to be spread across `ingest-file.ts`'s extension checks,
 * `ingest-identifier.ts`'s `IdentifierKind` union and switch, and
 * `ingest-smart.ts`'s routing; the Ingest File dialog kept its own copy of the
 * extension list. Now each ingestor registers what it accepts — file
 * extensions, an identifier kind, or a web URL — and how it ingests, and the
 * entry points (`ingestFile`, `ingestSmart`) are thin wrappers over
 * `ingestSource`. The dedicated BibTeX and Zotero RDF imports produce many
 * Sources from one file and keep their own channels.
 *
 * Built-ins register here. A plugin's ingestors (#2647) join through
 * `setExtraIngestors`, which the composition root wires (`sources/` doesn't
 * import `plugins/`); a built-in keeps any extension it takes.
 */
import path from 'node:path';
import { ingestUrl, type IngestResult } from './ingest';
import { ingestIdentifier, type IdentifierIngestResult } from './ingest-identifier';
import { IDENTIFIER_KINDS, type IdentifierKind } from './identifier-kinds';
import { ingestHtmlFile, ingestPdfFile, ingestTextFile } from './ingest-file-types';
import { BUILTIN_SOURCE_FILE_EXTENSIONS as EXT } from '../../shared/source-file-types';

export interface IngestOptions {
  fetchImpl?: typeof fetch;
  /** When false, upstream subject tags are dropped (the per-machine IngestSettings toggle, #473). */
  importUpstreamTags?: boolean;
}

/** What a Source is ingested from. */
export type IngestInput =
  /** A local file, by absolute path. */
  | { kind: 'file'; path: string }
  /** Pasted or typed text: an identifier, a URL, or prose with a DOI in it. */
  | { kind: 'text'; text: string };

/** What an ingest made, and which kind of ingestor made it. */
export type IngestOutcome =
  | (IdentifierIngestResult & { route: 'identifier' })
  | (IngestResult & { route: 'url' })
  | (IngestResult & { route: 'file' });

export type IngestorAccepts =
  /** Local files with one of these extensions (lowercase, with the dot). */
  | { extensions: readonly string[] }
  /** A bibliographic identifier of this kind (`identifier-kinds.ts`). */
  | { identifier: IdentifierKind }
  /** An http(s) URL. */
  | { url: true };

export interface Ingestor {
  id: string;
  /** What it takes, for messages and the file dialog ("PDF", "DOI", "URL"). */
  label: string;
  accepts: IngestorAccepts;
  /** Ingest `input` (a path, a normalised-or-raw identifier, or a URL). */
  ingest: (rootPath: string, input: string, opts: IngestOptions) => Promise<IngestOutcome>;
}

const asFile = (r: Promise<IngestResult>) => r.then((x) => ({ ...x, route: 'file' as const }));

export const INGESTORS: readonly Ingestor[] = [
  { id: 'pdf', label: 'PDF', accepts: { extensions: EXT.pdf }, ingest: (root, p) => asFile(ingestPdfFile(root, p)) },
  { id: 'html-file', label: 'HTML', accepts: { extensions: EXT.html }, ingest: (root, p) => asFile(ingestHtmlFile(root, p)) },
  { id: 'text-file', label: 'text', accepts: { extensions: EXT.text }, ingest: (root, p) => asFile(ingestTextFile(root, p)) },
  { id: 'markdown-file', label: 'Markdown', accepts: { extensions: EXT.markdown }, ingest: (root, p) => asFile(ingestTextFile(root, p)) },
  // One per identifier kind, in detection order (DOI, arXiv, PubMed).
  ...IDENTIFIER_KINDS.map((k): Ingestor => ({
    id: k.kind,
    label: k.label,
    accepts: { identifier: k.kind },
    ingest: async (root, raw, opts) => ({ ...(await ingestIdentifier(root, raw, opts)), route: 'identifier' }),
  })),
  // A web page: Readability plus the per-site structured handlers (`site-handlers.ts`).
  { id: 'web', label: 'URL', accepts: { url: true }, ingest: async (root, url, opts) => ({ ...(await ingestUrl(root, url, opts)), route: 'url' }) },
];

let extraIngestors: () => readonly Ingestor[] = () => [];

/** Ingestors from outside the source — plugins' (#2647) — asked for on every ingest, so a plugin turned off is gone at once. */
export function setExtraIngestors(provider: (() => readonly Ingestor[]) | null): void {
  extraIngestors = provider ?? (() => []);
}

function allIngestors(): readonly Ingestor[] {
  const builtIn = new Set(INGESTORS.flatMap((i) => ('extensions' in i.accepts ? i.accepts.extensions : [])));
  const extra = extraIngestors().filter((i) => !('extensions' in i.accepts) || i.accepts.extensions.every((e) => !builtIn.has(e)));
  return [...INGESTORS, ...extra];
}

const fileIngestors = () => allIngestors().filter((i): i is Ingestor & { accepts: { extensions: readonly string[] } } => 'extensions' in i.accepts);
const identifierIngestors = () => INGESTORS.filter((i): i is Ingestor & { accepts: { identifier: IdentifierKind } } => 'identifier' in i.accepts);
const urlIngestor = () => INGESTORS.find((i) => 'url' in i.accepts);

/** Every file extension a Source can be ingested from, without the dot — the
 *  Ingest File dialog's filter. */
export function ingestibleFileExtensions(): string[] {
  return fileIngestors().flatMap((i) => i.accepts.extensions.map((e) => e.replace(/^\./, '')));
}

/** "a, b, c, or d" / "a, b, c, and d". */
function oxfordList(items: string[], conj: 'and' | 'or'): string {
  return items.length <= 2 ? items.join(` ${conj} `) : `${items.slice(0, -1).join(', ')}, ${conj} ${items.at(-1)}`;
}

/** The one ingest path: pick the ingestor for `input` and run it. */
export async function ingestSource(rootPath: string, input: IngestInput, opts: IngestOptions = {}): Promise<IngestOutcome> {
  if (input.kind === 'file') {
    const ext = path.extname(input.path).toLowerCase();
    const ingestor = fileIngestors().find((i) => i.accepts.extensions.includes(ext));
    if (!ingestor) {
      const supported = oxfordList(fileIngestors().map((i) => i.label), 'and');
      throw new Error(`Can't ingest *${ext || ' (no extension)'} as a source yet — ${supported} are supported.`);
    }
    return ingestor.ingest(rootPath, input.path, opts);
  }

  const text = input.text.trim();
  if (!text) throw new Error('Empty input.');

  // 1. The whole string is an identifier (a DOI URL counts — `normalizeDoi`
  //    strips the resolver) — prefer that over a page fetch. An arXiv or
  //    PubMed page URL isn't one; the web ingestor's site handlers read it.
  for (const ingestor of identifierIngestors()) {
    const kind = IDENTIFIER_KINDS.find((k) => k.kind === ingestor.accepts.identifier)!;
    if (kind.normalize(text)) return ingestor.ingest(rootPath, text, opts);
  }

  // 2. A URL — the web-page ingestor.
  const web = urlIngestor();
  if (web && /^https?:\/\//i.test(text)) return web.ingest(rootPath, text, opts);

  // 3. Prose with an identifier in it ("see 10.1145/foo for context").
  for (const ingestor of identifierIngestors()) {
    const kind = IDENTIFIER_KINDS.find((k) => k.kind === ingestor.accepts.identifier)!;
    const found = 'findInText' in kind ? kind.findInText(text) : null;
    if (found) return ingestor.ingest(rootPath, found, opts);
  }

  const recognised = oxfordList([...(web ? [web.label] : []), ...identifierIngestors().map((i) => i.label)], 'or');
  throw new Error(`Not a recognised ${recognised}: ${input.text}`);
}
