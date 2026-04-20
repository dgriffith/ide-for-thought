/**
 * Shared building blocks for formatter rules.
 *
 * Most rules are pure text transforms that must skip protected regions
 * (frontmatter, code fences, inline code, math). `transformUnprotected`
 * walks those regions once and applies the caller's transform only to the
 * text between them — so rule authors don't have to re-implement the
 * splice logic.
 */

import type { ParseCache, Range } from '../types';

export function transformUnprotected(
  content: string,
  cache: ParseCache,
  transform: (segment: string) => string,
): string {
  const ranges = collectProtectedRanges(cache);
  if (ranges.length === 0) return transform(content);

  let out = '';
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue; // overlapping/nested — outer already covered it
    if (range.start > cursor) {
      out += transform(content.slice(cursor, range.start));
    }
    out += content.slice(range.start, range.end);
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < content.length) {
    out += transform(content.slice(cursor));
  }
  return out;
}

function collectProtectedRanges(cache: ParseCache): Range[] {
  const ranges: Range[] = [];
  if (cache.frontmatterRange) ranges.push(cache.frontmatterRange);
  ranges.push(...cache.codeFenceRanges);
  ranges.push(...cache.inlineCodeRanges);
  ranges.push(...cache.mathRanges);
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

/**
 * Ensure at least `before` blank lines precede each range and at least
 * `after` blank lines follow it. Missing blanks are inserted; excess
 * blanks are left for `consecutive-blank-lines` to cap. Doc boundaries
 * (range at offset 0, or range ending at content length) are skipped.
 *
 * The function assumes each range starts at a line boundary — that's
 * how parse-cache's block ranges are constructed.
 */
export function ensureBlankLinesAroundRanges(
  content: string,
  ranges: readonly Range[],
  spec: { before: number; after: number },
): string {
  if (ranges.length === 0) return content;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const insertions: { offset: number; text: string }[] = [];

  for (const r of sorted) {
    if (r.start > 0) {
      const k = countTrailingNewlines(content, r.start);
      const blanks = Math.max(0, k - 1);
      if (blanks < spec.before) {
        insertions.push({ offset: r.start, text: '\n'.repeat(spec.before - blanks) });
      }
    }
    if (r.end < content.length) {
      const k = countLeadingNewlines(content, r.end);
      if (k < spec.after) {
        insertions.push({ offset: r.end, text: '\n'.repeat(spec.after - k) });
      }
    }
  }

  // When two ranges are adjacent, the trailing-blank-lines-for-range-A and
  // leading-blank-lines-for-range-B both target the same offset. Only the
  // larger of the two requests matters; apply max per offset, not sum.
  const byOffset = new Map<number, number>();
  for (const ins of insertions) {
    const existing = byOffset.get(ins.offset) ?? 0;
    if (ins.text.length > existing) byOffset.set(ins.offset, ins.text.length);
  }
  const merged = [...byOffset.entries()]
    .map(([offset, count]) => ({ offset, text: '\n'.repeat(count) }))
    .sort((a, b) => b.offset - a.offset);

  let out = content;
  for (const ins of merged) {
    out = out.slice(0, ins.offset) + ins.text + out.slice(ins.offset);
  }
  return out;
}

function countTrailingNewlines(content: string, pos: number): number {
  let k = 0;
  while (pos - 1 - k >= 0 && content[pos - 1 - k] === '\n') k++;
  return k;
}

function countLeadingNewlines(content: string, pos: number): number {
  let k = 0;
  while (pos + k < content.length && content[pos + k] === '\n') k++;
  return k;
}
