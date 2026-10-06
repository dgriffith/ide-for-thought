/**
 * "Save view" makes a note (#2507): a note holding a live ```object-view
 * block (#2067) — the embed that renders the real list/table/gallery/map
 * inside the note — with the view exactly as it was saved.
 *
 * Saved views used to be config (#1072: `.minerva/views/*.json`, listed in the
 * Objects panel) on the #1061 decision "a config entry, not a note". In use, a
 * saved view is something you name, file, link to and find again — a note —
 * and the config entries read as phantom notes in the Objects panel. The
 * embed already existed; Save now writes one.
 *
 * Pure: the content, the suggested name and the collision-free path. The
 * write lives in `renderer/lib/app/note-ops.ts`.
 */
import type { ViewLayout } from '../types';
import type { ViewFilter } from './view-spec';
import type { MapStyle } from './map-style';
import { viewHeightField } from './view-height';

export interface ViewNoteSpec {
  typeId: string;
  layout: ViewLayout;
  sortColumn: string | null;
  sortDir: 'asc' | 'desc';
  columns: string[] | null;
  /** Folder scope and filters (#2531); written only when set. */
  folder?: string | null | undefined;
  filters?: readonly ViewFilter[] | undefined;
  /** Map tile style (#2665); written only when not `auto`. */
  mapStyle?: MapStyle | undefined;
  /** The embed's height in px (#2666); written only when it isn't the default. */
  height?: number | null | undefined;
  /** Kanban's grouping enum property (#2601); written only when chosen — absent
   *  means the type's first enum property. */
  groupBy?: string | null | undefined;
}

const LAYOUT_NAMES: Record<ViewLayout, string> = { list: 'list', table: 'table', gallery: 'gallery', map: 'map', kanban: 'board' };

/** "Restaurant map", "Museum table" — the prompt's starting value. */
export function suggestViewNoteName(typeLabel: string, layout: ViewLayout): string {
  return `${typeLabel.trim() || 'Objects'} ${LAYOUT_NAMES[layout]}`;
}

/**
 * The live embed for a view: an ```object-view fence. The spec carries only
 * what departs from the defaults (no sort → none, all columns → none), so a
 * hand-read block stays short; `parseObjectViewSpec` reads the omissions back
 * as the same defaults. Save as note wraps it in a note; Copy as markdown
 * copies it bare, to paste into any note — the same view either way.
 */
export function buildViewEmbed(spec: ViewNoteSpec): string {
  const body: Record<string, unknown> = { typeId: spec.typeId, layout: spec.layout };
  if (spec.sortColumn) {
    body.sortColumn = spec.sortColumn;
    body.sortDir = spec.sortDir;
  }
  if (spec.columns) body.columns = spec.columns;
  if (spec.folder) body.folder = spec.folder;
  if (spec.filters && spec.filters.length > 0) body.filters = spec.filters;
  if (spec.mapStyle && spec.mapStyle !== 'auto') body.mapStyle = spec.mapStyle;
  if (spec.groupBy) body.groupBy = spec.groupBy;
  const height = viewHeightField(spec.height);
  if (height !== undefined) body.height = height;
  return `\`\`\`object-view\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
}

/** The note: a heading and the embed. */
export function buildViewNoteContent(title: string, spec: ViewNoteSpec): string {
  return `# ${title.trim()}\n\n${buildViewEmbed(spec)}`;
}

/**
 * The note's filename from what the user typed: path separators and other
 * characters a filename can't hold become `-`, so "Prague / Budapest" lands as
 * one note at the root rather than a folder. `.md` is added unless present.
 */
export function viewNoteFilename(name: string): string {
  const base = name.trim().replace(/\.md$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${base || 'View'}.md`;
}

/** `X.md`, then `X 2.md`, `X 3.md`, … — the first one `exists` says is free. */
export async function firstFreePath(filename: string, exists: (p: string) => Promise<boolean>): Promise<string> {
  if (!(await exists(filename))) return filename;
  const stem = filename.replace(/\.md$/i, '');
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} ${n}.md`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`No free name for ${filename}`);
}
