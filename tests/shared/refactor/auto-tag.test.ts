import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import {
  buildAutoTagPrompt,
  parseAutoTagResponse,
  mergeTagsIntoContent,
} from '../../../src/shared/refactor/auto-tag';

describe('buildAutoTagPrompt (issue #174)', () => {
  it('includes the existing thoughtbase vocabulary so the LLM can reuse it', () => {
    const prompt = buildAutoTagPrompt({
      noteTitle: 'On Fusion',
      noteBody: 'Fusion reactors use magnetic confinement...',
      existingNoteTags: [],
      thoughtbaseTags: ['physics', 'energy', 'plasma'],
    });
    expect(prompt).toContain('- physics');
    expect(prompt).toContain('- energy');
    expect(prompt).toContain('- plasma');
  });

  it('lists the note\u2019s current tags under "do not repeat"', () => {
    const prompt = buildAutoTagPrompt({
      noteTitle: 'x',
      noteBody: 'body',
      existingNoteTags: ['already-here'],
      thoughtbaseTags: [],
    });
    expect(prompt).toMatch(/do not repeat[\s\S]*already-here/i);
  });

  it('states the requested cap', () => {
    const prompt = buildAutoTagPrompt({
      noteTitle: '', noteBody: '', existingNoteTags: [], thoughtbaseTags: [], cap: 3,
    });
    expect(prompt).toContain('up to **3**');
  });
});

describe('parseAutoTagResponse', () => {
  it('extracts bare kebab-case tags, one per line', () => {
    expect(parseAutoTagResponse('machine-learning\ncognitive-bias\nalgorithmic-transparency'))
      .toEqual(['machine-learning', 'cognitive-bias', 'algorithmic-transparency']);
  });

  it('tolerates leading hyphens, bullets, numbers, backticks, and stray whitespace', () => {
    const raw = [
      '- machine-learning',
      '* cognitive-bias',
      '1. algorithmic-transparency',
      '  `fusion-power` ',
      '\u2022 nuclear-physics',
    ].join('\n');
    expect(parseAutoTagResponse(raw)).toEqual([
      'machine-learning',
      'cognitive-bias',
      'algorithmic-transparency',
      'fusion-power',
      'nuclear-physics',
    ]);
  });

  it('drops lines that are not valid kebab-case (commentary, spaces, underscores, trailing hyphen)', () => {
    const raw = [
      'Here are some tags:',
      'machine-learning',
      'this one has spaces',
      'has_underscore',
      'ends-with-hyphen-',
    ].join('\n');
    expect(parseAutoTagResponse(raw)).toEqual(['machine-learning']);
  });

  it('lowercases mixed-case input before validating (LLMs occasionally slip)', () => {
    expect(parseAutoTagResponse('Machine-Learning\nCOGNITIVE-BIAS')).toEqual([
      'machine-learning',
      'cognitive-bias',
    ]);
  });

  it('deduplicates case-insensitively, preserving first occurrence', () => {
    expect(parseAutoTagResponse('fusion\nFusion\nfusion')).toEqual(['fusion']);
  });

  it('returns an empty array when there is nothing to extract', () => {
    expect(parseAutoTagResponse('(no tags)')).toEqual([]);
    expect(parseAutoTagResponse('')).toEqual([]);
  });
});

describe('mergeTagsIntoContent', () => {
  it('creates a frontmatter block when the note has none', () => {
    const out = mergeTagsIntoContent('# Title\n\nbody\n', ['alpha', 'beta']);
    expect(out.addedTags).toEqual(['alpha', 'beta']);
    expect(out.content).toMatch(/^---\n[\s\S]*tags:[\s\S]*---\n/);
    const fm = YAML.parse(out.content.match(/^---\n([\s\S]*?)\n---/)![1]);
    expect(fm.tags).toEqual(['alpha', 'beta']);
    expect(out.content).toContain('# Title');
    expect(out.content).toContain('body');
  });

  it('appends to an existing tags array without duplicates (case-insensitive)', () => {
    const content = [
      '---',
      'title: Foo',
      'tags:',
      '  - physics',
      '  - Energy',
      '---',
      '',
      'body',
      '',
    ].join('\n');
    const out = mergeTagsIntoContent(content, ['energy', 'plasma']);
    expect(out.addedTags).toEqual(['plasma']);
    const fm = YAML.parse(out.content.match(/^---\n([\s\S]*?)\n---/)![1]);
    expect(fm.tags).toEqual(['physics', 'Energy', 'plasma']);
  });

  it('preserves other frontmatter keys when merging', () => {
    const content = [
      '---',
      'title: Note',
      'created: 2026-04-20',
      'author: me',
      '---',
      '',
      'body',
    ].join('\n');
    const out = mergeTagsIntoContent(content, ['tag-one']);
    const fm = YAML.parse(out.content.match(/^---\n([\s\S]*?)\n---/)![1]);
    expect(fm.title).toBe('Note');
    expect(fm.author).toBe('me');
    expect(fm.tags).toEqual(['tag-one']);
  });

  it('returns content unchanged when every suggested tag already exists', () => {
    const content = '---\ntags:\n  - alpha\n  - beta\n---\nbody\n';
    const out = mergeTagsIntoContent(content, ['alpha', 'BETA']);
    expect(out.addedTags).toEqual([]);
    expect(out.content).toBe(content);
  });

  it('returns content unchanged when no tags are supplied', () => {
    const content = 'bare body\n';
    const out = mergeTagsIntoContent(content, []);
    expect(out.addedTags).toEqual([]);
    expect(out.content).toBe(content);
  });

  it('preserves the note body after the frontmatter', () => {
    const out = mergeTagsIntoContent('# Title\n\nFirst para.\n\nSecond para.\n', ['one']);
    expect(out.content).toContain('# Title');
    expect(out.content).toContain('First para.');
    expect(out.content).toContain('Second para.');
  });
});
