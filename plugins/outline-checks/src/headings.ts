/**
 * Where a note's outline skips a level (#2831): a heading more than one level
 * below the one before it — an H1 straight to an H3 — which leaves a gap in
 * the outline, a table of contents and a screen reader's heading list.
 *
 * ATX headings (`#` … `######`) only, outside fenced code and frontmatter.
 * The first heading may be at any level: a note that starts at H2 is fine.
 */

export interface HeadingSkip {
  /** The heading that skips, and the levels it goes between. */
  text: string;
  from: number;
  to: number;
  /** Its line, from 1. */
  line: number;
}

/** Every skip in `markdown`, in order. */
export function headingSkips(markdown: string): HeadingSkip[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  const out: HeadingSkip[] = [];
  let fence: string | null = null;
  let previous = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (opener) {
      if (fence === null) fence = opener[1]![0]!.repeat(opener[1]!.length);
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = /^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (!h) continue;
    const level = h[1]!.length;
    if (previous > 0 && level > previous + 1) out.push({ text: h[2]!.trim() || '(untitled)', from: previous, to: level, line: i + 1 });
    previous = level;
  }
  return out;
}
