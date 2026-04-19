import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, findNotesLinkingTo } from '../../../src/main/graph/index';
import { renameWithLinkRewrites } from '../../../src/main/notebase/rename';

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

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('renames the file and rewrites a simple incoming link', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    writeNote(root, 'notes/overview.md', '# Overview\n\nSee [[notes/foo]].');
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('notes/overview.md', '# Overview\n\nSee [[notes/foo]].');

    const { rewrittenPaths, transitions } = await renameWithLinkRewrites(
      root, 'notes/foo.md', 'archive/foo.md',
    );

    expect(fs.existsSync(path.join(root, 'notes/foo.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'archive/foo.md'))).toBe(true);
    expect(readNote(root, 'notes/overview.md')).toContain('[[archive/foo]]');
    expect(rewrittenPaths).toEqual(['notes/overview.md']);
    expect(transitions).toEqual([{ old: 'notes/foo.md', new: 'archive/foo.md' }]);
  });

  it('emits one transition per indexable file when a folder is renamed', async () => {
    writeNote(root, 'notes/a.md', '# A');
    writeNote(root, 'notes/b.md', '# B');
    writeNote(root, 'other/overview.md', 'See [[notes/a]].');
    await indexNote('notes/a.md', '# A');
    await indexNote('notes/b.md', '# B');
    await indexNote('other/overview.md', 'See [[notes/a]].');

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
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('notes/overview.md', body);

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
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('notes/overview.md', 'See [[notes/foo]].');

    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md');

    expect(findNotesLinkingTo('notes/foo.md')).toEqual([]);
    expect(findNotesLinkingTo('archive/foo.md')).toEqual(['notes/overview.md']);
  });

  it('leaves unrelated notes untouched', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    writeNote(root, 'notes/bar.md', '# Bar\n\nNothing to do with foo.');
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('notes/bar.md', '# Bar\n\nNothing to do with foo.');

    const before = readNote(root, 'notes/bar.md');
    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md');
    expect(readNote(root, 'notes/bar.md')).toBe(before);
  });

  it('invokes reindexHook for the rewritten referrer so downstream indexes stay consistent', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    writeNote(root, 'notes/overview.md', 'See [[notes/foo]].');
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('notes/overview.md', 'See [[notes/foo]].');

    const reindexed: string[] = [];
    await renameWithLinkRewrites(root, 'notes/foo.md', 'archive/foo.md', {
      reindexHook: (p) => { reindexed.push(p); },
    });

    expect(reindexed).toContain('archive/foo.md');
    expect(reindexed).toContain('notes/overview.md');
  });
});

describe('renameWithLinkRewrites — folder rename (issue #136)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rewrites every descendant path in a single pass', async () => {
    writeNote(root, 'notes/a.md', '# A');
    writeNote(root, 'notes/b.md', '# B');
    writeNote(root, 'other/overview.md', 'Links: [[notes/a]] and [[notes/b]].');
    await indexNote('notes/a.md', '# A');
    await indexNote('notes/b.md', '# B');
    await indexNote('other/overview.md', 'Links: [[notes/a]] and [[notes/b]].');

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
    await indexNote('notes/a.md', '# A');
    await indexNote('notes/overview.md', 'See [[notes/a]].');

    await renameWithLinkRewrites(root, 'notes', 'archive');

    // The referring note was itself moved — read at the new location.
    expect(readNote(root, 'archive/overview.md')).toContain('[[archive/a]]');
  });
});
