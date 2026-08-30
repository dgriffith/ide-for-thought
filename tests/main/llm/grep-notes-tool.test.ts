import { describe, it, expect, beforeEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { executeNotebaseTool, NOTEBASE_TOOLS } from '../../../src/main/llm/tools';
import { projectContext } from '../../../src/main/project-context-types';
import { useTempDir } from '../../helpers/temp-project';

describe('grep_notes tool', () => {
  const project = useTempDir('minerva-grep-notes-');
  let root: string;
  const ctx = () => projectContext(root);

  beforeEach(async () => {
    root = project.root;
    await fsp.writeFile(
      path.join(root, 'alpha.md'),
      'The mitochondrion is the powerhouse.\nTODO: cite this claim.\n',
      'utf-8',
    );
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'notes', 'beta.md'),
      'A MITOCHONDRION reference in Naples.\n- [ ] unfinished task\n',
      'utf-8',
    );
  });

  it('finds a literal substring case-insensitively across notes, as path:line: text', async () => {
    const res = await executeNotebaseTool(ctx(), 'grep_notes', { pattern: 'mitochondrion' });
    expect(res.isError).toBe(false);
    expect(res.content).toContain('alpha.md:1: The mitochondrion is the powerhouse.');
    expect(res.content).toContain('notes/beta.md:1: A MITOCHONDRION reference in Naples.');
    expect(res.content).toMatch(/2 matches in 2 notes/);
  });

  it('honors case_sensitive', async () => {
    const res = await executeNotebaseTool(ctx(), 'grep_notes', { pattern: 'MITOCHONDRION', case_sensitive: true });
    expect(res.content).toContain('notes/beta.md:1:');
    expect(res.content).not.toContain('alpha.md:1:');
  });

  it('treats the pattern as a literal (special characters need no escaping)', async () => {
    const res = await executeNotebaseTool(ctx(), 'grep_notes', { pattern: '- [ ]' });
    expect(res.content).toContain('notes/beta.md:2: - [ ] unfinished task');
  });

  it('supports regex when regex:true', async () => {
    const res = await executeNotebaseTool(ctx(), 'grep_notes', { pattern: '^TODO:', regex: true });
    expect(res.content).toContain('alpha.md:2: TODO: cite this claim.');
    expect(res.content).not.toContain('beta.md');
  });

  it('reports no matches clearly', async () => {
    const res = await executeNotebaseTool(ctx(), 'grep_notes', { pattern: 'zzz-not-present' });
    expect(res.isError).toBe(false);
    expect(res.content).toMatch(/No matches for literal "zzz-not-present"/);
  });

  it('caps output and reports the true total when truncated', async () => {
    const res = await executeNotebaseTool(ctx(), 'grep_notes', { pattern: 'e', max_matches: 1 });
    expect(res.content).toMatch(/showing the first 1/);
    // header still reports the full count
    expect(res.content).toMatch(/^\d+ matches in \d+ notes/);
  });

  it('requires a non-empty pattern', async () => {
    const res = await executeNotebaseTool(ctx(), 'grep_notes', { pattern: '  ' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/pattern is required/);
  });

  it('is registered in the default conversation toolset', () => {
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('grep_notes');
  });

  it('tells the model this is the only literal search, and that a sandbox is not (#1817)', () => {
    // A user was told their notes were corrupted because the model ran grep in
    // the web tools' code sandbox — which cannot see the thoughtbase — and
    // reasoned from the garbage it got back. The description is the last place
    // to say so before the model reaches for a shell.
    const desc = NOTEBASE_TOOLS.find((t) => t.name === 'grep_notes')!.description!;
    expect(desc).toMatch(/sandbox cannot see the thoughtbase/i);
    expect(desc).toMatch(/never shell out to grep/i);
    // …and that a capped result is a capped result, not evidence of damage.
    expect(desc).toMatch(/narrow the pattern/i);
  });
});
