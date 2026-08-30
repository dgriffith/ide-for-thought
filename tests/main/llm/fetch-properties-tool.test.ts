/**
 * fetch_properties tool (#1935) — read-only YAML frontmatter reader,
 * symmetric with read_note. No approval gate: nothing is written.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { executeNotebaseTool, NOTEBASE_TOOLS } from '../../../src/main/llm/tools';
import { useTempDir } from '../../helpers/temp-project';

describe('fetch_properties tool execution', () => {
  const project = useTempDir('minerva-fetch-properties-');
  let root: string;

  beforeEach(() => {
    root = project.root;
  });

  it('returns the frontmatter as JSON', async () => {
    fs.writeFileSync(path.join(root, 'a.md'), '---\nstatus: done\ntags:\n  - x\n  - y\n---\n# A\n', 'utf-8');
    const out = await executeNotebaseTool({ rootPath: root }, 'fetch_properties', { relative_path: 'a.md' });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content)).toEqual({ status: 'done', tags: ['x', 'y'] });
  });

  it('returns {} for a note with no frontmatter', async () => {
    fs.writeFileSync(path.join(root, 'plain.md'), '# Plain\nNo frontmatter here.\n', 'utf-8');
    const out = await executeNotebaseTool({ rootPath: root }, 'fetch_properties', { relative_path: 'plain.md' });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content)).toEqual({});
  });

  it('returns {} for malformed YAML frontmatter rather than throwing', async () => {
    fs.writeFileSync(path.join(root, 'bad.md'), '---\n: not valid yaml: [\n---\n# Bad\n', 'utf-8');
    const out = await executeNotebaseTool({ rootPath: root }, 'fetch_properties', { relative_path: 'bad.md' });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content)).toEqual({});
  });

  it('requires a non-empty relative_path', async () => {
    const out = await executeNotebaseTool({ rootPath: root }, 'fetch_properties', { relative_path: '' });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/Tool fetch_properties failed: relative_path is required/);
  });

  it('surfaces a missing file as a tool error rather than throwing uncaught', async () => {
    const out = await executeNotebaseTool({ rootPath: root }, 'fetch_properties', { relative_path: 'missing.md' });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/Tool fetch_properties failed:/);
  });

  it('is registered in the default conversation toolset', () => {
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('fetch_properties');
  });
});
