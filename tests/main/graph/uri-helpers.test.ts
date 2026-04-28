import { describe, it, expect } from 'vitest';
import { coinBaseUri, noteUri, tagUri, folderUri, projectUri, sourceUri, excerptUri } from '../../../src/main/graph/uri-helpers';

const BASE = 'https://project.minerva.dev/testuser/sample-project/';

describe('coinBaseUri', () => {
  it('generates expected URL structure', () => {
    const uri = coinBaseUri('/Users/testuser/my-project');
    expect(uri).toMatch(/^https:\/\/project\.minerva\.dev\/.+\/my-project\/$/);
  });

  it('handles spaces in project name', () => {
    const uri = coinBaseUri('/Users/testuser/My Project');
    expect(uri).toContain('my-project');
    expect(uri).not.toContain(' ');
  });

  it('ends with trailing slash', () => {
    const uri = coinBaseUri('/Users/testuser/test');
    expect(uri).toMatch(/\/$/);
  });
});

describe('noteUri', () => {
  it('strips .md extension', () => {
    const uri = noteUri(BASE, 'notes/architecture.md');
    expect(uri).toBe(`${BASE}note/notes/architecture`);
  });

  it('works without .md extension', () => {
    const uri = noteUri(BASE, 'readme');
    expect(uri).toBe(`${BASE}note/readme`);
  });

  it('preserves path structure', () => {
    const uri = noteUri(BASE, 'research/papers/lambda-calculus.md');
    expect(uri).toBe(`${BASE}note/research/papers/lambda-calculus`);
  });

  it('encodes spaces and punctuation in path segments (regression: NamedNode IRI must not contain unencoded spaces)', () => {
    // The user hit this when a propose_notes draft included a child note
    // titled "Sets, Functions, and the Need for Types" — rdflib refuses to
    // mint a NamedNode for an IRI with a literal space.
    const uri = noteUri(BASE, 'notes/learning-journeys/type-theory/Sets, Functions, and the Need for Types.md');
    expect(uri).toBe(
      `${BASE}note/notes/learning-journeys/type-theory/${encodeURIComponent('Sets, Functions, and the Need for Types')}`,
    );
    expect(uri).not.toMatch(/ /);
  });

  it('encodes Unicode and other special characters segment-by-segment', () => {
    const uri = noteUri(BASE, 'notes/topics/Curry–Howard correspondence.md');
    expect(uri).toContain(`${BASE}note/notes/topics/`);
    expect(uri).not.toMatch(/ /);
    expect(uri).not.toMatch(/–/);
  });
});

describe('tagUri', () => {
  it('encodes simple tag', () => {
    const uri = tagUri(BASE, 'architecture');
    expect(uri).toBe(`${BASE}tag/architecture`);
  });

  it('encodes slash-tags', () => {
    const uri = tagUri(BASE, 'cs/type-theory');
    expect(uri).toBe(`${BASE}tag/${encodeURIComponent('cs/type-theory')}`);
  });
});

describe('folderUri', () => {
  it('maps relative path to URI', () => {
    const uri = folderUri(BASE, 'research/papers');
    expect(uri).toBe(`${BASE}folder/research/papers`);
  });

  it('encodes spaces in folder segments', () => {
    const uri = folderUri(BASE, 'research/Type Theory Papers');
    expect(uri).toBe(`${BASE}folder/research/${encodeURIComponent('Type Theory Papers')}`);
    expect(uri).not.toMatch(/ /);
  });
});

describe('projectUri', () => {
  it('removes trailing slash from base', () => {
    const uri = projectUri(BASE);
    expect(uri).toBe(BASE.replace(/\/$/, ''));
  });
});

describe('sourceUri', () => {
  it('maps a simple id to a source URI', () => {
    const uri = sourceUri(BASE, 'smith-2023');
    expect(uri).toBe(`${BASE}source/smith-2023`);
  });

  it('encodes unsafe characters in the id', () => {
    const uri = sourceUri(BASE, 'arxiv/2401.12345');
    expect(uri).toBe(`${BASE}source/${encodeURIComponent('arxiv/2401.12345')}`);
  });
});

describe('excerptUri', () => {
  it('maps a simple id to an excerpt URI', () => {
    const uri = excerptUri(BASE, 'smith-2023-p42');
    expect(uri).toBe(`${BASE}excerpt/smith-2023-p42`);
  });

  it('encodes unsafe characters in the id', () => {
    const uri = excerptUri(BASE, 'doc/quote#1');
    expect(uri).toBe(`${BASE}excerpt/${encodeURIComponent('doc/quote#1')}`);
  });
});
