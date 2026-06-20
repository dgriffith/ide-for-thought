/**
 * Create a Zotero-style "about" note for a source (#474, used by the clipper
 * #793). A note is a plain markdown file with `about: [[sources/<id>]]`
 * frontmatter — the indexer materialises that into a `dc:subject` edge so the
 * note surfaces under the source's Notes section. This is the same shape the
 * renderer's "New note about this source" produces; factored into main so the
 * clipper's loopback ingest can file one without the renderer.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface AboutNoteParams {
  sourceId: string;
  /** Note title → the `# heading` and the basis for the filename. */
  title: string;
  /** Markdown body beneath the heading. */
  body: string;
}

export interface AboutNoteResult {
  /** Project-relative path of the note that was written. */
  relativePath: string;
}

/**
 * Write a new about-note at the project root, picking a filename from the title
 * and disambiguating with a numeric suffix so an existing note is never
 * overwritten. The chokidar watcher reindexes it; no manual index call needed
 * (same contract as `createExcerpt`).
 */
export async function createAboutNote(
  rootPath: string,
  params: AboutNoteParams,
): Promise<AboutNoteResult> {
  const stem = slugifyTitle(params.title) || 'clipped-note';
  const relativePath = await uniqueNotePath(rootPath, stem);
  const content =
    `---\nabout: [[sources/${params.sourceId}]]\n---\n\n` +
    `# ${params.title.trim() || 'Note'}\n\n` +
    `${params.body.trim()}\n`;
  await fs.writeFile(path.join(rootPath, relativePath), content, 'utf-8');
  return { relativePath };
}

/** Filename-safe, lowercase, hyphenated stem from a free-text title. */
export function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** `<stem>.md`, or `<stem>-2.md`, `<stem>-3.md`, … if earlier ones exist. */
async function uniqueNotePath(rootPath: string, stem: string): Promise<string> {
  for (let n = 1; ; n++) {
    const rel = n === 1 ? `${stem}.md` : `${stem}-${n}.md`;
    try {
      await fs.access(path.join(rootPath, rel));
    } catch {
      return rel; // doesn't exist → free to use
    }
  }
}
