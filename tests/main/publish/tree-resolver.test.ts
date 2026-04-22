import { describe, it, expect } from 'vitest';
import {
  resolveTree,
  extractWikiLinkTargets,
  normalizeTarget,
} from '../../../src/main/publish/tree-resolver';

/** Minimal file system — Map<relativePath, content>. */
function mkFs(entries: Record<string, string>) {
  return async (p: string) => (p in entries ? entries[p] : null);
}

describe('extractWikiLinkTargets', () => {
  it('returns targets of plain and display-text wiki-links', () => {
    expect(extractWikiLinkTargets('See [[notes/foo]] and [[notes/bar|the other]].')).toEqual([
      'notes/foo',
      'notes/bar',
    ]);
  });

  it('strips typed-link prefixes (references::, supports::, …)', () => {
    expect(extractWikiLinkTargets('[[references::notes/baz]]')).toEqual(['notes/baz']);
  });

  it('omits cite / quote refs — those resolve via the citations path', () => {
    expect(extractWikiLinkTargets('As [[cite::smith-2023]] notes, [[quote::p42]] says…')).toEqual([]);
  });

  it('strips anchors from the target', () => {
    expect(extractWikiLinkTargets('Jump to [[notes/foo#section-2]].')).toEqual(['notes/foo']);
  });
});

describe('normalizeTarget', () => {
  it('adds .md when missing', () => {
    expect(normalizeTarget('notes/foo')).toBe('notes/foo.md');
  });
  it('leaves .md alone when present', () => {
    expect(normalizeTarget('notes/foo.md')).toBe('notes/foo.md');
  });
  it('strips leading ./ and normalizes backslashes', () => {
    expect(normalizeTarget('./notes/foo')).toBe('notes/foo.md');
    expect(normalizeTarget('notes\\foo')).toBe('notes/foo.md');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeTarget('')).toBe('');
    expect(normalizeTarget('  ')).toBe('');
  });
});

describe('resolveTree (#251)', () => {
  const notExcluded = () => ({ excluded: false as const });

  it('walks a small linear tree from the root', async () => {
    const fs = {
      'root.md': 'Root → [[a]]',
      'a.md': 'A → [[b]]',
      'b.md': 'B leaf.',
    };
    const tree = await resolveTree({
      rootNote: 'root.md',
      maxDepth: 3,
      readFile: mkFs(fs),
      extractLinks: extractWikiLinkTargets,
      isExcluded: notExcluded,
    });
    expect(tree.included.map((e) => e.relativePath)).toEqual(['root.md', 'a.md', 'b.md']);
    expect(tree.included.map((e) => e.depth)).toEqual([0, 1, 2]);
    expect(tree.excluded).toEqual([]);
    expect(tree.unresolved).toEqual([]);
  });

  it('respects maxDepth — a note at depth 4 is not included when maxDepth is 3', async () => {
    const fs = {
      'root.md': '[[d1]]',
      'd1.md': '[[d2]]',
      'd2.md': '[[d3]]',
      'd3.md': '[[d4]]',
      'd4.md': 'leaf',
    };
    const tree = await resolveTree({
      rootNote: 'root.md',
      maxDepth: 3,
      readFile: mkFs(fs),
      extractLinks: extractWikiLinkTargets,
      isExcluded: notExcluded,
    });
    expect(tree.included.map((e) => e.relativePath)).toEqual(['root.md', 'd1.md', 'd2.md', 'd3.md']);
    expect(tree.included.some((e) => e.relativePath === 'd4.md')).toBe(false);
  });

  it('handles cycles without looping', async () => {
    const fs = {
      'a.md': '[[b]]',
      'b.md': '[[c]]',
      'c.md': '[[a]] and [[b]]',
    };
    const tree = await resolveTree({
      rootNote: 'a.md',
      maxDepth: 10,
      readFile: mkFs(fs),
      extractLinks: extractWikiLinkTargets,
      isExcluded: notExcluded,
    });
    expect(tree.included.map((e) => e.relativePath)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('visits each note once even when multiple paths reach it', async () => {
    // Diamond: root → a, root → b, a → c, b → c
    const fs = {
      'root.md': '[[a]] [[b]]',
      'a.md': '[[c]]',
      'b.md': '[[c]]',
      'c.md': 'shared leaf',
    };
    const tree = await resolveTree({
      rootNote: 'root.md',
      maxDepth: 5,
      readFile: mkFs(fs),
      extractLinks: extractWikiLinkTargets,
      isExcluded: notExcluded,
    });
    const paths = tree.included.map((e) => e.relativePath);
    expect(paths).toEqual(['root.md', 'a.md', 'b.md', 'c.md']);
    // c appears at depth 2 (shorter of the two reachings is the BFS-first).
    expect(tree.included.find((e) => e.relativePath === 'c.md')?.depth).toBe(2);
  });

  it('excludes private notes with the reason surfaced in the audit', async () => {
    const fs = {
      'root.md': '[[public]] [[private/secret]]',
      'public.md': 'ok',
      'private/secret.md': 'secret',
    };
    const tree = await resolveTree({
      rootNote: 'root.md',
      maxDepth: 3,
      readFile: mkFs(fs),
      extractLinks: extractWikiLinkTargets,
      isExcluded: (p) => p.startsWith('private/')
        ? { excluded: true, reason: 'under private/' }
        : { excluded: false },
    });
    expect(tree.included.map((e) => e.relativePath)).toEqual(['root.md', 'public.md']);
    expect(tree.excluded).toEqual([
      { relativePath: 'private/secret.md', reason: 'under private/', depth: 1 },
    ]);
  });

  it('records unresolved links without aborting', async () => {
    const fs = {
      'root.md': '[[real]] [[nonexistent]]',
      'real.md': 'ok',
    };
    const tree = await resolveTree({
      rootNote: 'root.md',
      maxDepth: 3,
      readFile: mkFs(fs),
      extractLinks: extractWikiLinkTargets,
      isExcluded: notExcluded,
    });
    expect(tree.included.map((e) => e.relativePath)).toEqual(['root.md', 'real.md']);
    expect(tree.unresolved).toEqual(['nonexistent.md']);
  });

  it('throws when the root itself is missing', async () => {
    await expect(
      resolveTree({
        rootNote: 'absent.md',
        maxDepth: 3,
        readFile: mkFs({}),
        extractLinks: extractWikiLinkTargets,
        isExcluded: notExcluded,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('maxDepth 0 includes only the root', async () => {
    const fs = { 'root.md': '[[child]]', 'child.md': 'leaf' };
    const tree = await resolveTree({
      rootNote: 'root.md',
      maxDepth: 0,
      readFile: mkFs(fs),
      extractLinks: extractWikiLinkTargets,
      isExcluded: notExcluded,
    });
    expect(tree.included.map((e) => e.relativePath)).toEqual(['root.md']);
  });
});
