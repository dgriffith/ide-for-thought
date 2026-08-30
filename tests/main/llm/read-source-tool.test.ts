import { describe, it, expect, beforeEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { executeNotebaseTool } from '../../../src/main/llm/tools';
import { indexSource } from '../../../src/main/graph/index';
import type { ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('read_source tool (#1371)', () => {
  const project = useGraphProject('minerva-read-source-');
  let root: string;
  let ctxValue: ProjectContext;
  const ctx = () => ctxValue;

  beforeEach(() => {
    root = project.root;
    ctxValue = project.ctx;
  });

  async function seedSource(id: string, body: string, meta?: string): Promise<void> {
    const dir = path.join(root, '.minerva', 'sources', id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'body.md'), body, 'utf-8');
    if (meta) await fsp.writeFile(path.join(dir, 'meta.ttl'), meta, 'utf-8');
  }

  it('reads a source body by id, with a title provenance header', async () => {
    const meta = 'this: a thought:Article ;\n  dc:title "The Trust Paper" .\n';
    const body = '# Trust\n\nThe full extracted body of the source.\n';
    await seedSource('trust-2023', body, meta);
    indexSource(ctx(), 'trust-2023', meta, body); // so sourceTitle resolves the header

    const res = await executeNotebaseTool(ctx(), 'read_source', { source_id: 'trust-2023' });
    expect(res.isError).toBe(false);
    expect(res.content).toContain('The full extracted body of the source.');
    expect(res.content).toContain('[source trust-2023] The Trust Paper');
  });

  it('falls back to a bare header when the source has no indexed title', async () => {
    await seedSource('untitled-1', 'body only\n'); // no meta, graph not initialised
    const res = await executeNotebaseTool(ctx(), 'read_source', { source_id: 'untitled-1' });
    expect(res.isError).toBe(false);
    expect(res.content).toContain('[source untitled-1]');
    expect(res.content).toContain('body only');
  });

  it('errors clearly for an unknown / bodyless source', async () => {
    const res = await executeNotebaseTool(ctx(), 'read_source', { source_id: 'nope' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/No readable body for source "nope"/);
  });

  it('rejects a path-traversal source_id', async () => {
    const res = await executeNotebaseTool(ctx(), 'read_source', { source_id: '../../etc/passwd' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/Invalid source_id|not a path/);
  });

  it('requires a non-empty source_id', async () => {
    const res = await executeNotebaseTool(ctx(), 'read_source', { source_id: '  ' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/source_id is required/);
  });

  it('is registered in the default conversation toolset', async () => {
    const { NOTEBASE_TOOLS } = await import('../../../src/main/llm/tools');
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('read_source');
  });
});
