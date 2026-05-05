import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { mergeNotes, previewMergeNotes } from '../../../src/main/notebase/merge';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-merge-test-'));
}

function writeNote(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function readNote(root: string, relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf-8');
}

describe('mergeNotes — merge note into another (issue #464)', () => {
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

  it('appends source body to target, deletes source, rewrites incoming wiki-links', async () => {
    writeNote(root, 'notes/source.md', '# Source\n\nBody from source.');
    writeNote(root, 'notes/target.md', '# Target\n\nExisting target body.');
    writeNote(root, 'notes/refer.md', 'Read [[notes/source]] and also [[notes/target]].');
    await indexNote(ctx, 'notes/source.md', '# Source\n\nBody from source.');
    await indexNote(ctx, 'notes/target.md', '# Target\n\nExisting target body.');
    await indexNote(ctx, 'notes/refer.md', 'Read [[notes/source]] and also [[notes/target]].');

    const result = await mergeNotes(root, 'notes/source.md', 'notes/target.md');

    expect(fs.existsSync(path.join(root, 'notes/source.md'))).toBe(false);
    expect(readNote(root, 'notes/target.md')).toBe(
      '# Target\n\nExisting target body.\n\n# Source\n\nBody from source.',
    );
    expect(readNote(root, 'notes/refer.md')).toBe(
      'Read [[notes/target]] and also [[notes/target]].',
    );
    expect(result.deletedSource).toBe('notes/source.md');
    expect(result.targetPath).toBe('notes/target.md');
    expect(result.rewrittenLinks).toBe(1);
    expect(result.rewrittenPaths).toEqual(['notes/refer.md']);
    // Merge offset is target length + separator length; mergeLine is its
    // 1-based line number in the merged content.
    expect(result.mergeOffset).toBe('# Target\n\nExisting target body.'.length + 2);
    // Merged content lines: 1 "# Target", 2 "", 3 "Existing target body.",
    // 4 "" (from the \n\n separator), 5 "# Source" — the source body
    // starts on line 5.
    expect(result.mergeLine).toBe(5);
  });

  it('drops the source frontmatter on merge but preserves the target frontmatter', async () => {
    writeNote(
      root,
      'notes/source.md',
      '---\ntags: [old]\n---\n# Source\n\nBody.',
    );
    writeNote(
      root,
      'notes/target.md',
      '---\ntags: [keep]\n---\n# Target\n\nBody.',
    );
    await indexNote(ctx, 'notes/source.md', '---\ntags: [old]\n---\n# Source\n\nBody.');
    await indexNote(ctx, 'notes/target.md', '---\ntags: [keep]\n---\n# Target\n\nBody.');

    await mergeNotes(root, 'notes/source.md', 'notes/target.md');

    const merged = readNote(root, 'notes/target.md');
    // Target's frontmatter survives.
    expect(merged.startsWith('---\ntags: [keep]\n---')).toBe(true);
    // Source frontmatter is gone (no second ---) — the merged body is just
    // the source's post-frontmatter content.
    expect(merged.match(/---/g)?.length).toBe(2);
    expect(merged).toContain('# Source\n\nBody.');
    // Source's `tags: [old]` is gone — confirms frontmatter strip.
    expect(merged).not.toContain('[old]');
  });

  it('preserves alias and anchor on rewritten wiki-links', async () => {
    writeNote(root, 'notes/source.md', '# Source');
    writeNote(root, 'notes/target.md', '# Target');
    const referBody = [
      'Plain [[notes/source]].',
      'Aliased [[notes/source|see this]].',
      'Anchored [[notes/source#a-section]].',
      'Embed ![[notes/source]].',
    ].join('\n');
    writeNote(root, 'notes/refer.md', referBody);
    await indexNote(ctx, 'notes/source.md', '# Source');
    await indexNote(ctx, 'notes/target.md', '# Target');
    await indexNote(ctx, 'notes/refer.md', referBody);

    await mergeNotes(root, 'notes/source.md', 'notes/target.md');

    const after = readNote(root, 'notes/refer.md');
    expect(after).toContain('Plain [[notes/target]].');
    expect(after).toContain('Aliased [[notes/target|see this]].');
    expect(after).toContain('Anchored [[notes/target#a-section]].');
    expect(after).toContain('Embed ![[notes/target]].');
  });

  it('rejects merging a note into itself', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await expect(mergeNotes(root, 'notes/foo.md', 'notes/foo.md')).rejects.toThrow(
      /same note/i,
    );
    expect(fs.existsSync(path.join(root, 'notes/foo.md'))).toBe(true);
  });

  it('uses a configurable separator', async () => {
    writeNote(root, 'notes/source.md', 'source-body');
    writeNote(root, 'notes/target.md', 'target-body');
    await indexNote(ctx, 'notes/source.md', 'source-body');
    await indexNote(ctx, 'notes/target.md', 'target-body');

    await mergeNotes(root, 'notes/source.md', 'notes/target.md', {
      separator: '\n\n---\n\n',
    });

    expect(readNote(root, 'notes/target.md')).toBe(
      'target-body\n\n---\n\nsource-body',
    );
  });

  it('rewrites self-references inside the source body to the target', async () => {
    // Edge case: source contains `[[source]]` somewhere in its own body.
    // After merge, the merged target should not retain a stale link to
    // a now-deleted file — those references rewrite to the target.
    writeNote(root, 'notes/source.md', 'See [[notes/source]] for more.');
    writeNote(root, 'notes/target.md', '# Target');
    await indexNote(ctx, 'notes/source.md', 'See [[notes/source]] for more.');
    await indexNote(ctx, 'notes/target.md', '# Target');

    await mergeNotes(root, 'notes/source.md', 'notes/target.md');

    expect(readNote(root, 'notes/target.md')).toContain('[[notes/target]]');
    expect(readNote(root, 'notes/target.md')).not.toContain('[[notes/source]]');
  });
});

describe('previewMergeNotes — pre-flight count (issue #464)', () => {
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

  it('counts link occurrences and affected files', async () => {
    writeNote(root, 'notes/source.md', '# Source');
    writeNote(root, 'notes/target.md', '# Target');
    writeNote(root, 'notes/a.md', '[[notes/source]] and [[notes/source|alias]]');
    writeNote(root, 'notes/b.md', 'just one [[notes/source]]');
    writeNote(root, 'notes/c.md', 'no link to source here');
    await indexNote(ctx, 'notes/source.md', '# Source');
    await indexNote(ctx, 'notes/target.md', '# Target');
    await indexNote(ctx, 'notes/a.md', '[[notes/source]] and [[notes/source|alias]]');
    await indexNote(ctx, 'notes/b.md', 'just one [[notes/source]]');
    await indexNote(ctx, 'notes/c.md', 'no link to source here');

    const preview = await previewMergeNotes(root, 'notes/source.md', 'notes/target.md');
    expect(preview.linkOccurrences).toBe(3);
    expect(preview.affectedFiles).toBe(2);
  });

  it('returns zero counts for source == target', async () => {
    writeNote(root, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    const preview = await previewMergeNotes(root, 'notes/foo.md', 'notes/foo.md');
    expect(preview).toEqual({ linkOccurrences: 0, affectedFiles: 0 });
  });
});
