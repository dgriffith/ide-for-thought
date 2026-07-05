/**
 * CodeMirror extension: a gutter flag on every bookmarked line (#756).
 *
 * Bookmarks live in the side panel, but until now there was no in-editor
 * sign that a given line/section/note was bookmarked. This renders the
 * Minerva `bookmark` ribbon — filled — in its own narrow gutter column
 * on each bookmarked line.
 *
 * Resolution (pure, in `resolveBookmarkOffsets`):
 *   - **line** bookmark  → its stored `cursorOffset`
 *   - **section** bookmark → the start of the heading whose slug matches
 *     `anchor`
 *   - **file** bookmark (no offset, no anchor) → offset 0 (line 1), so a
 *     whole-note bookmark is still visible
 *
 * The host pushes the current file's bookmarks via `setBookmarkOffsets`;
 * the field also maps offsets forward through edits so flags track the
 * text as the user types within a session.
 */

import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { ICONS } from '../components/icons/registry';
import { extractHeadings } from '../markdown/headings';
import { slugify } from '../../../shared/slug';

/** The position-bearing fields of a bookmark, as the editor needs them. */
export interface BookmarkRef {
  cursorOffset?: number | undefined;
  anchor?: string | undefined;
}

/**
 * Resolve a file's bookmarks to character offsets in `content`. Pure, so
 * it's unit-testable without a DOM. Deduplicates — several bookmarks on
 * one line yield a single flag.
 */
export function resolveBookmarkOffsets(
  content: string,
  bookmarks: readonly BookmarkRef[],
): number[] {
  if (bookmarks.length === 0) return [];
  const out = new Set<number>();

  // Built lazily — most notes have no section bookmarks, so we avoid
  // scanning for headings / line starts unless an `anchor` needs it.
  let headingLineBySlug: Map<string, number> | null = null;
  let lineStarts: number[] | null = null;

  const ensureHeadings = () => {
    if (headingLineBySlug) return;
    headingLineBySlug = new Map();
    for (const h of extractHeadings(content)) {
      const s = slugify(h.text);
      // First heading wins — matches how anchor navigation resolves a
      // duplicate slug to the earliest occurrence.
      if (s && !headingLineBySlug.has(s)) headingLineBySlug.set(s, h.line);
    }
  };
  const ensureLineStarts = () => {
    if (lineStarts) return;
    lineStarts = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') lineStarts.push(i + 1);
    }
  };

  for (const bm of bookmarks) {
    if (bm.cursorOffset != null) {
      out.add(Math.max(0, Math.min(bm.cursorOffset, content.length)));
    } else if (bm.anchor) {
      ensureHeadings();
      const line = headingLineBySlug!.get(bm.anchor);
      if (line != null) {
        ensureLineStarts();
        out.add(lineStarts![line - 1] ?? 0);
      }
    } else {
      // Whole-note bookmark — flag line 1 so it's still visible.
      out.add(0);
    }
  }
  return [...out];
}

/** Replace the set of bookmarked offsets for the current document. */
export const setBookmarkOffsets = StateEffect.define<number[]>();

const bookmarkField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(set, tr) {
    let next: Set<number> | null = null;
    for (const e of tr.effects) {
      if (e.is(setBookmarkOffsets)) next = new Set(e.value);
    }
    if (next) return next;
    // Map offsets forward so a flag stays glued to its line as the user
    // edits above it within the session.
    if (tr.docChanged && set.size) {
      const mapped = new Set<number>();
      for (const pos of set) {
        const m = tr.changes.mapPos(pos, -1);
        if (m >= 0) mapped.add(m);
      }
      return mapped;
    }
    return set;
  },
});

const FILLED_BOOKMARK =
  `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" stroke="none" aria-hidden="true">${ICONS.bookmark}</svg>`;

class BookmarkMarker extends GutterMarker {
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-bookmark-flag';
    el.innerHTML = FILLED_BOOKMARK;
    el.title = 'Bookmarked';
    return el;
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof BookmarkMarker;
  }
}
const bookmarkMarker = new BookmarkMarker();

const bookmarkGutter = gutter({
  class: 'cm-bookmark-gutter',
  lineMarker(view, line) {
    const set = view.state.field(bookmarkField, false);
    if (!set || set.size === 0) return null;
    for (const pos of set) {
      if (pos >= line.from && pos <= line.to) return bookmarkMarker;
    }
    return null;
  },
  // Re-evaluate markers when the offset set changes or the doc shifts.
  // No initialSpacer — the column collapses to nothing on notes with no
  // bookmarks rather than leaving a permanent dead strip.
  lineMarkerChange(update) {
    return (
      update.docChanged ||
      update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setBookmarkOffsets)),
      )
    );
  },
});

export function bookmarkGutterExtension(): Extension {
  return [bookmarkField, bookmarkGutter];
}

/** Push the resolved offsets into a live view (no-op if unchanged is fine). */
export function applyBookmarkOffsets(view: EditorView, offsets: number[]): void {
  view.dispatch({ effects: setBookmarkOffsets.of(offsets) });
}

// Co-located styles, inlined into Editor.svelte's scoped block (Svelte's
// scoped CSS needs :global wrappers at the component level).
export const bookmarkGutterStyles = `
  .cm-bookmark-gutter { min-width: 0; }
  .cm-bookmark-flag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    color: var(--accent);
    line-height: 1;
  }
`;
