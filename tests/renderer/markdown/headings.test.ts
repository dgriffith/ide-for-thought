/**
 * Heading extraction + cursor → active-chain (#476).
 *
 * Locks in the contract shared by OutlinePanel (right-sidebar) and
 * BreadcrumbsBar (above-editor cursor chain).
 */

import { describe, it, expect } from 'vitest';
import { extractHeadings, activeHeadingChain } from '../../../src/renderer/lib/markdown/headings';

describe('extractHeadings', () => {
  it('parses ATX headings at every level (1–6)', () => {
    const src = [
      '# H1',
      '## H2',
      '### H3',
      '#### H4',
      '##### H5',
      '###### H6',
    ].join('\n');
    const out = extractHeadings(src);
    expect(out).toEqual([
      { level: 1, text: 'H1', line: 1 },
      { level: 2, text: 'H2', line: 2 },
      { level: 3, text: 'H3', line: 3 },
      { level: 4, text: 'H4', line: 4 },
      { level: 5, text: 'H5', line: 5 },
      { level: 6, text: 'H6', line: 6 },
    ]);
  });

  it('records 1-based line numbers — matches CodeMirror', () => {
    const src = '\n\n# First\n\n## Second\n';
    const out = extractHeadings(src);
    expect(out.map((h) => h.line)).toEqual([3, 5]);
  });

  it('ignores lines that look like headings but aren\'t (no space after #)', () => {
    const src = ['#NotHeading', '# Real', '#### Also real'].join('\n');
    const out = extractHeadings(src);
    expect(out.map((h) => h.text)).toEqual(['Real', 'Also real']);
  });

  it('trims trailing whitespace and inline trailing space from heading text', () => {
    const src = '## Title with trailing space   ';
    const out = extractHeadings(src);
    expect(out[0].text).toBe('Title with trailing space');
  });

  it('ignores 7+ hashes (CommonMark caps ATX at 6)', () => {
    const src = '####### Not a heading';
    const out = extractHeadings(src);
    expect(out).toEqual([]);
  });

  it('returns an empty list for prose with no headings', () => {
    const out = extractHeadings('just\nsome\nparagraphs');
    expect(out).toEqual([]);
  });
});

describe('activeHeadingChain', () => {
  const sample = extractHeadings([
    '# Root',                  // 1
    '',                        // 2
    'intro prose',             // 3
    '## Background',           // 4
    'background prose',        // 5
    '### Prior work',          // 6
    'prior work prose',        // 7
    '### Current state',       // 8
    'current state prose',     // 9
    '## Method',               // 10
    'method prose',            // 11
  ].join('\n'));

  it('returns empty when cursor sits before the first heading', () => {
    expect(activeHeadingChain(sample, 0)).toEqual([]);
    // Just above # Root — same result.
  });

  it('returns the H1 alone when cursor is in its body', () => {
    const chain = activeHeadingChain(sample, 3);
    expect(chain.map((h) => h.text)).toEqual(['Root']);
  });

  it('builds the parent chain for a deeper heading', () => {
    const chain = activeHeadingChain(sample, 7);
    expect(chain.map((h) => h.text)).toEqual(['Root', 'Background', 'Prior work']);
  });

  it('switches sibling without dragging the previous one along', () => {
    const chain = activeHeadingChain(sample, 9);
    expect(chain.map((h) => h.text)).toEqual(['Root', 'Background', 'Current state']);
  });

  it('drops back up the tree at a shallower sibling', () => {
    // Cursor inside Method (H2) — Background's children disappear.
    const chain = activeHeadingChain(sample, 11);
    expect(chain.map((h) => h.text)).toEqual(['Root', 'Method']);
  });

  it('returns the heading itself when cursor sits ON the heading line', () => {
    const chain = activeHeadingChain(sample, 6);
    expect(chain.map((h) => h.text)).toEqual(['Root', 'Background', 'Prior work']);
  });

  it('handles a document that skips a level (## directly under #)', () => {
    const skipped = extractHeadings([
      '# A',
      '',
      '### C',  // jumps from H1 to H3
      '',
    ].join('\n'));
    const chain = activeHeadingChain(skipped, 4);
    // Build the chain conservatively: take the strictly-shallower
    // ancestors we find. Missing levels are not synthesized.
    expect(chain.map((h) => h.text)).toEqual(['A', 'C']);
  });
});
