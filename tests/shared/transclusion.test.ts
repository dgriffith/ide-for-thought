import { describe, it, expect } from 'vitest';
import { parseTransclusionTarget, sliceTransclusion } from '../../src/shared/transclusion';

describe('parseTransclusionTarget', () => {
  it('parses a whole-note target', () => {
    expect(parseTransclusionTarget('My Note')).toEqual({ path: 'My Note' });
  });
  it('parses a heading target', () => {
    expect(parseTransclusionTarget('My Note#Some Heading')).toEqual({
      path: 'My Note', heading: 'Some Heading',
    });
  });
  it('parses a block target', () => {
    expect(parseTransclusionTarget('My Note^abc123')).toEqual({
      path: 'My Note', blockId: 'abc123',
    });
  });
  it('parses the canonical #^block form', () => {
    expect(parseTransclusionTarget('My Note#^abc123')).toEqual({
      path: 'My Note', blockId: 'abc123',
    });
  });
  it('ignores a |display alias', () => {
    expect(parseTransclusionTarget('My Note#H|ignored')).toEqual({
      path: 'My Note', heading: 'H',
    });
  });
});

const DOC = `---
title: Source
---
Intro paragraph.

## Alpha
Alpha body line one.
Alpha body line two.

### Alpha child
Nested under alpha.

## Beta
Beta body.

This is a tagged block. ^keep

Standalone-anchored block.

^lonely
`;

describe('sliceTransclusion', () => {
  it('returns the whole body (frontmatter stripped) for a bare note', () => {
    const r = sliceTransclusion(DOC, { path: 'Source' });
    expect(r.ok).toBe(true);
    expect(r.text.startsWith('Intro paragraph.')).toBe(true);
    expect(r.text).not.toContain('title: Source');
  });

  it('slices a heading section down to the next same-or-higher heading', () => {
    const r = sliceTransclusion(DOC, { path: 'Source', heading: 'Alpha' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('## Alpha');
    expect(r.text).toContain('Alpha body line two.');
    expect(r.text).toContain('### Alpha child'); // deeper heading stays in the section
    expect(r.text).not.toContain('## Beta');     // sibling heading ends it
  });

  it('matches headings by slug (case/space insensitive)', () => {
    const r = sliceTransclusion(DOC, { path: 'Source', heading: 'alpha-child' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('### Alpha child');
    expect(r.text).not.toContain('## Beta');
  });

  it('reports a missing heading', () => {
    const r = sliceTransclusion(DOC, { path: 'Source', heading: 'Nope' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found/);
  });

  it('slices a trailing ^block and strips the marker', () => {
    const r = sliceTransclusion(DOC, { path: 'Source', blockId: 'keep' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('This is a tagged block.');
    expect(r.text).not.toContain('^keep');
  });

  it('slices a standalone ^block to the paragraph above it', () => {
    const r = sliceTransclusion(DOC, { path: 'Source', blockId: 'lonely' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Standalone-anchored block.');
  });

  it('reports a missing block', () => {
    const r = sliceTransclusion(DOC, { path: 'Source', blockId: 'ghost' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found/);
  });

  it('does not treat a `#` inside a code fence as a heading', () => {
    const doc = '## Real\nbody\n\n```\n## fake heading in fence\n```\nmore body\n\n## End\ntail';
    const r = sliceTransclusion(doc, { path: 'x', heading: 'Real' });
    expect(r.text).toContain('## fake heading in fence');
    expect(r.text).not.toContain('## End');
  });
});
