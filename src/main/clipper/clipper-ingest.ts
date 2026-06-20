/**
 * The clipper's extraction wiring (#222 → #790).
 *
 * Maps a clipper payload onto the existing Source pipeline:
 *   - `ingestHtmlString` runs Readability + site-handlers + Turndown over the
 *     browser-supplied HTML (no refetch — that's the whole point), writing the
 *     Source the same way "Ingest URL…" does;
 *   - a non-empty `selection` is filed as a `thought:Excerpt` linked to the
 *     new source, via `createExcerpt` (idempotent on the source + quote text);
 *   - popup `tags` are applied as user `minerva:tag`s, and a popup `note` is
 *     filed as a Zotero-style about-note (#793).
 *
 * Offset-accurate excerpt anchoring (mapping the selection into body.md) is a
 * separate concern — see #794. v1 stores the quote text only.
 */

import { ingestHtmlString } from '../sources/ingest';
import { createExcerpt } from '../sources/create-excerpt';
import { createAboutNote } from '../sources/about-note';
import { addSourceTag } from '../sources/source-meta-write';
import { getIngestSettings } from '../sources/ingest-settings';
import type { ClipperPayload, ClipperIngestOutcome } from './clipper-server';

export async function clipperIngest(
  payload: ClipperPayload,
  rootPath: string,
): Promise<ClipperIngestOutcome> {
  // Honour the same upstream-tags preference as the menu-driven ingest (#473).
  const settings = await getIngestSettings();

  const result = await ingestHtmlString(rootPath, payload.html, {
    url: payload.url,
    titleFallback: payload.pageTitle,
    importUpstreamTags: settings.importUpstreamTags,
  });

  const outcome: ClipperIngestOutcome = {
    sourceId: result.sourceId,
    relativePath: result.relativePath,
    duplicate: result.duplicate,
    title: result.title,
    kind: result.kind,
  };

  const selection = payload.selection?.trim();
  if (selection) {
    const excerpt = await createExcerpt(rootPath, {
      sourceId: result.sourceId,
      citedText: selection,
    });
    outcome.excerptId = excerpt.excerptId;
    outcome.excerptDuplicate = excerpt.duplicate;
  }

  // Popup tags (#793): apply each as a user tag. addSourceTag is idempotent and
  // reindexes; collect the ones that were newly added for the response.
  const applied: string[] = [];
  for (const raw of payload.tags ?? []) {
    const tag = raw.trim();
    if (!tag) continue;
    if (await addSourceTag(rootPath, result.sourceId, tag)) applied.push(tag);
  }
  if (applied.length) outcome.tags = applied;

  // Popup note (#793): file a Zotero-style about-note linked to the source.
  const note = payload.note?.trim();
  if (note) {
    const { relativePath } = await createAboutNote(rootPath, {
      sourceId: result.sourceId,
      title: `Note on ${result.title || result.sourceId}`,
      body: note,
    });
    outcome.notePath = relativePath;
  }

  return outcome;
}
