/**
 * Pure text / note-tree helpers extracted from App.svelte (#670). No stores,
 * no DOM, no reactivity — just string and NoteFile-tree functions, so they're
 * trivially unit-testable and don't belong inline in the root component.
 */
import { slugify } from '../../../shared/slug';
import type { NoteFile } from '../../../shared/types';

/** Cheap slug for path placeholders (e.g. onboarding system-prompt paths).
 *  Callers may override; this is just a sensible default. */
export function slugifyForPath(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'overview';
}

/** Byte offset of the heading/block-id anchor within `text`, or null.
 *  `^id` matches a trailing block id; otherwise matches a heading whose
 *  slug equals `anchor`. */
export function findAnchorOffset(text: string, anchor: string): number | null {
  const isBlockId = anchor.startsWith('^');
  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    if (isBlockId) {
      if (line.trimEnd().endsWith(anchor)) return offset;
    } else {
      const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (m && slugify(m[2]!) === anchor) return offset;
    }
    offset += line.length + 1;
  }
  return null;
}

/** 1-based line + 0-based column for a byte offset into `text`. */
export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') { line++; col = 0; } else { col++; }
  }
  return { line, col };
}

/**
 * Display name for a line bookmark (#756): the trimmed text of the line the
 * offset sits on, truncated, or `Line N` when that line is blank. Gives the
 * bookmarks panel something legible without storing extra fields.
 */
export function lineBookmarkName(text: string, offset: number): string {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const start = text.lastIndexOf('\n', clamped - 1) + 1;
  const endNl = text.indexOf('\n', clamped);
  const end = endNl === -1 ? text.length : endNl;
  const line = text.slice(start, end).trim();
  if (line) return line.length > 60 ? `${line.slice(0, 57)}…` : line;
  return `Line ${offsetToLineCol(text, clamped).line}`;
}

/** Flatten a NoteFile tree to the relative paths of indexable leaf files. */
export function flattenNotePaths(files: NoteFile[]): string[] {
  const out: string[] = [];
  const walk = (xs: NoteFile[]) => {
    for (const f of xs) {
      if (f.isDirectory) walk(f.children ?? []);
      else if (/\.(md|ttl|csv)$/.test(f.relativePath)) out.push(f.relativePath);
    }
  };
  walk(files);
  return out;
}

/** Recursive count of `.md` notes in a NoteFile tree (folders don't count). */
export function countNotes(files: NoteFile[]): number {
  let n = 0;
  for (const f of files) {
    if (!f.isDirectory && f.name.endsWith('.md')) n++;
    else if (f.isDirectory && f.children) n += countNotes(f.children);
  }
  return n;
}

/** Singular/plural noun for a delete confirmation over a set of targets. */
export function describeDeleteNoun(targets: Array<{ isDirectory: boolean }>): string {
  if (targets.length === 1) return targets[0]!.isDirectory ? 'folder' : 'note';
  const allDirs = targets.every((t) => t.isDirectory);
  const allFiles = targets.every((t) => !t.isDirectory);
  if (allDirs) return 'folders';
  if (allFiles) return 'notes';
  return 'items';
}

/** Human-readable delete confirmation message for one or more targets. */
export function describeDeleteMessage(
  targets: Array<{ relativePath: string; isDirectory: boolean }>,
  noun: string,
): string {
  if (targets.length === 1) {
    const name = targets[0]!.relativePath.split('/').pop();
    return `Delete ${noun} "${name}"?`;
  }
  const sample = targets.slice(0, 3).map((t) => t.relativePath).join(', ');
  const more = targets.length > 3 ? ', …' : '';
  return `Delete ${targets.length} ${noun} (${sample}${more})?`;
}
