/**
 * Local-file ingestion → Source (the "Ingest File as Source" command).
 *
 * Dispatches by file type through the ingestor registry (`ingestors.ts`,
 * #2629): PDF, HTML, text and Markdown, each implemented in
 * `ingest-file-types.ts`. Other types are rejected with a message naming what
 * is supported.
 */

import { ingestSource } from './ingestors';
import type { IngestResult } from './ingest';

export async function ingestFile(rootPath: string, absPath: string): Promise<IngestResult> {
  const outcome = await ingestSource(rootPath, { kind: 'file', path: absPath });
  const { route: _route, ...result } = outcome as IngestResult & { route: string };
  return result;
}
