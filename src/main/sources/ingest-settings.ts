/**
 * Per-machine ingest preferences (#473). Default-on: a fresh install
 * picks up CrossRef / arXiv / PubMed subject tags on identifier
 * ingest. Users who don't want that taxonomy in their tag panel can
 * toggle it off via Settings → Ingest.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

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
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<IngestSettings>;
    return {
      importUpstreamTags:
        typeof parsed.importUpstreamTags === 'boolean'
          ? parsed.importUpstreamTags
          : DEFAULT_INGEST_SETTINGS.importUpstreamTags,
    };
  } catch {
    return { ...DEFAULT_INGEST_SETTINGS };
  }
}

export async function saveIngestSettings(settings: IngestSettings): Promise<void> {
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}
