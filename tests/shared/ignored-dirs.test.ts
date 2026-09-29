/**
 * Shared directory-listing ignore policy (#1897). Consolidates four
 * byte-identical `IGNORED_DIRS` declarations and eleven inline
 * `startsWith('.') || name === 'node_modules'` checks into one module.
 */
import { describe, it, expect } from 'vitest';
import { IGNORED_DIRS, hasIgnoredSegment, isIgnoredEntry } from '../../src/shared/ignored-dirs';

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

describe('hasIgnoredSegment (#2452)', () => {
  it.each([
    '.minerva/secrets.json',
    '.minerva/conversations/c1.json',
    'notes/../.minerva/secrets.json',
    './.minerva/secrets.json',
    'notes/.git/config',
    'node_modules/x/README.md',
    'notes/.draft.md',
    '.minerva\\secrets.json',
    '..',
  ])('refuses %s', (p) => {
    expect(hasIgnoredSegment(p)).toBe(true);
  });

  it.each(['notes/a.md', './notes/a.md', 'a//b.md', 'my.minerva/x.md', 'node_modules_backup/a.md'])(
    'accepts %s',
    (p) => {
      expect(hasIgnoredSegment(p)).toBe(false);
    },
  );
});
