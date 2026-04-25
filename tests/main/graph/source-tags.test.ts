import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexAllNotes,
  indexSource,
  listTags,
  notesByTag,
  sourcesByTag,
  indexNote,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-source-tags-test-'));
}

function writeSourceMeta(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl, 'utf-8');
}

function writeSourceBody(root: string, id: string, md: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'body.md'), md, 'utf-8');
}

const META = `
this: a thought:Article ;
    dc:title "Example paper" ;
    dc:creator "Alice Smith" .
`;

describe('Source participation in tag system (issue #118)', () => {
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

  it('picks up body #tags on the source URI during indexAllNotes', async () => {
    writeSourceMeta(root, 'smith-2023', META);
    writeSourceBody(root, 'smith-2023', '# Notes\n\nThis is great #research stuff #epistemology.');
    await indexAllNotes(ctx);

    const sources = sourcesByTag(ctx, 'research');
    expect(sources).toHaveLength(1);
    expect(sources[0].sourceId).toBe('smith-2023');
    expect(sources[0].title).toBe('Example paper');

    const epistemology = sourcesByTag(ctx, 'epistemology');
    expect(epistemology.map(s => s.sourceId)).toEqual(['smith-2023']);
  });

  it('picks up frontmatter tags: [...] on the source URI', async () => {
    writeSourceMeta(root, 'smith-2023', META);
    writeSourceBody(root, 'smith-2023', '---\ntags: [research, epistemology]\n---\n# Notes\n');
    await indexAllNotes(ctx);

    const sources = sourcesByTag(ctx, 'research');
    expect(sources.map(s => s.sourceId)).toEqual(['smith-2023']);
  });

  it('listTags counts both notes and sources that share a tag', async () => {
    writeSourceMeta(root, 'smith-2023', META);
    writeSourceBody(root, 'smith-2023', '# x\n\n#research');
    await indexAllNotes(ctx);
    await indexNote(ctx, 'notes/overview.md', '# Overview\n\n#research');

    const info = listTags(ctx).find(t => t.tag === 'research');
    expect(info?.count).toBe(2);
  });

  it('notesByTag excludes sources (no misleading relativePath)', async () => {
    writeSourceMeta(root, 'smith-2023', META);
    writeSourceBody(root, 'smith-2023', '# x\n\n#research');
    await indexAllNotes(ctx);
    await indexNote(ctx, 'notes/overview.md', '# Overview\n\n#research');

    const notes = notesByTag(ctx, 'research');
    expect(notes.map(n => n.relativePath)).toEqual(['notes/overview.md']);
  });

  it('sourcesByTag returns empty when no sources are tagged', async () => {
    writeSourceMeta(root, 'smith-2023', META);
    // No body.md at all
    await indexAllNotes(ctx);
    await indexNote(ctx, 'notes/overview.md', '# x\n\n#research');

    expect(sourcesByTag(ctx, 'research')).toEqual([]);
  });

  it('re-indexing replaces the source tags (no stale triples)', async () => {
    writeSourceMeta(root, 'smith-2023', META);
    writeSourceBody(root, 'smith-2023', '# x\n\n#research');
    await indexAllNotes(ctx);

    // Simulate body edit: drop #research, add #methodology
    indexSource(ctx, 'smith-2023', META, '# x\n\n#methodology');

    expect(sourcesByTag(ctx, 'research')).toEqual([]);
    expect(sourcesByTag(ctx, 'methodology').map(s => s.sourceId)).toEqual(['smith-2023']);
  });
});
