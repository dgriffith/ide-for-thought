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
