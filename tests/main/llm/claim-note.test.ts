/**
 * The claim-note frontmatter contract (#2237, epic #2241).
 *
 * The round-trip that actually matters — author a note here, index it, and
 * assert the health checks can see it — lives in
 * `tests/main/graph/health-checks.test.ts`, which now calls this function
 * instead of hand-copying its output. That's the guard against another #2036.
 *
 * What's left for here is the part a round-trip can't show you: the YAML has to
 * survive claim text that the model wrote, not text a test author chose. A
 * claim containing a colon, a quote mark or a newline is ordinary — every one
 * of them breaks naive `key: value` frontmatter, and a note that fails to parse
 * contributes nothing to the graph at all, silently.
 *
 * Parsed with `graph/parser.ts`'s own `parseMarkdown` rather than a standalone
 * YAML library, because that is the parser whose output actually reaches the
 * store. A frontmatter block that satisfies some other parser and not this one
 * would be a passing test and a missing note.
 */
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../../src/main/graph/parser';
import { buildClaimNoteContent } from '../../../src/main/llm/claim-note';
import type { DraftClaim } from '../../../src/shared/conversation-claims-drafts';

/** The note body, i.e. everything after the frontmatter block. */
const bodyOf = (content: string): string => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

const claim = (over: Partial<DraftClaim> = {}): DraftClaim => ({
  text: 'Remote work raises output',
  kind: 'factual',
  quote: 'Teams reported a 12% increase.',
  confidence: 0.82,
  excerptId: 'ex-abc123',
  ...over,
});

describe('frontmatter the indexer has to understand', () => {
  it('types the note so it compiles to thought:Claim', () => {
    // `type: claim` → `a types:Claim` → `rdfs:subClassOf thought:Claim`. This
    // single line is what #2036 changed and what the graph layer depends on;
    // health-checks.test.ts proves the other end of it.
    const { frontmatter: data } = parseMarkdown(buildClaimNoteContent(claim(), 'src-1'));
    expect(data.type).toBe('claim');
  });

  it('carries the claim metadata the Claim type declares', () => {
    const { frontmatter: data } = parseMarkdown(buildClaimNoteContent(claim(), 'src-1'));
    expect(data).toMatchObject({
      title: 'Remote work raises output',
      claimKind: 'factual',
      confidence: 0.82,
      'extracted-by': 'llm:extract-key-claims',
    });
  });

  it('links back to the source it was mined from', () => {
    const { frontmatter: data } = parseMarkdown(buildClaimNoteContent(claim(), 'src-1'));
    expect(data['extracted-from']).toBe('[[sources/src-1]]');
  });
});

describe('body', () => {
  it('quotes the supporting passage and anchors the excerpt', () => {
    const body = bodyOf(buildClaimNoteContent(claim(), 'src-1'));
    expect(body).toContain('# Remote work raises output');
    expect(body).toContain('> Teams reported a 12% increase.');
    expect(body).toContain('[[quote::ex-abc123]]');
  });

  it('prefixes EVERY line of a multi-line quote', () => {
    // One `>` on the first line only makes the rest body prose, which silently
    // changes what the note claims the source said.
    const body = bodyOf(buildClaimNoteContent(claim({ quote: 'First line.\nSecond line.' }), 'src-1'));
    expect(body).toContain('> First line.\n> Second line.');
  });

  it('handles CRLF quotes from a Windows-authored source', () => {
    const body = bodyOf(buildClaimNoteContent(claim({ quote: 'First.\r\nSecond.' }), 'src-1'));
    expect(body).toContain('> Second.');
    expect(body).not.toContain('\r');
  });
});

describe('model-authored text does not break the YAML', () => {
  it.each([
    ['a colon', 'Finding: output rose'],
    ['a double quote', 'They called it "a 12% lift"'],
    ['a single quote', "The team's output rose"],
    ['a leading hash', '#1 driver of output'],
    ['a newline', 'Output rose\nsharply'],
    ['a backslash', 'C:\\data raised output'],
    ['a leading dash', '- output rose'],
    ['a brace', '{output} rose'],
  ])('survives %s in the claim text', (_label, text) => {
    const { frontmatter: data } = parseMarkdown(buildClaimNoteContent(claim({ text }), 'src-1'));
    expect(data.title).toBe(text);
    expect(data.type).toBe('claim');
  });

  it('survives the same characters in the quote', () => {
    const nasty = 'He said: "it\'s up 12%"\nand left.';
    const { frontmatter: data } = parseMarkdown(buildClaimNoteContent(claim({ quote: nasty }), 'src-1'));
    expect(data['source-text']).toBe(nasty);
  });
});
