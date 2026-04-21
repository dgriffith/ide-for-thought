/**
 * Builds the ParseCache (#153) for a note in a single pass.
 *
 * Identifies:
 *   - top-of-file YAML frontmatter
 *   - fenced code blocks (``` and ~~~ with matching length)
 *   - inline backticked spans
 *   - math blocks (`$$…$$`) and inline math (`$…$`)
 *   - blockquote regions
 *
 * The resulting cache exposes an `isProtected(offset)` helper so rules can
 * cheaply skip content inside any "don't touch" region.
 */

import type { ParseCache, Range } from './types';

export function buildParseCache(content: string): ParseCache {
  const frontmatterRange = findFrontmatter(content);

  // Find fenced-code-block ranges first so we can mask them from the other
  // scanners — inline-math `$...$` inside a JS code block shouldn't count.
  const codeFenceRanges = findFencedCodeBlocks(content);
  const masked = maskRanges(content, [
    ...codeFenceRanges,
    ...(frontmatterRange ? [frontmatterRange] : []),
  ]);

  const inlineCodeRanges = findInlineCode(masked).map((r) => absoluteRange(r));
  const mathRanges = findMath(masked).map((r) => absoluteRange(r));
  const blockquoteRanges = findBlockquotes(content);

  const allProtected = [
    ...(frontmatterRange ? [frontmatterRange] : []),
    ...codeFenceRanges,
    ...inlineCodeRanges,
    ...mathRanges,
  ];

  function isProtected(offset: number): boolean {
    for (const r of allProtected) {
      if (offset >= r.start && offset < r.end) return true;
    }
    return false;
  }

  return {
    frontmatterRange,
    codeFenceRanges,
    inlineCodeRanges,
    mathRanges,
    blockquoteRanges,
    isProtected,
  };
}

// ── Frontmatter ──────────────────────────────────────────────────────────

function findFrontmatter(content: string): Range | null {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
  if (!m || m.index !== 0) return null;
  return { start: 0, end: m[0].length };
}

// ── Fenced code blocks ───────────────────────────────────────────────────

function findFencedCodeBlocks(content: string): Range[] {
  const out: Range[] = [];
  const lines = splitLines(content);
  let i = 0;
  let offset = 0;
  const lineOffsets: number[] = [];
  // Pre-compute line start offsets for range math.
  {
    let pos = 0;
    for (const l of lines) {
      lineOffsets.push(pos);
      pos += l.length;
    }
    lineOffsets.push(pos);
  }

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (!fenceMatch) {
      offset += line.length;
      i++;
      continue;
    }
    const fenceChar = fenceMatch[1][0];
    const fenceLen = fenceMatch[1].length;
    const blockStart = lineOffsets[i];
    let j = i + 1;
    while (j < lines.length) {
      const candidate = lines[j];
      const closeMatch = new RegExp(`^[ \\t]{0,3}(${fenceChar}{${fenceLen},})[ \\t]*(\\r?\\n|$)`).exec(candidate);
      if (closeMatch) { j++; break; }
      j++;
    }
    const blockEnd = j < lines.length ? lineOffsets[j] : lineOffsets[lines.length];
    out.push({ start: blockStart, end: blockEnd });
    i = j;
    offset = lineOffsets[j] ?? content.length;
  }
  return out;
}

/**
 * Split content into lines preserving their terminators. `lines.join('')`
 * reconstructs the original content exactly.
 */
function splitLines(content: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    let j = i;
    while (j < n && content[j] !== '\n') j++;
    if (j < n) j++; // include the '\n'
    out.push(content.slice(i, j));
    i = j;
  }
  return out;
}

// ── Inline code ──────────────────────────────────────────────────────────

function findInlineCode(content: string): Range[] {
  // Match the longest-possible backtick run as delimiter to mirror CommonMark:
  //   `code`, ``code with ` inside``, etc.
  const out: Range[] = [];
  const re = /(`+)(?:[^`]|(?!\1)`)*\1/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    // Avoid zero-length infinite loops on empty matches.
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ── Math ─────────────────────────────────────────────────────────────────

function findMath(content: string): Range[] {
  const out: Range[] = [];
  // Block math first: $$...$$ possibly spanning newlines.
  const blockRe = /\$\$[\s\S]*?\$\$/g;
  let m;
  while ((m = blockRe.exec(content)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  // Inline math: single `$...$`. Skip anything already inside a block match.
  const inlineRe = /\$[^\n$]+?\$/g;
  while ((m = inlineRe.exec(content)) !== null) {
    const inside = out.some((r) => m!.index >= r.start && m!.index < r.end);
    if (inside) continue;
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ── Blockquotes ──────────────────────────────────────────────────────────

function findBlockquotes(content: string): Range[] {
  const out: Range[] = [];
  const lines = splitLines(content);
  const lineOffsets: number[] = [];
  {
    let pos = 0;
    for (const l of lines) { lineOffsets.push(pos); pos += l.length; }
    lineOffsets.push(pos);
  }
  let i = 0;
  while (i < lines.length) {
    if (/^[ \t]{0,3}>/.test(lines[i])) {
      const start = lineOffsets[i];
      let j = i + 1;
      while (j < lines.length && /^[ \t]{0,3}>/.test(lines[j])) j++;
      out.push({ start, end: lineOffsets[j] });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Produce a content string with characters inside `ranges` replaced by
 * spaces (preserving newlines and offsets). Used to prevent scanners like
 * inline-code from matching text inside code fences.
 */
function maskRanges(content: string, ranges: Range[]): string {
  if (ranges.length === 0) return content;
  const chars = content.split('');
  for (const r of ranges) {
    for (let i = r.start; i < r.end && i < chars.length; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

/** After masking, the absolute offsets still line up with the original. Identity passthrough kept for clarity at call sites. */
function absoluteRange(r: Range): Range {
  return r;
}
