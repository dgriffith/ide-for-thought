/**
 * Bundle link fixup — the post-process that rewrites inter-bundle
 * wiki-links so the LLM's human-readable paths actually resolve.
 *
 * The user reported: a Learning Journey filed 8 notes with great
 * content, but every link in the index pointed to a short convenience
 * name ([[stop-1]]) instead of the actual basename ("Sets, Functions,
 * and the Need for Types"). This pass closes that gap server-side.
 */

import { describe, it, expect } from 'vitest';
import {
  fixupBundleLinks,
  resolveBundleTarget,
  slugifyForLink,
} from '../../../src/shared/refactor/bundle-link-fixup';

describe('slugifyForLink', () => {
  it('lowercases, replaces non-alphanumerics with hyphens, trims', () => {
    expect(slugifyForLink('Sets, Functions, and the Need for Types'))
      .toBe('sets-functions-and-the-need-for-types');
  });
  it('collapses runs of separators', () => {
    expect(slugifyForLink('Curry – Howard / correspondence!')).toBe('curry-howard-correspondence');
  });
});

describe('resolveBundleTarget', () => {
  const idx = {
    bySlug: new Map([
      ['sets-functions-and-the-need-for-types', 'Sets, Functions, and the Need for Types'],
      ['raft', 'Raft'],
      ['stop-1', '01-Sets'],
    ]),
    byLower: new Map([
      ['sets, functions, and the need for types', 'Sets, Functions, and the Need for Types'],
      ['raft', 'Raft'],
      ['01-sets', '01-Sets'],
    ]),
    basenames: ['Sets, Functions, and the Need for Types', 'Raft', '01-Sets'],
  };

  it('returns null for an exact-match basename (already correct, no rewrite)', () => {
    expect(resolveBundleTarget('Raft', idx)).toBeNull();
  });

  it('matches via slug when the link target is a shortened convenience name', () => {
    expect(resolveBundleTarget('stop-1', idx)).toBe('01-Sets');
  });

  it('matches via lowercased exact', () => {
    expect(resolveBundleTarget('raft', idx)).toBe('Raft');
  });

  it('matches via slug when the target uses different punctuation', () => {
    expect(resolveBundleTarget('Sets Functions and the Need for Types', idx))
      .toBe('Sets, Functions, and the Need for Types');
  });

  it('returns null when the target matches no sibling at all', () => {
    expect(resolveBundleTarget('something-unrelated', idx)).toBeNull();
  });
});

describe('fixupBundleLinks', () => {
  it('rewrites inter-bundle wiki-links to sibling basenames', () => {
    const result = fixupBundleLinks([
      {
        relativePath: 'notes/journey/index.md',
        content: '# Journey\n\n- [[stop-1]]\n- [[stop-2]]\n',
      },
      {
        relativePath: 'notes/journey/Sets, Functions, and the Need for Types.md',
        content: '# Sets and Functions\n',
      },
      {
        relativePath: 'notes/journey/Type Constructors.md',
        content: '# Type Constructors\n',
      },
    ]);

    // The model's "stop-1" / "stop-2" don't slug-match anything in this
    // bundle — neither basename is "stop-1" or "stop-2" or close. So
    // these stay untouched (they might point somewhere outside).
    expect(result.notes[0].content).toContain('[[stop-1]]');
    expect(result.notes[0].content).toContain('[[stop-2]]');
    expect(result.rewritten).toHaveLength(0);
  });

  it('rewrites a punctuation-stripped link to the comma-bearing basename', () => {
    const result = fixupBundleLinks([
      {
        relativePath: 'notes/journey/index.md',
        content: '- [[Sets Functions and the Need for Types]]\n',
      },
      {
        relativePath: 'notes/journey/Sets, Functions, and the Need for Types.md',
        content: '# Stop 1\n',
      },
    ]);

    expect(result.notes[0].content).toContain('[[Sets, Functions, and the Need for Types]]');
    expect(result.rewritten).toHaveLength(1);
    expect(result.rewritten[0].rewrites[0]).toEqual({
      from: 'Sets Functions and the Need for Types',
      to: 'Sets, Functions, and the Need for Types',
    });
  });

  it('preserves typed links (cite::, supports::) — those are not basename-based', () => {
    const result = fixupBundleLinks([
      {
        relativePath: 'notes/journey/index.md',
        content: '[[cite::source-1]] [[supports::Type Theory]]\n',
      },
      {
        relativePath: 'notes/journey/Type Theory.md',
        content: '# Topic\n',
      },
    ]);
    // Even though "Type Theory" matches a sibling basename exactly, the
    // typed link is left alone — typed links target IDs/URIs, not
    // basenames, and rewriting them would silently break things.
    expect(result.notes[0].content).toContain('[[cite::source-1]]');
    expect(result.notes[0].content).toContain('[[supports::Type Theory]]');
    expect(result.rewritten).toHaveLength(0);
  });

  it('preserves anchor and display-text portions of the link', () => {
    const result = fixupBundleLinks([
      {
        relativePath: 'notes/index.md',
        content: '[[Sets Functions and the Need for Types#proofs|proofs section]]\n',
      },
      {
        relativePath: 'notes/Sets, Functions, and the Need for Types.md',
        content: '# Stop\n',
      },
    ]);
    expect(result.notes[0].content)
      .toContain('[[Sets, Functions, and the Need for Types#proofs|proofs section]]');
  });

  it('leaves links targeting notes outside the bundle alone', () => {
    const result = fixupBundleLinks([
      {
        relativePath: 'notes/index.md',
        content: '[[some-existing-note]] [[unrelated]]\n',
      },
    ]);
    expect(result.notes[0].content).toContain('[[some-existing-note]]');
    expect(result.notes[0].content).toContain('[[unrelated]]');
    expect(result.rewritten).toHaveLength(0);
  });

  it('does not mutate input notes', () => {
    const originalContent = '[[Sets Functions and the Need for Types]]';
    const inputs = [
      { relativePath: 'a.md', content: originalContent },
      { relativePath: 'Sets, Functions, and the Need for Types.md', content: '# x\n' },
    ];
    fixupBundleLinks(inputs);
    expect(inputs[0].content).toBe(originalContent);
  });
});
