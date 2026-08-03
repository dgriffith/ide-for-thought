/**
 * Per-machine ingest preferences (#473). Default-on: a fresh install
 * picks up CrossRef / arXiv / PubMed subject tags on identifier
 * ingest. Users who don't want that taxonomy in their tag panel can
 * toggle it off via Settings → Ingest.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfigFile, asBool, asRecord, stampConfigVersion } from '../config/config-store';

/** Schema version persisted in `configVersion` (#1641). */
const INGEST_SETTINGS_VERSION = 1;

export interface IngestSettings {
  /** When true, the identifier-ingest adapters extract upstream
   *  subject tags (CrossRef.subject / arXiv categories / MeSH terms)
   *  and apply them as `crossref/...` / `arxiv/...` / `mesh/...`
   *  tags on the source. */
  importUpstreamTags: boolean;
}

export const DEFAULT_INGEST_SETTINGS: IngestSettings = {
  importUpstreamTags: true,
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'ingest-settings.json');
}

export async function getIngestSettings(): Promise<IngestSettings> {
  return loadConfigFile(settingsPath, (raw) => {
    const o = asRecord(raw);
    return {
      importUpstreamTags: asBool(o.importUpstreamTags, DEFAULT_INGEST_SETTINGS.importUpstreamTags),
    };
  }, DEFAULT_INGEST_SETTINGS, { version: INGEST_SETTINGS_VERSION });
}

export async function saveIngestSettings(settings: IngestSettings): Promise<void> {
  await fs.writeFile(
    settingsPath(),
    JSON.stringify(stampConfigVersion(settings, INGEST_SETTINGS_VERSION), null, 2),
    'utf-8',
  );
}
