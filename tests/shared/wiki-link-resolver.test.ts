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

// ── Index-based fast path equivalence (#1473) ────────────────────────────────
// `resolveWikiLinkTargetWithIndex(target, buildWikiLinkIndex(files, aliases))`
// must return exactly what the loop-based `resolveWikiLinkTarget` returns — the
// indexer's O(N²) → O(N) fix rides on that being true for every target.
import {
  resolveWikiLinkTarget,
  buildWikiLinkIndex,
  resolveWikiLinkTargetWithIndex,
} from '../../src/shared/wiki-link-resolver';

describe('buildWikiLinkIndex / resolveWikiLinkTargetWithIndex equivalence (#1473)', () => {
  // A file set spanning every precedence step: exact path, basename collisions,
  // nested stems, punctuation/case fuzz, and path tails.
  const files = [
    { relativePath: 'notes/topic/raft.md', isDirectory: false },
    { relativePath: 'journal/raft.md', isDirectory: false },
    { relativePath: 'notes/architecture.md', isDirectory: false },
    { relativePath: 'Ideas & Plans.md', isDirectory: false },
    { relativePath: 'deep/nested/journey/consensus.md', isDirectory: false },
    { relativePath: 'a/b/c/x.md', isDirectory: false },
    { relativePath: 'x.md', isDirectory: false },
    { relativePath: 'assets/pic.png', isDirectory: false }, // non-md, ignored
    { relativePath: 'notes', isDirectory: true },           // dir, ignored
  ];
  const aliases = { 'rowing boat': 'notes/topic/raft.md', consensus: 'journal/raft.md' };

  const targets = [
    'notes/topic/raft', 'notes/topic/raft.md', 'raft', 'journal/raft',
    'architecture', 'notes/architecture', 'ideas-plans', 'Ideas & Plans',
    'ideas & plans', 'consensus', 'journey/consensus', 'nested/journey/consensus',
    'rowing boat', 'ROWING BOAT', 'x', 'c/x', 'b/c/x', 'nonexistent',
    '', 'raft.md', 'RAFT', 'topic/raft', 'deep/nested/journey/consensus',
  ];

  const index = buildWikiLinkIndex(files, aliases);

  for (const t of targets) {
    it(`matches the loop resolver for target ${JSON.stringify(t)}`, () => {
      expect(resolveWikiLinkTargetWithIndex(t, index)).toBe(resolveWikiLinkTarget(t, files, aliases));
    });
  }

  it('matches with no aliases', () => {
    const idx = buildWikiLinkIndex(files);
    for (const t of targets) {
      expect(resolveWikiLinkTargetWithIndex(t, idx)).toBe(resolveWikiLinkTarget(t, files));
    }
  });
});
