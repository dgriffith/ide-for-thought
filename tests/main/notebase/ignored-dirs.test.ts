/**
 * Shared directory-listing ignore policy (#1897). Consolidates four
 * byte-identical `IGNORED_DIRS` declarations and eleven inline
 * `startsWith('.') || name === 'node_modules'` checks into one module.
 */
import { describe, it, expect } from 'vitest';
import { IGNORED_DIRS, isIgnoredEntry } from '../../../src/main/notebase/ignored-dirs';

describe('IGNORED_DIRS', () => {
  it('matches the four names CLAUDE.md documents', () => {
    expect([...IGNORED_DIRS].sort()).toEqual(['.git', '.minerva', '.obsidian', 'node_modules']);
  });
});

describe('isIgnoredEntry', () => {
  it.each(['.git', '.minerva', '.obsidian', 'node_modules'])('ignores %s', (name) => {
    expect(isIgnoredEntry(name)).toBe(true);
  });

  it.each(['.hidden', '.DS_Store', '.obsidian.bak'])('ignores any dot-prefixed name (%s)', (name) => {
    expect(isIgnoredEntry(name)).toBe(true);
  });

  it.each(['notes', 'a.md', 'node_modules_backup', 'my-node_modules'])('keeps everything else (%s)', (name) => {
    expect(isIgnoredEntry(name)).toBe(false);
  });
});
