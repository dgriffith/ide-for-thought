import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../../src/main/graph/parser';

// Fixture content is inlined rather than read from
// `tests/fixtures/sample-project/` so this test stays deterministic
// when someone opens the sample-project in the dev app and edits notes
// (#344). The arXiv PDF fixture used by ingest-pdf / drop-import is
// content-hashed so it doesn't share this risk.

const ARCHITECTURE_MD = `---
title: "Architecture Overview"
description: "System architecture for the project"
created: "2025-06-15T10:00:00Z"
status: draft
---

# Architecture

The system #architecture uses a layered approach.

This [[supports::notes/design-patterns]] and [[expands::research/overview]].
It also [[references::research/papers/lambda-calculus|Lambda Calculus paper]].

## Components

[[cite::arxiv-2604.18522]]
The core #component layer handles data flow.

\`\`\`turtle
this: minerva:meta-complexity "high" .
this: minerva:meta-priority "1" .

@prefix arch: <https://minerva.dev/ontology#architecture/> .
arch:LayeredPattern rdf:type minerva:Concept .
arch:LayeredPattern dc:description "Separates concerns into distinct layers" .
\`\`\`

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| UI | Svelte 5 | Reactive rendering |
| Editor | CodeMirror 6 | Text editing |
| Graph | RDFLib + N3 | Knowledge representation |
| Query | Comunica | SPARQL execution |
| Storage | Git | Version control |

\`\`\`python
# This [[fake-link]] inside a code block should be ignored
x = "[[also-not-a-link]]"
\`\`\`
`;

const EMPTY_NOTE_MD = '';

const TYPE_THEORY_MD = `---
title: "Type Theory Survey"
created: "2025-03-20T14:00:00Z"
---

A survey of #cs/type-theory and #research approaches.

This [[supersedes::research/overview]] with more recent findings.
This is [[related-to::research/papers/lambda-calculus]].

\`\`\`turtle
@prefix bib: <http://purl.org/ontology/bibo/> .
this: bib:authorList "Church, Pierce, Wadler" .
this: bib:doi "10.1145/example" .
this: dc:date "2025-03-20" .
\`\`\`
`;

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

  describe('nested tags (#466)', () => {
    it('extracts a 3-segment nested tag as one entry', () => {
      const result = parseMarkdown('See #projects/minerva/ui body');
      expect(result.tags).toContain('projects/minerva/ui');
    });

    it('strips a trailing slash', () => {
      const result = parseMarkdown('Pending: #projects/ tag');
      expect(result.tags).toContain('projects');
      expect(result.tags).not.toContain('projects/');
    });

    it('rejects tags with empty segments (#a//b)', () => {
      const result = parseMarkdown('Bad: #foo//bar tag');
      expect(result.tags).not.toContain('foo//bar');
      expect(result.tags).not.toContain('foo');
      expect(result.tags).not.toContain('bar');
    });

    it('rejects tags whose segment starts with a non-letter', () => {
      const result = parseMarkdown('Bad: #foo/1bar tag');
      expect(result.tags).not.toContain('foo/1bar');
      expect(result.tags).not.toContain('foo');
    });

    it('keeps a valid sibling on the same line as a malformed nested tag', () => {
      const result = parseMarkdown('Mix #foo//bad and #good/path here');
      expect(result.tags).toContain('good/path');
    });
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

  it('splits off a heading anchor', () => {
    const result = parseMarkdown('See [[notes/foo#components]].');
    expect(result.links[0]).toEqual({
      target: 'notes/foo',
      type: 'references',
      displayText: undefined,
      anchor: 'components',
    });
  });

  it('splits off a block-id anchor preserving the ^ prefix', () => {
    const result = parseMarkdown('See [[notes/foo#^p4]].');
    expect(result.links[0]).toEqual({
      target: 'notes/foo',
      type: 'references',
      displayText: undefined,
      anchor: '^p4',
    });
  });

  it('handles typed-link + anchor + display together', () => {
    const result = parseMarkdown('[[supports::notes/foo#c|see here]]');
    expect(result.links[0]).toEqual({
      target: 'notes/foo',
      type: 'supports',
      displayText: 'see here',
      anchor: 'c',
    });
  });

  it('treats same-target different-anchor as distinct links', () => {
    const result = parseMarkdown('[[notes/foo#a]] and [[notes/foo#b]]');
    expect(result.links).toHaveLength(2);
    expect(result.links[0].anchor).toBe('a');
    expect(result.links[1].anchor).toBe('b');
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

  it('parses inline YAML lists', () => {
    const result = parseMarkdown('---\ntags: [foo, bar, baz]\n---');
    expect(result.frontmatter.tags).toEqual(['foo', 'bar', 'baz']);
  });

  it('parses block-style YAML lists', () => {
    const result = parseMarkdown('---\ntags:\n  - foo\n  - bar\n---');
    expect(result.frontmatter.tags).toEqual(['foo', 'bar']);
  });

  it('preserves typed scalars (numbers, booleans)', () => {
    const result = parseMarkdown('---\npages: 42\ndraft: true\nratio: 3.14\n---');
    expect(result.frontmatter.pages).toBe(42);
    expect(result.frontmatter.draft).toBe(true);
    expect(result.frontmatter.ratio).toBe(3.14);
  });

  it('keeps ISO dates as strings at parse time (indexer coerces to xsd:date)', () => {
    // yaml v2 follows YAML 1.2, which doesn't auto-parse timestamps; the
    // indexer recognizes the ISO shape and emits an xsd:date literal.
    const result = parseMarkdown('---\ncreated: 2024-01-15\n---');
    expect(result.frontmatter.created).toBe('2024-01-15');
  });

  it('survives malformed YAML gracefully (returns empty)', () => {
    const result = parseMarkdown('---\nkey: [unclosed\n---');
    expect(result.frontmatter).toEqual({});
  });

  it('drops nested objects (no sensible predicate mapping)', () => {
    const result = parseMarkdown('---\nauthor:\n  name: Ada\n  orcid: 0000\n---');
    expect(result.frontmatter.author).toBeUndefined();
  });
});

// ── Fixture integration tests ───────────────────────────────────────────────

describe('fixture: architecture.md', () => {
  const result = parseMarkdown(ARCHITECTURE_MD);

  it('extracts frontmatter title over H1', () => {
    expect(result.title).toBe('Architecture Overview');
  });

  it('extracts tags', () => {
    expect(result.tags).toContain('architecture');
    expect(result.tags).toContain('component');
  });

  it('extracts typed links', () => {
    const supports = result.links.find((l) => l.type === 'supports');
    expect(supports?.target).toBe('notes/design-patterns');
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
  const result = parseMarkdown(EMPTY_NOTE_MD);

  it('handles empty content gracefully', () => {
    expect(result.title).toBeNull();
    expect(result.tags).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.frontmatter).toEqual({});
  });
});

describe('fixture: type-theory.md', () => {
  const result = parseMarkdown(TYPE_THEORY_MD);

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

// ── Table extraction ───────────────────────────────────────────────────────

describe('table extraction', () => {
  it('extracts a simple table', () => {
    const md = '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |';
    const result = parseMarkdown(md);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].headers).toEqual(['Name', 'Age']);
    expect(result.tables[0].rows).toEqual([['Alice', '30'], ['Bob', '25']]);
  });

  it('extracts multiple tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |\n\nSome text\n\n| X | Y |\n|---|---|\n| 3 | 4 |';
    const result = parseMarkdown(md);
    expect(result.tables).toHaveLength(2);
    expect(result.tables[0].headers).toEqual(['A', 'B']);
    expect(result.tables[1].headers).toEqual(['X', 'Y']);
  });

  it('returns empty array when no tables', () => {
    const result = parseMarkdown('# Just a heading\n\nNo tables here');
    expect(result.tables).toEqual([]);
  });

  it('ignores tables inside code blocks', () => {
    const md = '```\n| A | B |\n|---|---|\n| 1 | 2 |\n```';
    const result = parseMarkdown(md);
    expect(result.tables).toEqual([]);
  });

  it('handles tables with alignment markers', () => {
    const md = '| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |';
    const result = parseMarkdown(md);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].headers).toEqual(['Left', 'Center', 'Right']);
    expect(result.tables[0].rows).toEqual([['a', 'b', 'c']]);
  });

  it('trims whitespace from cells', () => {
    const md = '|  Name  |  Value  |\n|--------|--------|\n|  foo   |  bar   |';
    const result = parseMarkdown(md);
    expect(result.tables[0].rows[0]).toEqual(['foo', 'bar']);
  });
});
