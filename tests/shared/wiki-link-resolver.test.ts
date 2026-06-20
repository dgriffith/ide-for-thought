import { describe, it, expect } from 'vitest';
import { canonicalizeWikiLinkTarget } from '../../src/shared/wiki-link-resolver';

const files = [
  { relativePath: 'notes/topic/raft.md', isDirectory: false },
  { relativePath: 'journal/raft.md', isDirectory: false },     // basename collision with the above
  { relativePath: 'notes/architecture.md', isDirectory: false },
];

describe('canonicalizeWikiLinkTarget (#778)', () => {
  it('absolute → full-from-root stem, from any resolving form', () => {
    expect(canonicalizeWikiLinkTarget('notes/architecture', 'absolute', files)).toBe('notes/architecture');
    expect(canonicalizeWikiLinkTarget('architecture', 'absolute', files)).toBe('notes/architecture');
  });

  it('shortest → basename when unambiguous', () => {
    expect(canonicalizeWikiLinkTarget('notes/architecture', 'shortest', files)).toBe('architecture');
  });

  it('shortest auto-extends past a basename collision to a unique suffix', () => {
    // Two raft.md files — basename "raft" is ambiguous, so it must grow.
    expect(canonicalizeWikiLinkTarget('notes/topic/raft', 'shortest', files)).toBe('topic/raft');
    expect(canonicalizeWikiLinkTarget('journal/raft', 'shortest', files)).toBe('journal/raft');
  });

  it('resolves through a frontmatter alias', () => {
    const aliases = { 'arch doc': 'notes/architecture.md' };
    expect(canonicalizeWikiLinkTarget('arch doc', 'absolute', files, aliases)).toBe('notes/architecture');
  });

  it('returns null for a target that resolves to no note', () => {
    expect(canonicalizeWikiLinkTarget('does-not-exist', 'absolute', files)).toBeNull();
    expect(canonicalizeWikiLinkTarget('source-id-123', 'shortest', files)).toBeNull();
  });
});
