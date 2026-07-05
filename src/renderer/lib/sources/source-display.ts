/**
 * Pure display helpers for the sources list (#672, extracted from
 * SourcesPanel.svelte alongside the SourceListItem split).
 *
 * These format a source row's byline, due-by stamp, and read-status indicator.
 * They're pure (modulo "today" for the date helpers) so they can be unit-
 * tested directly — which covers the render-affecting logic behind the
 * extracted SourceListItem component. `formatDueStamp` is shared between the
 * row and the context-menu "Set due date" label, hence its own module.
 */

import type { SourceMetadata } from '../../../shared/types';

type ReadStatus = SourceMetadata['readStatus'];

/** Byline author rendering: one name, "A and B", or "A et al." for 3+. */
export function formatCreators(creators: string[]): string {
  if (creators.length === 0) return '';
  if (creators.length === 1) return creators[0]!;
  if (creators.length === 2) return `${creators[0]} and ${creators[1]}`;
  return `${creators[0]} et al.`;
}

/**
 * Compact stamp for the source row's due-by indicator. Shows "Jun 15" within
 * the current year, "Jun 15 2027" otherwise. The caller adds the leading
 * "due " word so it can be re-styled independently. Falls back to the raw ISO
 * string for an unparseable date.
 */
export function formatDueStamp(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

/**
 * True when the due-by date is strictly before today (local time). Overdue
 * items are highlighted in the list (with --rust, a signal color — not red,
 * per CLAUDE.md's no-danger-styling rule).
 */
export function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

/** Single-character glyph for the read-status dot (ASCII-safe; the mapping is
 *  learned from the title attribute). */
export function statusGlyph(status: ReadStatus): string {
  switch (status) {
    case 'reading': return '◐';
    case 'read': return '●';
    case 'unread': return '○';
    case 'skipped': return '×';
    default: return '';
  }
}

/** Human label for the read-status dot's title/aria. */
export function statusTitle(status: ReadStatus): string {
  switch (status) {
    case 'reading': return 'Reading';
    case 'read': return 'Read';
    case 'unread': return 'Unread';
    case 'skipped': return 'Skipped';
    default: return '';
  }
}
