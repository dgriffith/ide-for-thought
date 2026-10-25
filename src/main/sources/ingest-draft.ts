/**
 * A Source from a draft someone else wrote (#2647): a plugin ingestor's
 * parser hands back metadata and a body, and this writes the Source the way
 * the built-in ingestors do — `.minerva/sources/<id>/meta.ttl` + `body.md`,
 * deduped on a hash of the file it came from.
 *
 * The draft has already been checked for shape (`main/plugin-ingestors.ts`);
 * what's left here is treating its text as untrusted: every `<` in the body
 * is escaped, so it renders as text and never as HTML (#2558), and every
 * literal goes through the Turtle escaper.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalSourceId } from './source-id';
import type { IngestResult } from './ingest';
import type { PluginSourceDraft } from '../../shared/plugins/format';

/** Where a draft's Source goes, and whether it is there already. */
export interface DraftSourceSlot {
  sourceId: string;
  relativePath: string;
  /** The title on file when it already exists; null when it doesn't. */
  existingTitle: string | null;
}

/**
 * The slot for a file whose content hashes to `seed`: asked before the parser
 * runs, so a file ingested twice never reaches the plugin the second time.
 */
export async function draftSourceSlot(rootPath: string, seed: string): Promise<DraftSourceSlot> {
  const { id: sourceId } = canonicalSourceId({}, seed);
  const relativePath = `.minerva/sources/${sourceId}/meta.ttl`;
  try {
    const ttl = await fs.readFile(path.join(rootPath, relativePath), 'utf-8');
    const m = ttl.match(/dc:title\s+"((?:[^"\\]|\\.)*)"/);
    return { sourceId, relativePath, existingTitle: m ? m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return { sourceId, relativePath, existingTitle: null };
  }
}

/** Write `draft` as the Source in `slot`. `ingestedBy` is the provenance, `plugin:<id>@<version>`. */
export async function writeDraftSource(
  rootPath: string,
  slot: DraftSourceSlot,
  draft: PluginSourceDraft,
  opts: { filename: string; ingestedBy: string },
): Promise<IngestResult> {
  const sourceDir = path.join(rootPath, '.minerva', 'sources', slot.sourceId);
  await fs.mkdir(sourceDir, { recursive: true });
  const body = draft.body.replace(/</g, '\\<');
  await fs.writeFile(path.join(sourceDir, 'body.md'), body.endsWith('\n') ? body : `${body}\n`, 'utf-8');
  await fs.writeFile(path.join(sourceDir, 'meta.ttl'), buildDraftMetaTtl(draft, opts), 'utf-8');
  return { sourceId: slot.sourceId, relativePath: slot.relativePath, duplicate: false, title: draft.title, kind: 'text' };
}

export function buildDraftMetaTtl(draft: PluginSourceDraft, opts: { filename: string; ingestedBy: string }): string {
  const lines = [
    `this: a thought:${draft.type ?? 'Document'} ;`,
    `    dc:title ${ttlString(draft.title)} ;`,
  ];
  for (const creator of draft.creators ?? []) lines.push(`    dc:creator ${ttlString(creator)} ;`);
  if (draft.issued) {
    const datatype = /^\d{4}$/.test(draft.issued) ? 'xsd:gYear' : /^\d{4}-\d{2}$/.test(draft.issued) ? 'xsd:gYearMonth' : 'xsd:date';
    lines.push(`    dc:issued ${ttlString(draft.issued)}^^${datatype} ;`);
  }
  if (draft.publisher) lines.push(`    dc:publisher ${ttlString(draft.publisher)} ;`);
  if (draft.abstract) lines.push(`    dc:abstract ${ttlString(draft.abstract)} ;`);
  if (draft.uri) lines.push(`    bibo:uri ${ttlString(draft.uri)} ;`);
  if (draft.language) lines.push(`    dc:language ${ttlString(draft.language)} ;`);
  lines.push(`    minerva:originalFilename ${ttlString(opts.filename)} ;`);
  lines.push(`    minerva:ingestedBy ${ttlString(opts.ingestedBy)} ;`);
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
