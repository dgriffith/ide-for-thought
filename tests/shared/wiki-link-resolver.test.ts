import { describe, it, expect } from 'vitest';
import { isNotePath } from '../../src/shared/note-extensions';
import { canonicalizeWikiLinkTarget, noteTargetPathBeside } from '../../src/shared/wiki-link-resolver';

describe('noteTargetPathBeside (#1446 create-note path)', () => {
  it('creates beside a root note', () => {
    expect(noteTargetPathBeside('a.md', 'budget')).toBe('budget.md');
  });
  it('creates in the referencing note\'s folder', () => {
    expect(noteTargetPathBeside('topic/deep/a.md', 'Concept X')).toBe('topic/deep/Concept X.md');
  });
  it('drops any path + note extension from the target, keeps the basename', () => {
    expect(noteTargetPathBeside('topic/a.md', 'sub/budget.csv')).toBe('topic/budget.md');
  });
  it('strips an #anchor from the target', () => {
    expect(noteTargetPathBeside('topic/a.md', 'budget#totals')).toBe('topic/budget.md');
  });
});

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
    // Non-note files, named explicitly. Without these the equivalence check
    // below never asks the one question that distinguishes a filtered file
    // list from a raw one, and passes vacuously (#2210).
    'pic', 'pic.png', 'assets/pic.png',
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

  it('a note-extension-filtered file list resolves identically to the raw one (#2210)', () => {
    // The claim #2210 §3b rests on. The preview had TWO sources for the same
    // question: the transclusion pass fetched the raw `listFiles()` tree over
    // IPC on every render tick, while the typed-card and broken-link passes
    // used the already-in-memory `flattenNotePaths()` list, which keeps only
    // note extensions. Sharing one index between them is only safe if those
    // two inputs are interchangeable.
    //
    // They are, and the reason is worth stating rather than trusting: BOTH
    // resolvers funnel through `orderedNoteFiles`, which applies the same
    // `isNotePath` filter internally. So a `.png` in the raw tree was never a
    // candidate — passing it in was work with no effect on the answer. If
    // that internal filter is ever relaxed, this fails, which is the point.
    const noteOnly = files.filter((f) => !f.isDirectory && isNotePath(f.relativePath));
    expect(noteOnly.length, 'the fixture must contain some non-note entries to filter')
      .toBeLessThan(files.length);

    const filteredIndex = buildWikiLinkIndex(noteOnly, aliases);
    for (const t of targets) {
      expect(
        resolveWikiLinkTargetWithIndex(t, filteredIndex),
        `filtering non-note files changed the answer for ${JSON.stringify(t)}`,
      ).toBe(resolveWikiLinkTarget(t, files, aliases));
    }
  });

  it('an embed naming a non-note file resolves to nothing either way', () => {
    // The case a reader will reach for as the counter-example: `![[pic.png]]`
    // on its own line does become a transclusion placeholder. It resolved to
    // null before this change and resolves to null after it — the image never
    // reached the resolver's candidate set.
    for (const t of ['pic.png', 'assets/pic.png', 'pic']) {
      expect(resolveWikiLinkTarget(t, files, aliases)).toBeNull();
      expect(resolveWikiLinkTargetWithIndex(t, index)).toBeNull();
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
