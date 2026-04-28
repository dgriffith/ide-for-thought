import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import {
  buildAutoTagPrompt,
  parseAutoTagResponse,
  mergeTagsIntoContent,
  removeTagsFromContent,
  extractTagsFromContent,
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

describe('extractTagsFromContent', () => {
  it('returns the tags array verbatim when present', () => {
    const content = '---\ntags:\n  - alpha\n  - beta\n---\nbody\n';
    expect(extractTagsFromContent(content)).toEqual(['alpha', 'beta']);
  });
  it('returns [] when there is no frontmatter', () => {
    expect(extractTagsFromContent('plain body\n')).toEqual([]);
  });
  it('returns [] when frontmatter exists but has no tags key', () => {
    expect(extractTagsFromContent('---\ntitle: x\n---\nbody\n')).toEqual([]);
  });
  it('returns [] when tags is not an array', () => {
    expect(extractTagsFromContent('---\ntags: alpha\n---\nbody\n')).toEqual([]);
  });
  it('drops non-string entries from the tags array', () => {
    const content = '---\ntags:\n  - alpha\n  - 42\n  - beta\n---\nbody\n';
    expect(extractTagsFromContent(content)).toEqual(['alpha', 'beta']);
  });
  it('returns [] on malformed YAML rather than throwing', () => {
    // The frontmatter regex matches but YAML.parse rejects it.
    expect(extractTagsFromContent('---\ntags: [a, b\n---\nbody\n')).toEqual([]);
  });
});

describe('removeTagsFromContent', () => {
  it('removes a tag (case-insensitive) and reports it', () => {
    const content = '---\ntitle: Note\ntags:\n  - alpha\n  - Beta\n---\nbody\n';
    const out = removeTagsFromContent(content, ['BETA']);
    expect(out.removedTags).toEqual(['Beta']);
    const fm = YAML.parse(out.content.match(/^---\n([\s\S]*?)\n---/)![1]);
    expect(fm.tags).toEqual(['alpha']);
    expect(fm.title).toBe('Note');
  });

  it('drops the tags key entirely when the last tag is removed', () => {
    const content = '---\ntitle: Note\ntags:\n  - only-one\n---\nbody\n';
    const out = removeTagsFromContent(content, ['only-one']);
    expect(out.removedTags).toEqual(['only-one']);
    expect(out.content).not.toMatch(/^tags:/m);
    expect(out.content).toMatch(/title: Note/);
  });

  it('drops the whole frontmatter block when removing the last tag leaves it empty', () => {
    // tags was the only key — losing it strands the block, so we drop it
    // entirely rather than leaving a `---\n---` artifact on disk.
    const content = '---\ntags:\n  - solo\n---\nbody text\n';
    const out = removeTagsFromContent(content, ['solo']);
    expect(out.content).toBe('body text\n');
  });

  it('returns content unchanged when the tag is not present', () => {
    const content = '---\ntags:\n  - alpha\n---\nbody\n';
    const out = removeTagsFromContent(content, ['missing']);
    expect(out.removedTags).toEqual([]);
    expect(out.content).toBe(content);
  });

  it('returns content unchanged when there is no frontmatter', () => {
    const out = removeTagsFromContent('bare body\n', ['anything']);
    expect(out.removedTags).toEqual([]);
    expect(out.content).toBe('bare body\n');
  });

  it('preserves other frontmatter keys', () => {
    const content = '---\ntitle: T\nauthor: me\ntags:\n  - drop\n  - keep\n---\nbody\n';
    const out = removeTagsFromContent(content, ['drop']);
    const fm = YAML.parse(out.content.match(/^---\n([\s\S]*?)\n---/)![1]);
    expect(fm.title).toBe('T');
    expect(fm.author).toBe('me');
    expect(fm.tags).toEqual(['keep']);
  });
});
