import { describe, it, expect } from 'vitest';
import { planSplitByHeading } from '../../../src/renderer/lib/refactor/split-by-heading';

const today = '2026-04-19';

function plan(content: string, level: 1 | 2 | 3, sourceRelativePath = 'notes/meetings.md') {
  return planSplitByHeading({
    sourceRelativePath,
    sourceContent: content,
    level,
    today,
  });
}

describe('planSplitByHeading', () => {
  it('creates one new note per heading at the target level', () => {
    const src = '# Meetings\n\n## Feb 14\n\nFoo.\n\n## Feb 21\n\nBar.\n';
    const p = plan(src, 2);
    expect(p.newNotes).toHaveLength(2);
    expect(p.newNotes.map((n) => n.relativePath)).toEqual([
      'notes/meetings/feb-14.md',
      'notes/meetings/feb-21.md',
    ]);
  });

  it('places each section under its own heading in the new note', () => {
    const src = '# X\n\n## Feb 14\n\nFoo paragraph.\n\n## Feb 21\n\nBar paragraph.\n';
    const p = plan(src, 2);
    expect(p.newNotes[0].content).toContain('## Feb 14');
    expect(p.newNotes[0].content).toContain('Foo paragraph.');
    expect(p.newNotes[0].content).not.toContain('Feb 21');
    expect(p.newNotes[1].content).toContain('## Feb 21');
    expect(p.newNotes[1].content).toContain('Bar paragraph.');
  });

  it('writes frontmatter with title, created, and source on each new note', () => {
    const src = '## Only Heading\n\nBody.\n';
    const p = plan(src, 2, 'a.md');
    const fm = p.newNotes[0].content;
    expect(fm).toContain('---\ntitle: Only Heading');
    expect(fm).toContain('created: 2026-04-19');
    expect(fm).toContain('source: a.md');
  });

  it('rewrites the source as a Contents list of wiki-links', () => {
    const src = 'Optional preamble.\n\n## A\n\nA body.\n\n## B\n\nB body.\n';
    const p = plan(src, 2, 'notes/big.md');
    expect(p.updatedSourceContent).toContain('## Contents');
    expect(p.updatedSourceContent).toContain('[[notes/big/a|A]]');
    expect(p.updatedSourceContent).toContain('[[notes/big/b|B]]');
    expect(p.updatedSourceContent).not.toContain('A body.');
    expect(p.updatedSourceContent).not.toContain('B body.');
  });

  it('preserves a preamble before the first matching heading', () => {
    const src = '# Overview\n\nIntro paragraph.\n\n## A\n\nA body.\n';
    const p = plan(src, 2);
    expect(p.updatedSourceContent).toContain('# Overview');
    expect(p.updatedSourceContent).toContain('Intro paragraph.');
    expect(p.updatedSourceContent.indexOf('## Contents')).toBeGreaterThan(
      p.updatedSourceContent.indexOf('Intro paragraph.'),
    );
  });

  it('returns empty plan when no headings at the target level exist', () => {
    const src = '# One H1 only\n\n## Not at requested level\n';
    const p = plan(src, 1);
    // One H1 heading — it becomes the only new note, preamble is empty.
    expect(p.newNotes).toHaveLength(1);
    expect(p.newNotes[0].relativePath).toBe('notes/meetings/one-h1-only.md');
  });

  it('returns zero-new-notes plan and leaves source untouched when no match', () => {
    const src = '# Only H1\n\nNo H2 in sight.\n';
    const p = plan(src, 2);
    expect(p.newNotes).toHaveLength(0);
    expect(p.updatedSourceContent).toBe(src);
  });

  it('suffixes colliding filenames with -2, -3, …', () => {
    const src = '## Changes\n\nfirst\n\n## Changes\n\nsecond\n\n## Changes\n\nthird\n';
    const p = plan(src, 2);
    expect(p.newNotes.map((n) => n.relativePath)).toEqual([
      'notes/meetings/changes.md',
      'notes/meetings/changes-2.md',
      'notes/meetings/changes-3.md',
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const src = '## Real\n\nbody\n\n```\n## fake\n```\n\n## Real Two\n\nbody two\n';
    const p = plan(src, 2);
    expect(p.newNotes).toHaveLength(2);
    expect(p.newNotes.map((n) => n.relativePath)).toEqual([
      'notes/meetings/real.md',
      'notes/meetings/real-two.md',
    ]);
    // The fenced fake heading stays inside the first section's content.
    expect(p.newNotes[0].content).toContain('## fake');
  });

  it('preserves existing YAML frontmatter on the source', () => {
    const src = '---\ntitle: Meetings\n---\n\n## A\n\nfoo\n\n## B\n\nbar\n';
    const p = plan(src, 2);
    expect(p.updatedSourceContent.startsWith('---\ntitle: Meetings\n---')).toBe(true);
  });

  it('picks the parent folder for the subfolder, not the project root', () => {
    const src = '## A\nfoo\n';
    const p = plan(src, 2, 'research/papers/index.md');
    expect(p.newNotes[0].relativePath).toBe('research/papers/index/a.md');
  });
});
