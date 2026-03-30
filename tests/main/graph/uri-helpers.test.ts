import { describe, it, expect } from 'vitest';
import { coinBaseUri, noteUri, tagUri, folderUri, projectUri } from '../../../src/main/graph/uri-helpers';

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
});

describe('projectUri', () => {
  it('removes trailing slash from base', () => {
    const uri = projectUri(BASE);
    expect(uri).toBe(BASE.replace(/\/$/, ''));
  });
});
