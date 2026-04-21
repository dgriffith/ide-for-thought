/**
 * Block-type scanners used by the spacing rules that need to locate
 * constructs the parse-cache doesn't already track (horizontal rules,
 * pipe tables, ATX headings). Each scanner returns line-terminated
 * ranges in the same convention parse-cache uses — start at the first
 * char of the block, end at the start of the line following the block.
 */

import type { ParseCache, Range } from '../../types';

export function findHorizontalRuleRanges(
  content: string,
  cache: ParseCache,
): Range[] {
  return scanLines(content, cache, (line) => isHorizontalRuleLine(line));
}

export function findHeadingRanges(
  content: string,
  cache: ParseCache,
): Range[] {
  return scanLines(content, cache, (line) => /^#{1,6}(?:[ \t]|$)/.test(line));
}

export function findTableRanges(
  content: string,
  cache: ParseCache,
): Range[] {
  const ranges: Range[] = [];
  let lineStart = 0;
  const n = content.length;

  while (lineStart < n) {
    const lineEnd = findLineEnd(content, lineStart);
    const afterLine = lineEnd < n ? lineEnd + 1 : n;

    if (cache.isProtected(lineStart) || !isTableLine(content, lineStart, lineEnd)) {
      lineStart = afterLine;
      continue;
    }

    const rangeStart = lineStart;
    let cursor = afterLine;
    while (cursor < n) {
      if (cache.isProtected(cursor)) break;
      const e = findLineEnd(content, cursor);
      if (!isTableLine(content, cursor, e)) break;
      cursor = e < n ? e + 1 : n;
    }
    ranges.push({ start: rangeStart, end: cursor });
    lineStart = cursor;
  }
  return ranges;
}

function scanLines(
  content: string,
  cache: ParseCache,
  predicate: (line: string) => boolean,
): Range[] {
  const ranges: Range[] = [];
  let lineStart = 0;
  const n = content.length;
  while (lineStart < n) {
    const lineEnd = findLineEnd(content, lineStart);
    const afterLine = lineEnd < n ? lineEnd + 1 : n;
    if (!cache.isProtected(lineStart)) {
      const line = content.slice(lineStart, lineEnd);
      if (predicate(line)) ranges.push({ start: lineStart, end: afterLine });
    }
    lineStart = afterLine;
  }
  return ranges;
}

function findLineEnd(content: string, start: number): number {
  let i = start;
  while (i < content.length && content[i] !== '\n') i++;
  return i;
}

function isHorizontalRuleLine(line: string): boolean {
  const trimmed = line.trim();
  return /^([-*_])(?:[ \t]*\1){2,}$/.test(trimmed);
}

function isTableLine(content: string, lineStart: number, lineEnd: number): boolean {
  const line = content.slice(lineStart, lineEnd);
  return /^[ \t]{0,3}\|/.test(line);
}
