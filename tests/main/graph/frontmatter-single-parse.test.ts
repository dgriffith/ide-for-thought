/**
 * A note's frontmatter is parsed once per `parseMarkdown`, not twice (#2216).
 *
 * `extractTitle` prefers a frontmatter `title:` before falling back to the
 * first H1, and it got there by calling `extractFrontmatter(content)` itself —
 * while `parseMarkdown` called `extractFrontmatter(content)` again, eleven
 * lines later, for the same string. Two full `YAML.parse` passes per note, on
 * every index pass, and boot makes three of those.
 *
 * Measured over 2,000 realistic notes (six frontmatter keys, links, headings):
 * `parseMarkdown` went from 109.4us to 58.9us each — 219ms to 118ms for the
 * corpus, per pass.
 *
 * The gate is a parse COUNT (#2229's scope note). It is exact, where a
 * millisecond figure on a shared runner is not, and it is the thing that
 * actually regresses if someone re-inlines the call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const yamlCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yaml')>();
  const parse = (...args: Parameters<typeof actual.parse>) => {
    yamlCalls.n += 1;
    return actual.parse(...args);
  };
  // `parser.ts` uses a DEFAULT import (`import YAML from 'yaml'`), so the
  // counter has to be on the default export too. A first version wrapped only
  // the named export and pointed `default` at the untouched module, which
  // counted zero — and "zero parses" reads exactly like a spectacular fix.
  return { ...actual, parse, default: { ...actual, parse } };
});

import { parseMarkdown } from '../../../src/main/graph/parser';

const withFrontmatter = `---
title: A Considered Title
tags: [alpha, beta]
aliases: [shorthand, alt-name]
status: draft
---

# A Different H1

Body with [[a-link]] and #tag.
`;

const noFrontmatter = `# Just An H1

Body with [[a-link]].
`;

beforeEach(() => { yamlCalls.n = 0; });

describe('frontmatter is parsed once (#2216)', () => {
  it('one parseMarkdown issues one YAML.parse', () => {
    parseMarkdown(withFrontmatter);
    expect(yamlCalls.n, 'the frontmatter block was parsed more than once').toBe(1);
  });

  it('a note with no frontmatter issues none', () => {
    // The regex bails before YAML is involved at all; pinned so the hoist
    // above doesn't accidentally start parsing an empty string.
    parseMarkdown(noFrontmatter);
    expect(yamlCalls.n).toBe(0);
  });

  it('scales one-per-note across a corpus', () => {
    for (let i = 0; i < 50; i++) parseMarkdown(withFrontmatter.replace('Title', `Title ${i}`));
    expect(yamlCalls.n).toBe(50);
  });
});

describe('the title still resolves the same way', () => {
  it('prefers the frontmatter title over the H1', () => {
    // The behaviour the second parse existed to produce. Passing the already
    // parsed frontmatter in must not change which of the two wins.
    expect(parseMarkdown(withFrontmatter).title).toBe('A Considered Title');
  });

  it('falls back to the first H1 when frontmatter has no title', () => {
    expect(parseMarkdown(`---\ntags: [x]\n---\n\n# H1 Wins\n`).title).toBe('H1 Wins');
  });

  it('falls back to the first H1 when there is no frontmatter at all', () => {
    expect(parseMarkdown(noFrontmatter).title).toBe('Just An H1');
  });

  it('ignores a blank or non-string frontmatter title', () => {
    // `extractTitle` guards on `typeof === 'string' && trim()`; the hoist must
    // keep both halves, or `title: 42` would start winning over the H1.
    expect(parseMarkdown(`---\ntitle: "   "\n---\n\n# Real Title\n`).title).toBe('Real Title');
    expect(parseMarkdown(`---\ntitle: 42\n---\n\n# Real Title\n`).title).toBe('Real Title');
  });

  it('is null when neither source offers one', () => {
    expect(parseMarkdown('Just body text, no heading.\n').title).toBeNull();
  });

  it('still reports the frontmatter itself, and the aliases drawn from it', () => {
    // The other consumer of the same parse — proving the single result is
    // genuinely shared rather than one caller being silently starved.
    const parsed = parseMarkdown(withFrontmatter);
    expect(parsed.frontmatter.status).toBe('draft');
    expect(parsed.aliases).toEqual(['shorthand', 'alt-name']);
  });

  it('survives malformed YAML the way it did before', () => {
    // `extractFrontmatter` swallows a parse error and returns {}. With one
    // call site instead of two that path now feeds BOTH the title fallback
    // and the frontmatter record, so it is worth pinning.
    const parsed = parseMarkdown(`---\ntitle: [unclosed\n---\n\n# Fallback\n`);
    expect(parsed.title).toBe('Fallback');
    expect(parsed.frontmatter).toEqual({});
  });
});
