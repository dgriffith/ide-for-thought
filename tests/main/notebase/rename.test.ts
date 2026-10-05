import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, findNotesLinkingTo } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { renameWithLinkRewrites, listAllFiles, planFolderRename } from '../../../src/main/notebase/rename';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-rename-test-'));
}

function writeNote(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function readNote(root: string, relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf-8');
}

describe('renameWithLinkRewrites — file rename (issue #136)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('renames the file and rewrites a simple incoming link', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    writeNote(root, 'notes/overview.md', '# Overview\n\nSee [[notes/foo]].');
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/overview.md', '# Overview\n\nSee [[notes/foo]].');

    const { rewrittenPaths, transitions } = await renameWithLinkRewrites(
      root, 'notes/foo.md', 'archive/foo.md',
    );

    expect(fs.existsSync(path.join(root, 'notes/foo.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'archive/foo.md'))).toBe(true);
    expect(readNote(root, 'notes/overview.md')).toContain('[[archive/foo]]');
    expect(rewrittenPaths).toEqual(['notes/overview.md']);
    expect(transitions).toEqual([{ old: 'notes/foo.md', new: 'archive/foo.md' }]);
  });

  it('marks the old path as moved away BEFORE moving it, so the watcher never reports it deleted (#2594)', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    const marked: Array<{ path: string; stillThere: boolean }> = [];
    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md', {
      markPathMovedAway: (p) => marked.push({ path: p, stillThere: fs.existsSync(path.join(root, p)) }),
    });
    expect(marked).toEqual([{ path: 'notes/foo.md', stillThere: true }]);
  });

  it('emits one transition per indexable file when a folder is renamed', async () => {
    writeNote(root, 'notes/a.md', '# A');
    writeNote(root, 'notes/b.md', '# B');
    writeNote(root, 'other/overview.md', 'See [[notes/a]].');
    await indexNote(ctx, 'notes/a.md', '# A');
    await indexNote(ctx, 'notes/b.md', '# B');
    await indexNote(ctx, 'other/overview.md', 'See [[notes/a]].');

    const { transitions } = await renameWithLinkRewrites(root, 'notes', 'archive');

    const pairs = transitions.map((t) => [t.old, t.new].join(' -> ')).sort();
    expect(pairs).toEqual([
      'notes/a.md -> archive/a.md',
      'notes/b.md -> archive/b.md',
    ]);
  });

  it('preserves type prefix, display, and anchor on rewrite', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    const body = [
      '# Overview',
      'Basic [[notes/foo]].',
      'Typed [[supports::notes/foo]].',
      'Display [[notes/foo|the foo]].',
      'Anchor [[notes/foo#section]].',
      'Block  [[notes/foo#^para-3]].',
      'All    [[rebuts::notes/foo#section|see this]].',
    ].join('\n');
    writeNote(root, 'notes/overview.md', body);
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/overview.md', body);

    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md');

    const after = readNote(root, 'notes/overview.md');
    expect(after).toContain('[[archive/foo]]');
    expect(after).toContain('[[supports::archive/foo]]');
    expect(after).toContain('[[archive/foo|the foo]]');
    expect(after).toContain('[[archive/foo#section]]');
    expect(after).toContain('[[archive/foo#^para-3]]');
    expect(after).toContain('[[rebuts::archive/foo#section|see this]]');
  });

  it('updates the graph so findNotesLinkingTo now reports the NEW path', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    writeNote(root, 'notes/overview.md', 'See [[notes/foo]].');
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/overview.md', 'See [[notes/foo]].');

    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md');

    expect(findNotesLinkingTo(ctx, 'notes/foo.md')).toEqual([]);
    expect(findNotesLinkingTo(ctx, 'archive/foo.md')).toEqual(['notes/overview.md']);
  });

  it('leaves unrelated notes untouched', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    writeNote(root, 'notes/bar.md', '# Bar\n\nNothing to do with foo.');
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/bar.md', '# Bar\n\nNothing to do with foo.');

    const before = readNote(root, 'notes/bar.md');
    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md');
    expect(readNote(root, 'notes/bar.md')).toBe(before);
  });

  it('invokes reindexHook for the rewritten referrer so downstream indexes stay consistent', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    writeNote(root, 'notes/overview.md', 'See [[notes/foo]].');
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/overview.md', 'See [[notes/foo]].');

    const reindexed: string[] = [];
    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md', {
      reindexHook: (p) => { reindexed.push(p); },
    });

    expect(reindexed).toContain('archive/foo.md');
    expect(reindexed).toContain('notes/overview.md');
  });

  it('sweeps `derived_from: [[…]]` frontmatter on rename (#244)', async () => {
    // A "Save as note" landed a derived note whose frontmatter points
    // back at the source via a wiki-link. Renaming the source should
    // rewrite the derived note's `derived_from` value just like any
    // body-level [[…]] link — but pre-fix the rename pipeline only
    // walked LINK_TYPES predicates in findNotesLinkingTo, missing the
    // prov:wasDerivedFrom edge frontmatter emits.
    const sourceBody = '# Analysis\n\n```python {id=abc12345}\nprint(1)\n```\n';
    writeNote(root, 'notes/analysis.md', sourceBody);
    const derivedBody = [
      '---',
      'title: "Cell abc12345 output"',
      'derived_from: "[[notes/analysis]]"',
      'derived_from_cell: "abc12345"',
      'derived_at: "2026-04-20T00:00:00Z"',
      'tags: [derived]',
      '---',
      '',
      '# Cell output',
      '',
      '*Derived from [[notes/analysis#cell-abc12345]] on 2026-04-20.*',
    ].join('\n');
    writeNote(root, 'notes/derived/analysis-abc12345.md', derivedBody);
    await indexNote(ctx, 'notes/analysis.md', sourceBody);
    await indexNote(ctx, 'notes/derived/analysis-abc12345.md', derivedBody);

    await renameWithLinkRewrites(root, 'notes/analysis.md', 'archive/analysis.md');

    const rewritten = readNote(root, 'notes/derived/analysis-abc12345.md');
    // The frontmatter wiki-link target follows the rename:
    expect(rewritten).toContain('derived_from: "[[archive/analysis]]"');
    // …and so does the body backlink:
    expect(rewritten).toContain('[[archive/analysis#cell-abc12345]]');
    // The cell-id stays put — rename doesn't perturb the anchor itself.
    expect(rewritten).toContain('derived_from_cell: "abc12345"');
  });

  it('sweeps alias-form links so incoming [[alias]] triples re-resolve to the new path (#494)', async () => {
    // The referring note links via an alias (not a path), so the
    // text rewriter has nothing to change. The bug pre-#494 was that
    // the referrer's `linksTo` triple stayed pointed at the OLD note
    // URI until the referrer was independently re-saved. After the
    // fix, the rename sweep reindexes alias-referring notes so their
    // triples follow the rename.
    writeNote(root, 'presidents/kennedy.md', '---\naliases: [JFK]\n---\n# John F. Kennedy');
    writeNote(root, 'notes/overview.md', 'See [[JFK]] for context.');
    await indexNote(ctx, 'presidents/kennedy.md', '---\naliases: [JFK]\n---\n# John F. Kennedy');
    await indexNote(ctx, 'notes/overview.md', 'See [[JFK]] for context.');

    // Sanity: pre-rename the overview links to the kennedy note.
    expect(findNotesLinkingTo(ctx, 'presidents/kennedy.md')).toEqual(['notes/overview.md']);

    const before = readNote(root, 'notes/overview.md');
    await renameWithLinkRewrites(root, 'presidents/kennedy.md', 'archive/kennedy.md');

    // The overview's body must not have been rewritten — the link
    // text is still `[[JFK]]`, just resolved differently.
    expect(readNote(root, 'notes/overview.md')).toBe(before);
    // But the graph now reflects the new target.
    expect(findNotesLinkingTo(ctx, 'archive/kennedy.md')).toEqual(['notes/overview.md']);
    expect(findNotesLinkingTo(ctx, 'presidents/kennedy.md')).toEqual([]);
  });
});

describe('renameWithLinkRewrites — folder rename (issue #136)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rewrites every descendant path in a single pass', async () => {
    writeNote(root, 'notes/a.md', '# A');
    writeNote(root, 'notes/b.md', '# B');
    writeNote(root, 'other/overview.md', 'Links: [[notes/a]] and [[notes/b]].');
    await indexNote(ctx, 'notes/a.md', '# A');
    await indexNote(ctx, 'notes/b.md', '# B');
    await indexNote(ctx, 'other/overview.md', 'Links: [[notes/a]] and [[notes/b]].');

    await renameWithLinkRewrites(root, 'notes', 'archive');

    expect(fs.existsSync(path.join(root, 'archive/a.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'archive/b.md'))).toBe(true);
    const after = readNote(root, 'other/overview.md');
    expect(after).toContain('[[archive/a]]');
    expect(after).toContain('[[archive/b]]');
  });

  it('rewrites links inside the renamed folder too (same-folder self-reference)', async () => {
    writeNote(root, 'notes/a.md', '# A');
    writeNote(root, 'notes/overview.md', 'See [[notes/a]].');
    await indexNote(ctx, 'notes/a.md', '# A');
    await indexNote(ctx, 'notes/overview.md', 'See [[notes/a]].');

    await renameWithLinkRewrites(root, 'notes', 'archive');

    // The referring note was itself moved — read at the new location.
    expect(readNote(root, 'archive/overview.md')).toContain('[[archive/a]]');
  });
});

describe('renameWithLinkRewrites — markdown relative links (#NEW)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rewrites a markdown link in a referrer when the target file moves', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    writeNote(root, 'notes/overview.md', 'See [foo](./foo.md) for context.\n');
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/overview.md', 'See [foo](./foo.md) for context.\n');

    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md');

    expect(readNote(root, 'notes/overview.md'))
      .toBe('See [foo](../archive/foo.md) for context.\n');
  });

  it('re-relativizes outbound markdown links in a moved file', async () => {
    writeNote(root, 'notes/a.md', 'See [other](./other.md).\n');
    writeNote(root, 'notes/other.md', '# Other');
    await indexNote(ctx, 'notes/a.md', 'See [other](./other.md).\n');
    await indexNote(ctx, 'notes/other.md', '# Other');

    await renameWithLinkRewrites(root, 'notes/a.md', 'notes/sub/a.md');

    // The moved note's outbound link must still resolve to notes/other.md.
    expect(readNote(root, 'notes/sub/a.md')).toContain('[other](../other.md)');
  });

  it('rewrites image refs alongside text links', async () => {
    writeNote(root, 'assets/pic.png', 'fake-image-bytes');
    writeNote(root, 'notes/a.md', '![alt](../assets/pic.png)\n');
    await indexNote(ctx, 'notes/a.md', '![alt](../assets/pic.png)\n');

    await renameWithLinkRewrites(root, 'notes/a.md', 'archive/a.md');

    // From archive/a.md, ../assets/pic.png still works.
    expect(readNote(root, 'archive/a.md')).toContain('![alt](../assets/pic.png)');
  });

  it('moves a sibling image alongside its parent folder and keeps refs valid', async () => {
    writeNote(root, 'notes/a.md', '![alt](./pic.png)\n');
    writeNote(root, 'notes/pic.png', 'fake');
    writeNote(root, 'other/refers.md', '![](../notes/pic.png)\n');
    await indexNote(ctx, 'notes/a.md', '![alt](./pic.png)\n');
    await indexNote(ctx, 'other/refers.md', '![](../notes/pic.png)\n');

    await renameWithLinkRewrites(root, 'notes', 'archive');

    // Inside the moved folder: a.md and pic.png stayed siblings.
    expect(readNote(root, 'archive/a.md')).toContain('![alt](./pic.png)');
    // Outside: the referrer's ../notes/pic.png becomes ../archive/pic.png.
    expect(readNote(root, 'other/refers.md')).toContain('![](../archive/pic.png)');
  });

  it('leaves URL-scheme and bare-anchor links alone', async () => {
    const original =
      'See [w](https://example.com), [m](mailto:x@y.z), [a](#anchor).\n';
    writeNote(root, 'notes/a.md', original);
    await indexNote(ctx, 'notes/a.md', original);

    await renameWithLinkRewrites(root, 'notes/a.md', 'archive/a.md');

    expect(readNote(root, 'archive/a.md')).toBe(original);
  });
});

describe('listAllFiles — the rewrites-map walker (#1897)', () => {
  let root: string;

  beforeEach(() => { root = mkTempProject(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  // This walker used to check only `startsWith('.')`, missing the
  // node_modules exclusion every sibling project-tree walker has — a
  // thoughtbase with a stray node_modules would get every file inside it
  // dragged into the markdown-rewrites map on any folder move.
  it('skips node_modules like every other project-tree walker', async () => {
    writeNote(root, 'notes/a.md', '# A');
    writeNote(root, 'node_modules/pkg/index.js', 'module.exports = {};');

    const files = await listAllFiles(root, '');

    expect(files).toContain('notes/a.md');
    expect(files).not.toContain('node_modules/pkg/index.js');
  });
});

describe('renameWithLinkRewrites — links that RESOLVED to the note, however spelled (#2456)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Write + index, in call order — which is the resolver's tie-break order. */
  async function seed(relPath: string, content: string): Promise<void> {
    writeNote(root, relPath, content);
    await indexNote(ctx, relPath, content);
  }

  // The two counterexamples fast-check shrank to in the property test.
  it('rewrites a basename-with-extension link when the basename changes: [[foo.md]]', async () => {
    await seed('notes/foo.md', '# Foo');
    await seed('notes/ref.md', 'See [[foo.md]].');

    await renameWithLinkRewrites(root, 'notes/foo.md', 'notes/bar.md');

    expect(readNote(root, 'notes/ref.md')).toBe('See [[bar.md]].');
    expect(findNotesLinkingTo(ctx, 'notes/bar.md')).toEqual(['notes/ref.md']);
  });

  it('rewrites a spaced basename link moved to another folder: [[Foo Bar.md]]', async () => {
    await seed('notes/deep/Foo Bar.md', '# Foo Bar');
    await seed('notes/ref.md', 'See [[Foo Bar.md]] and [[Foo Bar]].');

    await renameWithLinkRewrites(root, 'notes/deep/Foo Bar.md', 'elsewhere/renamed note.md');

    expect(readNote(root, 'notes/ref.md')).toBe('See [[renamed note.md]] and [[renamed note]].');
  });

  it('rewrites a slug-resolved link as a basename', async () => {
    await seed('notes/deep/Foo Bar.md', '# Foo Bar');
    await seed('notes/ref.md', 'See [[foo bar]].');

    await renameWithLinkRewrites(root, 'notes/deep/Foo Bar.md', 'elsewhere/renamed note.md');

    expect(readNote(root, 'notes/ref.md')).toBe('See [[renamed note]].');
  });

  it('leaves a basename link alone when a move keeps the basename', async () => {
    await seed('notes/foo.md', '# Foo');
    await seed('notes/ref.md', 'See [[foo]] and [[notes/foo]].');

    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md');

    expect(readNote(root, 'notes/ref.md')).toBe('See [[foo]] and [[archive/foo]].');
    expect(findNotesLinkingTo(ctx, 'archive/foo.md')).toEqual(['notes/ref.md']);
  });

  it('keeps type, anchor, display text and embeds on a basename link', async () => {
    await seed('notes/foo.md', '# Foo\n\n## Section\n\npara ^blk');
    const body = [
      'Typed [[supports::foo]].',
      'Anchored [[foo#Section]] and [[foo#^blk]].',
      'Displayed [[foo|the foo]].',
      'All [[rebuts::foo.md#Section|see this]].',
      'Embed ![[foo#^blk]].',
    ].join('\n');
    await seed('notes/ref.md', body);

    await renameWithLinkRewrites(root, 'notes/foo.md', 'notes/bar.md');

    expect(readNote(root, 'notes/ref.md')).toBe([
      'Typed [[supports::bar]].',
      'Anchored [[bar#Section]] and [[bar#^blk]].',
      'Displayed [[bar|the foo]].',
      'All [[rebuts::bar.md#Section|see this]].',
      'Embed ![[bar#^blk]].',
    ].join('\n'));
  });

  it('falls back to the path when the new basename is ambiguous', async () => {
    await seed('archive/bar.md', '# The other bar');
    await seed('notes/foo.md', '# Foo');
    await seed('notes/ref.md', 'See [[foo]] and [[foo.md]].');

    await renameWithLinkRewrites(root, 'notes/foo.md', 'notes/bar.md');

    // `[[bar]]` could mean either note, depending on scan order — so the
    // link names the folder, which only the renamed note answers to.
    expect(readNote(root, 'notes/ref.md')).toBe('See [[notes/bar]] and [[notes/bar.md]].');
    expect(findNotesLinkingTo(ctx, 'notes/bar.md')).toEqual(['notes/ref.md']);
  });

  it("re-spells OTHER notes' links that the rename would make ambiguous (reverse case)", async () => {
    await seed('c/foo.md', '# The existing foo');
    await seed('a/x.md', '# X');
    await seed('notes/ref.md', 'See [[foo]] and [[x]].');

    await renameWithLinkRewrites(root, 'a/x.md', 'b/foo.md');

    // `[[foo]]` meant c/foo.md. With b/foo.md arriving, the answer would
    // depend on which of the two the resolver scans first: insertion order
    // in this session, directory order after a rebuild (which flips it). So
    // it is pinned to the note it meant.
    expect(readNote(root, 'notes/ref.md')).toBe('See [[c/foo]] and [[b/foo]].');
    expect(findNotesLinkingTo(ctx, 'c/foo.md')).toEqual(['notes/ref.md']);
    expect(findNotesLinkingTo(ctx, 'b/foo.md')).toEqual(['notes/ref.md']);
  });

  it('leaves a same-basename link that resolved to a DIFFERENT note alone', async () => {
    await seed('c/foo.md', '# The foo the link means');
    await seed('notes/foo.md', '# Another foo');
    await seed('notes/ref.md', 'See [[foo]].');
    // Tie-break: c/foo.md was indexed first, so [[foo]] resolves to it.
    expect(findNotesLinkingTo(ctx, 'c/foo.md')).toEqual(['notes/ref.md']);

    await renameWithLinkRewrites(root, 'notes/foo.md', 'notes/bar.md');

    expect(readNote(root, 'notes/ref.md')).toBe('See [[foo]].');
    expect(findNotesLinkingTo(ctx, 'c/foo.md')).toEqual(['notes/ref.md']);
  });

  it('leaves an alias link alone even when the basename changes', async () => {
    await seed('presidents/kennedy.md', '---\naliases: [JFK]\n---\n# John F. Kennedy');
    await seed('notes/ref.md', 'See [[JFK]].');

    await renameWithLinkRewrites(root, 'presidents/kennedy.md', 'presidents/jfk-35.md');

    expect(readNote(root, 'notes/ref.md')).toBe('See [[JFK]].');
    expect(findNotesLinkingTo(ctx, 'presidents/jfk-35.md')).toEqual(['notes/ref.md']);
  });

  it('does not touch links inside code spans or fences', async () => {
    await seed('notes/foo.md', '# Foo');
    await seed('notes/ref.md', 'Live [[foo]], code `[[foo]]`, fence:\n```\n[[foo]]\n```\n');

    await renameWithLinkRewrites(root, 'notes/foo.md', 'notes/bar.md');

    expect(readNote(root, 'notes/ref.md')).toBe('Live [[bar]], code `[[foo]]`, fence:\n```\n[[foo]]\n```\n');
  });

  it('rewrites links to a non-md note (#1446)', async () => {
    await seed('data/budget.csv', 'item,cost\nrent,100\n');
    await seed('notes/ref.md', 'See [[budget]], [[budget.csv]] and [[data/budget.csv]].');

    await renameWithLinkRewrites(root, 'data/budget.csv', 'data/costs.csv');

    expect(readNote(root, 'notes/ref.md')).toBe('See [[costs]], [[costs.csv]] and [[data/costs.csv]].');
  });

  it('rewrites frontmatter wiki-links through the same rewriter (#1351)', async () => {
    await seed('notes/foo.md', '# Foo');
    await seed('notes/claim.md', '---\nsupports: "[[foo]]"\nrelated: "[[supports::foo#Section]]"\n---\n# Claim');
    expect(findNotesLinkingTo(ctx, 'notes/foo.md')).toEqual(['notes/claim.md']);

    await renameWithLinkRewrites(root, 'notes/foo.md', 'notes/bar.md');

    expect(readNote(root, 'notes/claim.md')).toBe(
      '---\nsupports: "[[bar]]"\nrelated: "[[supports::bar#Section]]"\n---\n# Claim',
    );
    expect(findNotesLinkingTo(ctx, 'notes/bar.md')).toEqual(['notes/claim.md']);
  });

  it('rewrites a self-link inside the renamed note', async () => {
    await seed('notes/foo.md', '# Foo\n\nBack to [[foo#top]].');

    await renameWithLinkRewrites(root, 'notes/foo.md', 'notes/bar.md');

    expect(readNote(root, 'notes/bar.md')).toBe('# Foo\n\nBack to [[bar#top]].');
  });

  it('folder move: basename links survive and path links follow', async () => {
    await seed('inbox/b.md', '# B');
    await seed('inbox/note.md', 'Sibling [[b]] and [[inbox/b]].');
    await seed('ref.md', 'Out [[b]] and [[inbox/b.md]].');

    await renameWithLinkRewrites(root, 'inbox', 'archive/inbox');

    expect(readNote(root, 'archive/inbox/note.md')).toBe('Sibling [[b]] and [[archive/inbox/b]].');
    expect(readNote(root, 'ref.md')).toBe('Out [[b]] and [[archive/inbox/b.md]].');
    expect(findNotesLinkingTo(ctx, 'archive/inbox/b.md').sort()).toEqual(['archive/inbox/note.md', 'ref.md']);
  });

  it('folder rename: a renamed descendant reachable only by a partial path is re-spelled', async () => {
    await seed('projects/alpha/plan.md', '# Plan');
    await seed('ref.md', 'See [[alpha/plan]].');

    await renameWithLinkRewrites(root, 'projects/alpha', 'projects/beta');

    // `alpha/plan` reached the note by path-suffix slug; `beta/plan` does now.
    expect(readNote(root, 'ref.md')).toBe('See [[beta/plan]].');
  });
});

describe('renameWithLinkRewrites — folder-scoped views follow the folder (#2535)', () => {
  let root: string;
  let ctx: ProjectContext;
  const view = (folder: string) => `# Plan\n\n\`\`\`object-view\n{"typeId":"place","layout":"map","folder":"${folder}"}\n\`\`\`\n`;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
    writeNote(root, 'trip/prague/Kampa.md', '# Kampa');
    writeNote(root, 'trip/prague/old town/Clock.md', '# Clock');
    writeNote(root, 'trip/prague-old/Gone.md', '# Gone');
    writeNote(root, 'views/Prague map.md', view('trip/prague'));
    writeNote(root, 'views/Old town.md', view('trip/prague/old town'));
    writeNote(root, 'views/Sibling.md', view('trip/prague-old'));
    writeNote(root, 'trip/prague/Inside.md', view('trip/prague')); // a view saved inside the folder it scopes
    for (const p of ['trip/prague/Kampa.md', 'trip/prague/old town/Clock.md', 'trip/prague-old/Gone.md', 'views/Prague map.md', 'views/Old town.md', 'views/Sibling.md', 'trip/prague/Inside.md']) {
      await indexNote(ctx, p, readNote(root, p));
    }
  });

  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('rename: rewrites the folder in every view under it, reports them, and names the folder', async () => {
    const { rewrittenPaths, folder } = await renameWithLinkRewrites(root, 'trip/prague', 'trip/praha');
    expect(readNote(root, 'views/Prague map.md')).toBe(view('trip/praha'));
    expect(readNote(root, 'views/Old town.md')).toBe(view('trip/praha/old town'));
    expect(readNote(root, 'trip/praha/Inside.md')).toBe(view('trip/praha'));
    expect(readNote(root, 'views/Sibling.md')).toBe(view('trip/prague-old')); // shared prefix, left alone
    expect(rewrittenPaths).toEqual(expect.arrayContaining(['views/Prague map.md', 'views/Old town.md']));
    expect(rewrittenPaths).not.toContain('views/Sibling.md');
    expect(folder).toEqual({ old: 'trip/prague', new: 'trip/praha' });
  });

  it('move: a parent moving carries nested scopes with it', async () => {
    await renameWithLinkRewrites(root, 'trip', 'archive/2026');
    expect(readNote(root, 'views/Prague map.md')).toBe(view('archive/2026/prague'));
    expect(readNote(root, 'views/Old town.md')).toBe(view('archive/2026/prague/old town'));
    expect(readNote(root, 'views/Sibling.md')).toBe(view('archive/2026/prague-old'));
  });

  it('planFolderRename previews the same view rewrite, writing nothing — what a proposal shows and rolls back', async () => {
    const plan = await planFolderRename(root, 'trip/prague', 'trip/praha');
    const mapNote = plan.affectedNotes.find((n) => n.path === 'views/Prague map.md');
    expect(mapNote).toMatchObject({ before: view('trip/prague'), after: view('trip/praha'), isMoved: false });
    expect(plan.affectedNotes.find((n) => n.path === 'views/Sibling.md')).toBeUndefined();
    expect(readNote(root, 'views/Prague map.md')).toBe(view('trip/prague')); // nothing written
  });

  it('a note rename never touches view folders, and reports no folder', async () => {
    const before = readNote(root, 'views/Prague map.md');
    const { folder } = await renameWithLinkRewrites(root, 'trip/prague/Kampa.md', 'trip/prague/Kampa Museum.md');
    expect(readNote(root, 'views/Prague map.md')).toBe(before);
    expect(folder).toBeUndefined();
  });
});
