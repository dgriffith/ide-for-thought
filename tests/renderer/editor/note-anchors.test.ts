import { describe, it, expect } from 'vitest';
import { extractAnchors } from '../../../src/renderer/lib/editor/note-anchors';

describe('extractAnchors', () => {
  it('extracts ATX headings with slugs', () => {
    const { headings } = extractAnchors('# Foo\n\n## Components & Parts\n\n### Nested');
    expect(headings.map((h) => h.slug)).toEqual(['foo', 'components-parts', 'nested']);
  });

  it('includes heading level and original text', () => {
    const { headings } = extractAnchors('## Hello World');
    expect(headings[0]).toEqual({ slug: 'hello-world', text: 'Hello World', level: 2 });
  });

  it('deduplicates repeated heading slugs, keeping the first', () => {
    const { headings } = extractAnchors('# Foo\n\n## Foo');
    expect(headings.map((h) => h.slug)).toEqual(['foo']);
  });

  it('skips headings inside fenced code blocks', () => {
    const { headings } = extractAnchors('# Real\n\n```\n## fake\n```\n\n## Also Real');
    expect(headings.map((h) => h.slug)).toEqual(['real', 'also-real']);
  });

  it('extracts block ids from paragraph-end markers', () => {
    const { blockIds } = extractAnchors('A paragraph. ^para-1\nAnother one. ^para-2');
    expect(blockIds).toEqual(['para-1', 'para-2']);
  });

  it('deduplicates block ids', () => {
    const { blockIds } = extractAnchors('First. ^dup\n\nSecond. ^dup');
    expect(blockIds).toEqual(['dup']);
  });
});
