import { describe, it, expect } from 'vitest';
import {
  extractPropertyKeysFromContent,
  setPropertyInContent,
  removePropertyFromContent,
} from '../../../src/shared/refactor/frontmatter-properties';

describe('setPropertyInContent', () => {
  it('creates a frontmatter block when the note has none', () => {
    const { content, changed } = setPropertyInContent('# Note\n\nBody', 'status', 'draft');
    expect(changed).toBe(true);
    // A blank line separates the new block from the body (same as mergeTagsIntoContent).
    expect(content).toBe('---\nstatus: draft\n---\n\n# Note\n\nBody');
  });

  it('adds a key alongside existing frontmatter, preserving the rest', () => {
    const src = '---\ntitle: T\ntags:\n  - a\n---\n# Note';
    const { content } = setPropertyInContent(src, 'status', 'draft');
    expect(content).toContain('title: T');
    expect(content).toContain('status: draft');
    expect(content).toContain('- a'); // tags untouched
  });

  it('overwrites an existing key and is a no-op when unchanged', () => {
    const src = '---\nstatus: draft\n---\n# N';
    expect(setPropertyInContent(src, 'status', 'final').content).toContain('status: final');
    const same = setPropertyInContent(src, 'status', 'draft');
    expect(same.changed).toBe(false);
    expect(same.content).toBe(src);
  });

  it('quotes a wiki-link value so it survives YAML round-trip', () => {
    const { content } = setPropertyInContent('# N', 'about', '[[some-note]]');
    // Quoted → not eaten into a nested array on re-parse.
    expect(content).toMatch(/about: "\[\[some-note\]\]"|about: '\[\[some-note\]\]'/);
  });
});

describe('removePropertyFromContent', () => {
  it('removes a key, keeping the other frontmatter', () => {
    const src = '---\ntitle: T\nstatus: draft\n---\n# N';
    const { content, removed } = removePropertyFromContent(src, 'status');
    expect(removed).toBe(true);
    expect(content).toContain('title: T');
    expect(content).not.toContain('status');
  });

  it('drops the whole block when the last key is removed', () => {
    const { content, removed } = removePropertyFromContent('---\nstatus: draft\n---\n# N', 'status');
    expect(removed).toBe(true);
    expect(content).toBe('# N');
  });

  it('is a no-op for an absent key', () => {
    const src = '---\ntitle: T\n---\n# N';
    expect(removePropertyFromContent(src, 'missing')).toEqual({ content: src, removed: false });
  });
});

describe('extractPropertyKeysFromContent', () => {
  it('lists frontmatter keys but excludes tags', () => {
    const src = '---\ntitle: T\nstatus: draft\ntags:\n  - a\n---\n# N';
    expect(extractPropertyKeysFromContent(src).sort()).toEqual(['status', 'title']);
  });

  it('returns [] when there is no frontmatter', () => {
    expect(extractPropertyKeysFromContent('# N')).toEqual([]);
  });
});
