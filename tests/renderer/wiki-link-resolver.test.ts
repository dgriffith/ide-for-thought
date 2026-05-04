/**
 * Wiki-link target resolver — turns whatever the user wrote inside
 * `[[…]]` into an actual project-relative .md path. Mirrors the
 * fallback ladder used by App.handleNavigate.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveWikiLinkTarget,
  flattenNoteFiles,
} from '../../src/renderer/lib/wiki-link-resolver';
import type { NoteFile } from '../../src/shared/types';

const tree: NoteFile[] = [
  {
    name: 'notes',
    relativePath: 'notes',
    isDirectory: true,
    children: [
      {
        name: 'topic',
        relativePath: 'notes/topic',
        isDirectory: true,
        children: [
          {
            name: 'journey',
            relativePath: 'notes/topic/journey',
            isDirectory: true,
            children: [
              { name: 'Raft.md', relativePath: 'notes/topic/journey/Raft.md', isDirectory: false },
              {
                name: 'Sets, Functions, and the Need for Types.md',
                relativePath: 'notes/topic/journey/Sets, Functions, and the Need for Types.md',
                isDirectory: false,
              },
            ],
          },
        ],
      },
      { name: 'standalone.md', relativePath: 'notes/standalone.md', isDirectory: false },
    ],
  },
];

describe('flattenNoteFiles', () => {
  it('walks directories recursively and returns only files', () => {
    const flat = flattenNoteFiles(tree);
    expect(flat.map((f) => f.relativePath).sort()).toEqual([
      'notes/standalone.md',
      'notes/topic/journey/Raft.md',
      'notes/topic/journey/Sets, Functions, and the Need for Types.md',
    ]);
  });
});

describe('resolveWikiLinkTarget', () => {
  const flat = flattenNoteFiles(tree);

  it('matches an exact full relativePath (with or without .md)', () => {
    expect(resolveWikiLinkTarget('notes/topic/journey/Raft', flat))
      .toBe('notes/topic/journey/Raft.md');
    expect(resolveWikiLinkTarget('notes/topic/journey/Raft.md', flat))
      .toBe('notes/topic/journey/Raft.md');
  });

  it('matches a bare basename (case-sensitive)', () => {
    expect(resolveWikiLinkTarget('Raft', flat))
      .toBe('notes/topic/journey/Raft.md');
  });

  it('matches a basename via slug (case + punctuation fuzzy)', () => {
    expect(resolveWikiLinkTarget('raft', flat))
      .toBe('notes/topic/journey/Raft.md');
    expect(resolveWikiLinkTarget('Sets Functions and the Need for Types', flat))
      .toBe('notes/topic/journey/Sets, Functions, and the Need for Types.md');
  });

  it('matches a path-suffix-style target via full-stem slug', () => {
    expect(resolveWikiLinkTarget('topic/journey/raft', flat))
      .toBe('notes/topic/journey/Raft.md');
  });

  it('returns null when nothing matches', () => {
    expect(resolveWikiLinkTarget('does-not-exist', flat)).toBeNull();
  });

  it('handles a target containing a comma exactly', () => {
    expect(resolveWikiLinkTarget('Sets, Functions, and the Need for Types', flat))
      .toBe('notes/topic/journey/Sets, Functions, and the Need for Types.md');
  });

  describe('alias resolution (#469)', () => {
    const aliases = { jfk: 'notes/topic/journey/Raft.md', 'jack kennedy': 'notes/topic/journey/Raft.md' };

    it('resolves a frontmatter alias to its underlying note', () => {
      expect(resolveWikiLinkTarget('JFK', flat, aliases))
        .toBe('notes/topic/journey/Raft.md');
    });

    it('alias matching is case-insensitive', () => {
      expect(resolveWikiLinkTarget('jack kennedy', flat, aliases))
        .toBe('notes/topic/journey/Raft.md');
    });

    it('exact relativePath wins over a colliding alias', () => {
      // The alias map shouldn't shadow a real note that exists at the
      // typed path. Caller passes a map but Raft.md still beats anything.
      expect(resolveWikiLinkTarget('notes/topic/journey/Raft', flat, aliases))
        .toBe('notes/topic/journey/Raft.md');
    });

    it('falls through to slug matching when no alias hits', () => {
      expect(resolveWikiLinkTarget('raft', flat, aliases))
        .toBe('notes/topic/journey/Raft.md');
    });

    it('returns null when neither files nor aliases match', () => {
      expect(resolveWikiLinkTarget('UnknownAlias', flat, aliases)).toBeNull();
    });
  });
});
