/**
 * "Cite What You Said" (#112) — promote an ephemeral conversation citation
 * into a real `thought:cites` edge on the note that anchors the conversation.
 *
 * The graph models a citation as a `[[cite::<sourceId>]]` marker in the note's
 * text (scanned by `scan-citations.ts` and indexed as `thought:cites`). So the
 * mechanical job is: ingest the cited URL as a Source (if it isn't one yet),
 * then weave its marker into the note. These two pure helpers do the text-only
 * half — the IPC (ingest, read/write, reindex) lives in the panel.
 */

const BIBLIOGRAPHY_OPEN = '<!-- minerva:bibliography -->';

/** Marker for a source id, matching the editor's `[[cite::id]]` syntax. */
export function citationMarker(sourceId: string): string {
  return `[[cite::${sourceId}]]`;
}

/**
 * Insert a `[[cite::sourceId]]` marker into a note's content. Idempotent — if
 * the note already cites that source the content is returned unchanged, so
 * citing the same footnote twice never spawns a duplicate edge.
 *
 * Placement: just before a rendered bibliography block if one exists (so the
 * marker is scanned and the next "Render References" run folds it into the
 * list rather than orphaning it after the close marker), otherwise appended at
 * end of document.
 */
export function insertCitationMarker(content: string, sourceId: string): string {
  const marker = citationMarker(sourceId);
  if (content.includes(marker)) return content;

  const bibAt = content.indexOf(BIBLIOGRAPHY_OPEN);
  if (bibAt !== -1) {
    const before = content.slice(0, bibAt).replace(/\s+$/, '');
    const after = content.slice(bibAt);
    return `${before}\n\n${marker}\n\n${after}`;
  }

  const trimmed = content.replace(/\s+$/, '');
  return trimmed.length > 0 ? `${trimmed}\n\n${marker}\n` : `${marker}\n`;
}

/** Display name for a note path — basename with a trailing `.md` stripped. */
export function noteBasename(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? relativePath;
  return base.replace(/\.md$/i, '');
}
