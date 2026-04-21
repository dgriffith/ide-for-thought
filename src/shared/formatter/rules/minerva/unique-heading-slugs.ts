import { registerRule } from '../../registry';
import { slugify } from '../../../slug';

const HEADING_RE = /^(#{1,6})([ \t]+)(.+?)([ \t]*#*[ \t]*)$/;

registerRule({
  id: 'unique-heading-slugs',
  category: 'minerva',
  title: 'Unique heading slugs',
  description:
    'When two headings in the same note slugify to the same id, suffix the duplicates (`Overview` + `Overview` → `Overview` + `Overview 2`) so every heading anchor is unique. When a heading is renamed, the orchestrator\'s rename cascade rewrites incoming `[[note#old-slug]]` links to match.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    const lines = splitLinesKeepTerminator(content);
    const offsets = buildLineOffsets(lines);
    const seenSlugs = new Map<string, number>();
    const rewrites: { lineIndex: number; newLine: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (cache.isProtected(offsets[i])) continue;
      const body = raw.replace(/\r?\n$/, '');
      const m = body.match(HEADING_RE);
      if (!m) continue;
      const text = m[3].trim();
      const slug = slugify(text);
      const count = seenSlugs.get(slug) ?? 0;
      seenSlugs.set(slug, count + 1);
      if (count === 0) continue;
      // Need a unique text; start at `<text> 2`, climb until the slug is free.
      let n = count + 1;
      let candidateText: string;
      let candidateSlug: string;
      while (true) {
        candidateText = `${text} ${n}`;
        candidateSlug = slugify(candidateText);
        if (!seenSlugs.has(candidateSlug)) break;
        n++;
      }
      seenSlugs.set(candidateSlug, 1);
      const terminator = raw.slice(body.length);
      rewrites.push({
        lineIndex: i,
        newLine: `${m[1]}${m[2]}${candidateText}${m[4]}${terminator}`,
      });
    }

    if (rewrites.length === 0) return content;
    for (const r of rewrites) lines[r.lineIndex] = r.newLine;
    return lines.join('');
  },
});

function splitLinesKeepTerminator(content: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    let j = i;
    while (j < n && content[j] !== '\n') j++;
    if (j < n) j++;
    out.push(content.slice(i, j));
    i = j;
  }
  return out;
}

function buildLineOffsets(lines: string[]): number[] {
  const offsets = new Array<number>(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets[i] = pos;
    pos += lines[i].length;
  }
  return offsets;
}

