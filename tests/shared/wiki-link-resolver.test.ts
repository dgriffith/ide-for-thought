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
    // Non-md notes (#1446). The csv is listed BEFORE its same-stem md twin so
    // the equivalence check also proves md-first precedence is enforced INSIDE
    // the resolvers, not by caller order.
    { relativePath: 'reports/budget.csv', isDirectory: false },
    { relativePath: 'reports/budget.md', isDirectory: false }, // same stem → md wins for bare [[budget]]
    { relativePath: 'data/records.ttl', isDirectory: false },
    { relativePath: 'scripts/run.py', isDirectory: false },
    { relativePath: 'assets/pic.png', isDirectory: false }, // non-note ext, ignored
    { relativePath: 'notes', isDirectory: true },           // dir, ignored
  ];
  const aliases = { 'rowing boat': 'notes/topic/raft.md', consensus: 'journal/raft.md' };

  const targets = [
    'notes/topic/raft', 'notes/topic/raft.md', 'raft', 'journal/raft',
    'architecture', 'notes/architecture', 'ideas-plans', 'Ideas & Plans',
    'ideas & plans', 'consensus', 'journey/consensus', 'nested/journey/consensus',
    'rowing boat', 'ROWING BOAT', 'x', 'c/x', 'b/c/x', 'nonexistent',
    '', 'raft.md', 'RAFT', 'topic/raft', 'deep/nested/journey/consensus',
    // non-md + explicit-ext + precedence targets (#1446)
    'budget', 'reports/budget', 'budget.csv', 'reports/budget.csv', 'budget.md',
    'records', 'data/records', 'records.ttl', 'run', 'scripts/run', 'run.py',
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

// ── Non-markdown note resolution (#1446) ─────────────────────────────────────
describe('resolveWikiLinkTarget — non-markdown notes (#1446)', () => {
  it('resolves a bare link to a .csv / .ttl / .py note', () => {
    const f = [{ relativePath: 'reports/budget.csv', isDirectory: false }];
    expect(resolveWikiLinkTarget('budget', f)).toBe('reports/budget.csv');
    expect(resolveWikiLinkTarget('reports/budget', f)).toBe('reports/budget.csv');

    const t = [{ relativePath: 'data/records.ttl', isDirectory: false }];
    expect(resolveWikiLinkTarget('records', t)).toBe('data/records.ttl');

    const p = [{ relativePath: 'scripts/run.py', isDirectory: false }];
    expect(resolveWikiLinkTarget('run', p)).toBe('scripts/run.py');
  });

  it('prefers .md when a bare link collides across extensions (md-first)', () => {
    // csv listed first — precedence must come from noteExtRank, not order.
    const f = [
      { relativePath: 'reports/budget.csv', isDirectory: false },
      { relativePath: 'reports/budget.md', isDirectory: false },
    ];
    expect(resolveWikiLinkTarget('budget', f)).toBe('reports/budget.md');
  });

  it('honors an explicit extension over precedence (regression guard)', () => {
    const f = [
      { relativePath: 'reports/budget.csv', isDirectory: false },
      { relativePath: 'reports/budget.md', isDirectory: false },
    ];
    // [[budget.csv]] must reach the CSV even though budget.md exists.
    expect(resolveWikiLinkTarget('budget.csv', f)).toBe('reports/budget.csv');
    expect(resolveWikiLinkTarget('reports/budget.csv', f)).toBe('reports/budget.csv');
    // …and the index fast-path agrees.
    const idx = buildWikiLinkIndex(f);
    expect(resolveWikiLinkTargetWithIndex('budget.csv', idx)).toBe('reports/budget.csv');
  });
});
