import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMarkdown } from '../../../src/main/graph/parser';

const FIXTURE_DIR = path.join(__dirname, '../../fixtures/sample-project');

function readFixture(relativePath: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, relativePath), 'utf-8');
}

// ── Title extraction ────────────────────────────────────────────────────────

describe('title extraction', () => {
  it('extracts title from frontmatter', () => {
    const result = parseMarkdown('---\ntitle: My Title\n---\n# Heading');
    expect(result.title).toBe('My Title');
  });

  it('extracts quoted frontmatter title', () => {
    const result = parseMarkdown('---\ntitle: "Quoted Title"\n---\ncontent');
    expect(result.title).toBe('Quoted Title');
  });

  it('falls back to first H1 when no frontmatter title', () => {
    const result = parseMarkdown('# First Heading\n\nSome content');
    expect(result.title).toBe('First Heading');
  });

  it('returns null when no title found', () => {
    const result = parseMarkdown('Just some content without a title');
    expect(result.title).toBeNull();
  });

  it('returns null for empty content', () => {
    const result = parseMarkdown('');
    expect(result.title).toBeNull();
  });
});

// ── Tag extraction ──────────────────────────────────────────────────────────

describe('tag extraction', () => {
  it('extracts simple tags', () => {
    const result = parseMarkdown('This has #foo and #bar tags');
    expect(result.tags).toContain('foo');
    expect(result.tags).toContain('bar');
  });

  it('extracts tags at start of line', () => {
    const result = parseMarkdown('#solo');
    expect(result.tags).toContain('solo');
  });

  it('extracts slash-tags', () => {
    const result = parseMarkdown('A #cs/type-theory tag');
    expect(result.tags).toContain('cs/type-theory');
  });

  it('deduplicates tags', () => {
    const result = parseMarkdown('#dup and #dup again');
    expect(result.tags.filter((t) => t === 'dup')).toHaveLength(1);
  });

  it('does not extract tags from code blocks', () => {
    const result = parseMarkdown('```\n#not-a-tag\n```\n#real-tag');
    expect(result.tags).not.toContain('not-a-tag');
    expect(result.tags).toContain('real-tag');
  });

  it('does not extract tags from inline code', () => {
    const result = parseMarkdown('This `#not-a-tag` is code, but #real is not');
    expect(result.tags).not.toContain('not-a-tag');
    expect(result.tags).toContain('real');
  });

  it('returns empty array when no tags', () => {
    const result = parseMarkdown('No tags here');
    expect(result.tags).toEqual([]);
  });
});

// ── Link extraction ─────────────────────────────────────────────────────────

describe('link extraction', () => {
  it('extracts plain wiki-links as references type', () => {
    const result = parseMarkdown('See [[target note]]');
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toEqual({
      target: 'target note',
      type: 'references',
      displayText: undefined,
    });
  });

  it('extracts plain links with display text', () => {
    const result = parseMarkdown('See [[target|shown text]]');
    expect(result.links[0].target).toBe('target');
    expect(result.links[0].displayText).toBe('shown text');
    expect(result.links[0].type).toBe('references');
  });

  it('extracts typed links', () => {
    const result = parseMarkdown('This [[supports::evidence]]');
    expect(result.links[0]).toEqual({
      target: 'evidence',
      type: 'supports',
      displayText: undefined,
    });
  });

  it('extracts typed links with display text', () => {
    const result = parseMarkdown('This [[rebuts::claim|see rebuttal]]');
    expect(result.links[0].target).toBe('claim');
    expect(result.links[0].type).toBe('rebuts');
    expect(result.links[0].displayText).toBe('see rebuttal');
  });

  it('extracts multiple link types', () => {
    const result = parseMarkdown('[[supports::a]] and [[rebuts::b]] and [[c]]');
    expect(result.links).toHaveLength(3);
    expect(result.links.map((l) => l.type)).toEqual(['supports', 'rebuts', 'references']);
  });

  it('deduplicates same type+target', () => {
    const result = parseMarkdown('[[supports::x]] and again [[supports::x]]');
    expect(result.links).toHaveLength(1);
  });

  it('keeps different types to same target as separate links', () => {
    const result = parseMarkdown('[[supports::x]] and [[rebuts::x]]');
    expect(result.links).toHaveLength(2);
  });

  it('does not extract links from code blocks', () => {
    const result = parseMarkdown('```\n[[not-a-link]]\n```\n[[real-link]]');
    expect(result.links).toHaveLength(1);
    expect(result.links[0].target).toBe('real-link');
  });

  it('returns empty array when no links', () => {
    const result = parseMarkdown('No links here');
    expect(result.links).toEqual([]);
  });
});

// ── Frontmatter extraction ──────────────────────────────────────────────────

describe('frontmatter extraction', () => {
  it('extracts key-value pairs', () => {
    const result = parseMarkdown('---\ntitle: Hello\nstatus: draft\n---');
    expect(result.frontmatter.title).toBe('Hello');
    expect(result.frontmatter.status).toBe('draft');
  });

  it('strips quotes from values', () => {
    const result = parseMarkdown('---\ntitle: "Quoted"\n---');
    expect(result.frontmatter.title).toBe('Quoted');
  });

  it('returns empty object when no frontmatter', () => {
    const result = parseMarkdown('No frontmatter here');
    expect(result.frontmatter).toEqual({});
  });
});

// ── Fixture integration tests ───────────────────────────────────────────────

describe('fixture: architecture.md', () => {
  const result = parseMarkdown(readFixture('notes/architecture.md'));

  it('extracts frontmatter title over H1', () => {
    expect(result.title).toBe('Architecture Overview');
  });

  it('extracts tags', () => {
    expect(result.tags).toContain('architecture');
    expect(result.tags).toContain('component');
  });

  it('extracts typed links', () => {
    const supports = result.links.find((l) => l.type === 'supports');
    expect(supports?.target).toBe('design-patterns');
    const expands = result.links.find((l) => l.type === 'expands');
    expect(expands?.target).toBe('research/overview');
  });

  it('extracts display text on typed links', () => {
    const ref = result.links.find((l) => l.target === 'research/papers/lambda-calculus');
    expect(ref?.displayText).toBe('Lambda Calculus paper');
  });

  it('ignores links inside code blocks', () => {
    const fakeLink = result.links.find((l) => l.target === 'fake-link');
    expect(fakeLink).toBeUndefined();
  });

  it('extracts custom frontmatter fields', () => {
    expect(result.frontmatter.description).toBe('System architecture for the project');
    expect(result.frontmatter.status).toBe('draft');
  });
});

describe('fixture: empty-note.md', () => {
  const result = parseMarkdown(readFixture('notes/empty-note.md'));

  it('handles empty content gracefully', () => {
    expect(result.title).toBeNull();
    expect(result.tags).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.frontmatter).toEqual({});
  });
});

describe('fixture: type-theory.md', () => {
  const result = parseMarkdown(readFixture('research/papers/type-theory.md'));

  it('extracts slash-tags', () => {
    expect(result.tags).toContain('cs/type-theory');
    expect(result.tags).toContain('research');
  });

  it('extracts supersedes and related-to link types', () => {
    expect(result.links.find((l) => l.type === 'supersedes')?.target).toBe('research/overview');
    expect(result.links.find((l) => l.type === 'related-to')?.target).toBe('research/papers/lambda-calculus');
  });
});

// ── Turtle block extraction ────────────────────────────────────────────────

describe('turtle block extraction', () => {
  it('extracts a single turtle block', () => {
    const result = parseMarkdown('# Note\n\nSome text\n\n```turtle\n@prefix ex: <http://example.org/> .\nex:A ex:rel ex:B .\n```\n\nMore text');
    expect(result.turtleBlocks).toHaveLength(1);
    expect(result.turtleBlocks[0]).toContain('ex:A ex:rel ex:B');
  });

  it('extracts multiple turtle blocks', () => {
    const result = parseMarkdown('```turtle\nex:A ex:r ex:B .\n```\n\nProse\n\n```turtle\nex:C ex:r ex:D .\n```');
    expect(result.turtleBlocks).toHaveLength(2);
    expect(result.turtleBlocks[0]).toContain('ex:A');
    expect(result.turtleBlocks[1]).toContain('ex:C');
  });

  it('returns empty array when no turtle blocks', () => {
    const result = parseMarkdown('# Just a normal note\n\nNo turtle here');
    expect(result.turtleBlocks).toEqual([]);
  });

  it('ignores empty turtle blocks', () => {
    const result = parseMarkdown('```turtle\n\n```');
    expect(result.turtleBlocks).toEqual([]);
  });

  it('does not extract tags or links from turtle blocks', () => {
    const result = parseMarkdown('```turtle\n# This is not a heading\n#not-a-tag\n[[not-a-link]]\n```');
    expect(result.tags).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.turtleBlocks).toHaveLength(1);
  });

  it('does not confuse other code blocks with turtle', () => {
    const result = parseMarkdown('```javascript\nconst x = 1;\n```\n\n```turtle\nex:A ex:r ex:B .\n```');
    expect(result.turtleBlocks).toHaveLength(1);
    expect(result.turtleBlocks[0]).toContain('ex:A');
  });
});
