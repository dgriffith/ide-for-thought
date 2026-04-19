import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  findNotesLinkingToAnchor,
  headingsFor,
} from '../../../src/main/graph/index';
import { renameAnchor } from '../../../src/main/notebase/rename-anchor';
import { rewriteAnchorInLinks } from '../../../src/main/notebase/link-rewriting';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-heading-rename-test-'));
}

function writeNote(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function readNote(root: string, relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf-8');
}

describe('heading snapshots (issue #139)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records headings after indexNote', async () => {
    await indexNote('notes/foo.md', '# Foo\n\n## Overview\n\n## Components');
    const headings = headingsFor('notes/foo.md');
    expect(headings.map((h) => h.slug).sort()).toEqual(['components', 'foo', 'overview']);
  });

  it('does not flag a rename on the first indexNote call (initial index)', async () => {
    // Pre-seed some incoming links, then first-index the target — should not prompt.
    await indexNote('other.md', 'See [[notes/foo#overview]].');
    const { headingRenameCandidate } = await indexNote('notes/foo.md', '# Foo\n\n## Overview');
    expect(headingRenameCandidate).toBeUndefined();
  });

  it('flags a single heading rename with >0 incoming anchored links', async () => {
    await indexNote('notes/foo.md', '# Foo\n\n## Overview');
    await indexNote('other.md', 'See [[notes/foo#overview]].');
    const { headingRenameCandidate } = await indexNote('notes/foo.md', '# Foo\n\n## Summary');
    expect(headingRenameCandidate).toBeDefined();
    expect(headingRenameCandidate!.oldSlug).toBe('overview');
    expect(headingRenameCandidate!.newSlug).toBe('summary');
    expect(headingRenameCandidate!.incomingLinkCount).toBe(1);
  });

  it('does not flag when there are no incoming links to the old slug', async () => {
    await indexNote('notes/foo.md', '# Foo\n\n## Overview');
    const { headingRenameCandidate } = await indexNote('notes/foo.md', '# Foo\n\n## Summary');
    expect(headingRenameCandidate).toBeUndefined();
  });

  it('does not flag ambiguous cases (multiple removals or additions)', async () => {
    await indexNote('notes/foo.md', '# Foo\n\n## A\n\n## B');
    await indexNote('other.md', '[[notes/foo#a]] [[notes/foo#b]]');
    // Rename A→X and B→Y in the same edit — ambiguous, skip.
    const { headingRenameCandidate } = await indexNote('notes/foo.md', '# Foo\n\n## X\n\n## Y');
    expect(headingRenameCandidate).toBeUndefined();
  });

  it('does not flag a pure deletion (one removal, no addition)', async () => {
    await indexNote('notes/foo.md', '# Foo\n\n## Overview');
    await indexNote('other.md', '[[notes/foo#overview]]');
    const { headingRenameCandidate } = await indexNote('notes/foo.md', '# Foo');
    expect(headingRenameCandidate).toBeUndefined();
  });

  it('ignores headings inside fenced code blocks', async () => {
    await indexNote('notes/foo.md', '# Foo\n\n```\n## Not a heading\n```\n\n## Real');
    const slugs = headingsFor('notes/foo.md').map((h) => h.slug);
    expect(slugs).toContain('real');
    expect(slugs).not.toContain('not-a-heading');
  });
});

describe('findNotesLinkingToAnchor (issue #139)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns only notes with the exact anchor', async () => {
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('a.md', '[[notes/foo#overview]]');
    await indexNote('b.md', '[[notes/foo#other]]');
    await indexNote('c.md', '[[notes/foo]]');  // no anchor

    expect(findNotesLinkingToAnchor('notes/foo.md', 'overview').sort()).toEqual(['a.md']);
    expect(findNotesLinkingToAnchor('notes/foo.md', 'other').sort()).toEqual(['b.md']);
  });
});

describe('renameAnchor integration (issue #139)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rewrites every anchored reference across the thoughtbase', async () => {
    writeNote(root, 'notes/foo.md', '# Foo\n\n## Summary');
    writeNote(root, 'a.md', 'See [[notes/foo#overview]].');
    writeNote(root, 'b.md', '[[supports::notes/foo#overview|rationale]]');
    writeNote(root, 'c.md', '[[notes/foo#unrelated]]');
    await indexNote('notes/foo.md', '# Foo\n\n## Summary');
    await indexNote('a.md', 'See [[notes/foo#overview]].');
    await indexNote('b.md', '[[supports::notes/foo#overview|rationale]]');
    await indexNote('c.md', '[[notes/foo#unrelated]]');

    const { rewrittenPaths } = await renameAnchor(root, 'notes/foo.md', 'overview', 'summary');

    expect(rewrittenPaths.sort()).toEqual(['a.md', 'b.md']);
    expect(readNote(root, 'a.md')).toContain('[[notes/foo#summary]]');
    expect(readNote(root, 'b.md')).toContain('[[supports::notes/foo#summary|rationale]]');
    // c.md had a different anchor; untouched.
    expect(readNote(root, 'c.md')).toContain('[[notes/foo#unrelated]]');
  });
});

describe('rewriteAnchorInLinks (issue #139, pure)', () => {
  it('preserves type prefix and display text', () => {
    const out = rewriteAnchorInLinks(
      '[[rebuts::notes/foo#old|see here]]',
      'notes/foo',
      'old',
      'new',
    );
    expect(out).toBe('[[rebuts::notes/foo#new|see here]]');
  });

  it('leaves block-id anchors alone when the slug form does not match', () => {
    const out = rewriteAnchorInLinks('[[notes/foo#^p3]]', 'notes/foo', 'old', 'new');
    expect(out).toBe('[[notes/foo#^p3]]');
  });

  it('preserves .md suffix when present', () => {
    const out = rewriteAnchorInLinks('[[notes/foo.md#old]]', 'notes/foo', 'old', 'new');
    expect(out).toBe('[[notes/foo.md#new]]');
  });

  it('never touches cite/quote links', () => {
    const out = rewriteAnchorInLinks('[[cite::notes/foo#old]]', 'notes/foo', 'old', 'new');
    expect(out).toBe('[[cite::notes/foo#old]]');
  });
});
