import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { formatFile } from '../../../src/main/formatter/orchestrator';
// Rule side-effects — the orchestrator already imports the barrel, but we
// repeat here so the test file is explicit about what it's exercising.
import '../../../src/shared/formatter/rules/index';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-fmt-cascade-test-'));
}

function writeNote(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function readNote(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}

describe('formatter orchestrator heading-rename cascade (#156)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rewrites incoming anchor links when `file-name-heading` (replace-h1) changes an H1', async () => {
    // Target note has `# Old Title`; slug: `old-title`.
    writeNote(root, 'notes/my-note.md', '# Old Title\n\nbody\n');
    writeNote(root, 'notes/other.md', 'See [[notes/my-note#old-title]] for context.\n');

    await indexNote('notes/my-note.md', readNote(root, 'notes/my-note.md'));
    await indexNote('notes/other.md', readNote(root, 'notes/other.md'));

    const result = await formatFile(root, 'notes/my-note.md', {
      enabled: { 'file-name-heading': true },
      configs: { 'file-name-heading': { mode: 'replace-h1' } },
    });

    expect(result.changed).toBe(true);
    expect(result.after).toBe('# my-note\n\nbody\n');
    expect(result.cascadedPaths).toEqual(['notes/other.md']);
    expect(readNote(root, 'notes/other.md')).toBe(
      'See [[notes/my-note#my-note]] for context.\n',
    );
  });

  it('does not cascade when a rule preserves the slug (case-only change)', async () => {
    writeNote(root, 'notes/foo.md', '# hello world\n\nbody\n');
    writeNote(root, 'notes/other.md', 'See [[notes/foo#hello-world]].\n');

    await indexNote('notes/foo.md', readNote(root, 'notes/foo.md'));
    await indexNote('notes/other.md', readNote(root, 'notes/other.md'));

    const result = await formatFile(root, 'notes/foo.md', {
      enabled: { 'capitalize-headings': true },
      configs: { 'capitalize-headings': { style: 'title-case', properNouns: [] } },
    });

    expect(result.changed).toBe(true);
    expect(result.after).toContain('# Hello World');
    expect(result.cascadedPaths).toEqual([]);
    // Other note is untouched since the slug `hello-world` survives.
    expect(readNote(root, 'notes/other.md')).toBe(
      'See [[notes/foo#hello-world]].\n',
    );
  });

  it('no cascade when the heading count changes (safety bail-out)', async () => {
    // Simulate a scenario where a heading is effectively removed — the
    // cascade should refuse rather than mis-attribute by position.
    // We don't ship a rule that removes headings, so this is constructed:
    // format a file that already has no H1 using `file-name-heading` +
    // `insert-if-missing`, and verify cascade remains empty because no
    // rename was detected (no change to existing headings, just an insert).
    writeNote(root, 'notes/foo.md', 'no heading yet\n');

    await indexNote('notes/foo.md', readNote(root, 'notes/foo.md'));

    const result = await formatFile(root, 'notes/foo.md', {
      enabled: { 'file-name-heading': true },
      configs: { 'file-name-heading': { mode: 'insert-if-missing' } },
    });

    expect(result.changed).toBe(true);
    expect(result.after).toBe('# foo\n\nno heading yet\n');
    // 0 → 1 headings: count changed, cascade bails.
    expect(result.cascadedPaths).toEqual([]);
  });
});
