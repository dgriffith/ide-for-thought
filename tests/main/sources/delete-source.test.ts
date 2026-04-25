import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexSource, indexExcerpt, listAllSources, excerptIdsForSource } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { deleteSource } from '../../../src/main/sources/delete-source';

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-delete-source-'));
}

describe('deleteSource', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTemp();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('removes the source directory, all excerpts, and their graph entries', async () => {
    const sourceId = 'sha-abc123';
    const sourceDir = path.join(root, '.minerva', 'sources', sourceId);
    await fsp.mkdir(sourceDir, { recursive: true });
    await fsp.writeFile(path.join(sourceDir, 'meta.ttl'),
      'this: a thought:PDFSource ; dc:title "Test" .\n');
    await fsp.writeFile(path.join(sourceDir, 'body.md'), '# Test\n');
    await fsp.writeFile(path.join(sourceDir, 'original.pdf'), new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    indexSource(ctx, sourceId,
      'this: a thought:PDFSource ; dc:title "Test" .\n',
      '# Test\n',
    );

    const excerptsDir = path.join(root, '.minerva', 'excerpts');
    await fsp.mkdir(excerptsDir, { recursive: true });
    for (const exId of ['ex-1', 'ex-2']) {
      const ttl = `this: a thought:Excerpt ;\n  thought:fromSource sources:${sourceId} ;\n  thought:citedText "..." .\n`;
      await fsp.writeFile(path.join(excerptsDir, `${exId}.ttl`), ttl);
      indexExcerpt(ctx, exId, ttl);
    }

    // Sanity: the source + excerpts are in the graph before deletion.
    expect(listAllSources(ctx).some((s) => s.sourceId === sourceId)).toBe(true);
    expect(excerptIdsForSource(ctx, sourceId).sort()).toEqual(['ex-1', 'ex-2']);

    const result = await deleteSource(root, sourceId);

    expect(result.sourceId).toBe(sourceId);
    expect(result.excerptsRemoved).toBe(2);
    expect(fs.existsSync(sourceDir)).toBe(false);
    expect(fs.existsSync(path.join(excerptsDir, 'ex-1.ttl'))).toBe(false);
    expect(fs.existsSync(path.join(excerptsDir, 'ex-2.ttl'))).toBe(false);
    expect(listAllSources(ctx).some((s) => s.sourceId === sourceId)).toBe(false);
    expect(excerptIdsForSource(ctx, sourceId)).toEqual([]);
  });

  it('is a no-op on an already-deleted source', async () => {
    const result = await deleteSource(root, 'sha-nonexistent');
    expect(result.excerptsRemoved).toBe(0);
  });
});
