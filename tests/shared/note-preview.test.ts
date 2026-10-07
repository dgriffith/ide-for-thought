/**
 * The pure link-hover preview builder (#2710), moved to `src/shared/` from the
 * renderer's fetcher so main can compute the same preview at export time.
 *
 * Two halves: the fetcher's old cases run against the pure function, and a
 * differential check against a verbatim copy of the pre-move code (the body
 * of the old `makeNotePreviewFetcher`, after the read) over a corpus that hits
 * every branch — frontmatter title, H1 title, stem fallback, a heading and a
 * block section, a missing section, the duplicate H1, both truncation caps,
 * CRLF and an empty note.
 */
import { describe, it, expect } from 'vitest';
import { buildNotePreview, notePreviewTitle, truncateSnippet, NOTE_PREVIEW_MAX_CHARS, NOTE_PREVIEW_MAX_LINES } from '../../src/shared/note-preview';
import { parseTransclusionTarget, sliceTransclusion } from '../../src/shared/transclusion';
import { noteTitle } from '../../src/shared/note-title';

// ── The pre-#2710 implementation, verbatim, as the reference ────────────────
function legacy(content: string, resolved: string, target: string): { title: string; snippet: string } {
  const parsed = parseTransclusionTarget(target);
  let slice = sliceTransclusion(content, parsed);
  if (!slice.ok && (parsed.heading || parsed.blockId)) slice = sliceTransclusion(content, { path: parsed.path });
  const title = noteTitle(content) ?? resolved.split('/').pop()!.replace(/\.md$/i, '');
  const lines0 = slice.text.split('\n');
  let text = slice.text;
  if (lines0[0] && /^#\s+/.test(lines0[0]) && lines0[0].replace(/^#\s+/, '').trim() === title) text = lines0.slice(1).join('\n').trim();
  const allLines = text.split('\n');
  let out = allLines.slice(0, 8).join('\n').trim();
  let clipped = allLines.length > 8;
  if (out.length > 260) { out = out.slice(0, 260).replace(/\s+\S*$/, ''); clipped = true; }
  return { title, snippet: clipped ? `${out}…` : out };
}

const TOPIC = ['---', 'title: The Topic', '---', '', '# The Topic', '', 'Opening paragraph explaining the topic.', '', '## Section A', '', 'Details about section A.'].join('\n');
const CORPUS: Array<[content: string, path: string, target: string]> = [
  [TOPIC, 'notes/topic.md', 'notes/topic'],
  [TOPIC, 'notes/topic.md', 'notes/topic#Section A'],
  [TOPIC, 'notes/topic.md', 'notes/topic#No Such Heading'],
  ['# Plain Note\n\nJust an H1 and a line.', 'notes/plain.md', 'notes/plain'],
  ['No heading at all, just prose.', 'deep/dir/Stem Only.md', 'Stem Only'],
  ['A block line ^blk\n\nAnother paragraph.', 'b.md', 'b^blk'],
  ['A block line ^blk\n\nAnother paragraph.', 'b.md', 'b#^missing'],
  ['# Other Title\n\nBody.', 'x.md', 'x'],
  [Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'), 'many.md', 'many'],
  ['word '.repeat(120), 'long.md', 'long'],
  ['---\r\ntitle: CRLF\r\n---\r\nBody after CRLF frontmatter.', 'crlf.md', 'crlf'],
  ['', 'empty.md', 'empty'],
  ['---\ntitle: Only FM\n---\n', 'fm.md', 'fm'],
  ['data,1\n2,3', 'table.csv', 'table.csv'],
];

describe('buildNotePreview (#2710) — the fetcher\'s old cases', () => {
  it('title + opening snippet, leading duplicate H1 dropped', () => {
    const p = buildNotePreview(TOPIC, 'notes/topic.md');
    expect(p.title).toBe('The Topic');
    expect(p.snippet).toContain('Opening paragraph');
    expect(p.snippet.startsWith('# ')).toBe(false);
  });

  it('the referenced #heading section, not the whole note', () => {
    const p = buildNotePreview(TOPIC, 'notes/topic.md', { heading: 'Section A' });
    expect(p.snippet).toContain('Details about section A');
    expect(p.snippet).not.toContain('Opening paragraph');
  });

  it('a missing section falls back to the opening', () => {
    expect(buildNotePreview(TOPIC, 'notes/topic.md', { heading: 'Nope' }).snippet).toContain('Opening paragraph');
  });

  it('the H1 when there is no frontmatter title, else the stem', () => {
    expect(notePreviewTitle('# Plain Note\n\nx', 'notes/plain.md')).toBe('Plain Note');
    expect(notePreviewTitle('prose', 'deep/Stem Only.md')).toBe('Stem Only');
  });

  it('truncates to the line and character caps with an ellipsis', () => {
    const many = truncateSnippet(Array.from({ length: NOTE_PREVIEW_MAX_LINES + 3 }, (_, i) => `l${i}`).join('\n'));
    expect(many.split('\n')).toHaveLength(NOTE_PREVIEW_MAX_LINES);
    expect(many.endsWith('…')).toBe(true);
    const long = truncateSnippet('word '.repeat(100));
    expect(long.length).toBeLessThanOrEqual(NOTE_PREVIEW_MAX_CHARS + 1);
    expect(long.endsWith('word…')).toBe(true);
    expect(truncateSnippet('short')).toBe('short');
  });
});

describe('buildNotePreview (#2710) — identical to the pre-move code', () => {
  it.each(CORPUS)('%#: %s → %s', (content, path, target) => {
    const parsed = parseTransclusionTarget(target);
    const section = { ...(parsed.heading ? { heading: parsed.heading } : {}), ...(parsed.blockId ? { blockId: parsed.blockId } : {}) };
    expect(buildNotePreview(content, path, section)).toEqual(legacy(content, path, target));
  });
});
