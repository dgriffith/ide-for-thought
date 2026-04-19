import { describe, it, expect } from 'vitest';
import {
  deriveProposedTitle,
  sanitizeFilename,
  planExtract,
  planSplitHere,
} from '../../../src/renderer/lib/refactor/extract';

describe('deriveProposedTitle', () => {
  it('uses the first ATX heading when the body starts with one', () => {
    expect(deriveProposedTitle('# My Heading\n\nbody')).toBe('My Heading');
    expect(deriveProposedTitle('\n\n## Second Level Heading')).toBe('Second Level Heading');
  });

  it('uses a short first line when no heading is present', () => {
    expect(deriveProposedTitle('A short line\nthen body')).toBe('A short line');
  });

  it('returns null when the first non-blank line is long', () => {
    const long = 'Here is a long first line that exceeds the short-line threshold intentionally so we fall through';
    expect(deriveProposedTitle(long)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(deriveProposedTitle('')).toBeNull();
    expect(deriveProposedTitle('\n\n\n')).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(sanitizeFilename('My Heading')).toBe('my-heading');
  });

  it('strips illegal path chars', () => {
    expect(sanitizeFilename('x/y\\z:*?')).toBe('x-y-z');
  });

  it('collapses repeated hyphens and trims edges', () => {
    expect(sanitizeFilename('  foo -- bar  ')).toBe('foo-bar');
  });

  it('returns empty string for pure junk (caller falls back)', () => {
    expect(sanitizeFilename('///')).toBe('');
  });
});

describe('planExtract', () => {
  const today = '2026-04-19';

  it('builds a new note in the source folder with frontmatter + selected content', () => {
    const source = '# Overview\n\nIntro.\n\n## Details\n\nRelevant detail paragraph that should move.\n\n## Other';
    const from = source.indexOf('## Details');
    const to = source.indexOf('## Other');
    const plan = planExtract({
      sourceRelativePath: 'notes/overview.md',
      sourceContent: source,
      selection: { from, to },
      title: 'Details',
      today,
    });

    expect(plan.newNotePath).toBe('notes/details.md');
    expect(plan.newNoteContent).toContain('---\ntitle: Details');
    expect(plan.newNoteContent).toContain('created: 2026-04-19');
    expect(plan.newNoteContent).toContain('source: notes/overview.md');
    expect(plan.newNoteContent).toContain('## Details');
    expect(plan.newNoteContent).toContain('Relevant detail paragraph');
    expect(plan.newNoteContent).not.toContain('## Other');
  });

  it('replaces the selection in the source with a wiki-link (no .md)', () => {
    const source = 'Before [SELECT] after.';
    const from = source.indexOf('[SELECT]');
    const to = from + '[SELECT]'.length;
    const plan = planExtract({
      sourceRelativePath: 'a.md',
      sourceContent: source,
      selection: { from, to },
      title: 'Pulled Out',
      today,
    });

    expect(plan.linkBack).toBe('[[pulled-out]]');
    expect(plan.updatedSourceContent).toBe('Before [[pulled-out]] after.');
    expect(plan.newNotePath).toBe('pulled-out.md');
  });

  it('uses a timestamp fallback when the title sanitizes to empty', () => {
    const plan = planExtract({
      sourceRelativePath: 'a.md',
      sourceContent: 'foo',
      selection: { from: 0, to: 3 },
      title: '///',
      today,
    });
    expect(plan.newNotePath).toMatch(/^note-\d+\.md$/);
  });
});

describe('planSplitHere', () => {
  const today = '2026-04-19';

  it('splits cursor-to-EOF into a new note, truncates source, appends link', () => {
    const source = '# Note\n\nIntro.\n\n## Tail section\n\nTail text.\n';
    const cursor = source.indexOf('## Tail section');
    const plan = planSplitHere({
      sourceRelativePath: 'notes/big.md',
      sourceContent: source,
      cursor,
      title: 'Tail section',
      today,
    });

    expect(plan.newNotePath).toBe('notes/tail-section.md');
    expect(plan.newNoteContent).toContain('## Tail section');
    expect(plan.newNoteContent).toContain('Tail text.');
    expect(plan.updatedSourceContent).toContain('Intro.');
    expect(plan.updatedSourceContent).not.toContain('Tail text.');
    expect(plan.updatedSourceContent.trim().endsWith('[[notes/tail-section]]')).toBe(true);
  });

  it('snaps to line start so the split never lands mid-word', () => {
    const source = '# Note\n\nIntro paragraph here.\n\nTail line.\n';
    // cursor mid-line inside "Intro" — "paragraph" starts after "Intro "
    const cursor = source.indexOf('paragraph');
    const plan = planSplitHere({
      sourceRelativePath: 'a.md',
      sourceContent: source,
      cursor,
      title: 'Split',
      today,
    });
    // The new note keeps the full "Intro paragraph here." line intact
    // because the split snapped to the start of that line.
    expect(plan.newNoteContent).toContain('Intro paragraph here.');
    expect(plan.updatedSourceContent).not.toContain('Intro');
  });

  it('refuses to split inside frontmatter — snaps past it', () => {
    const source = '---\ntitle: X\n---\n\nBody text.\nMore.\n';
    // Cursor inside the frontmatter block
    const plan = planSplitHere({
      sourceRelativePath: 'a.md',
      sourceContent: source,
      cursor: source.indexOf('title:'),
      title: 'Split',
      today,
    });
    // Source keeps its frontmatter; new note has the body only.
    expect(plan.updatedSourceContent.startsWith('---\ntitle: X\n---')).toBe(true);
    expect(plan.newNoteContent).toContain('Body text.');
    expect(plan.newNoteContent).not.toContain('title: X');
  });
});
