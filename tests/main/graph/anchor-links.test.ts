import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  queryGraph,
  findNotesLinkingTo,
  outgoingLinks,
  backlinks,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-anchor-test-'));
}

describe('anchor links (issue #137)', () => {
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

  it('indexes heading anchors as an IRI fragment (slug)', async () => {
    await indexNote(ctx, 'notes/foo.md', '# Foo\n\n## Components');
    await indexNote(ctx, 'notes/a.md', 'See [[notes/foo#Components]].');

    const { results } = await queryGraph(ctx, `
      SELECT ?target WHERE {
        ?src minerva:relativePath "notes/a.md" .
        ?src minerva:references ?target .
      }
    `);
    const target = (results as Array<{ target: string }>)[0].target;
    expect(target).toMatch(/note\/notes\/foo#components$/);
  });

  it('preserves block-id anchors verbatim (with ^ prefix, no slugification)', async () => {
    await indexNote(ctx, 'notes/a.md', 'See [[notes/foo#^para-3]].');

    const { results } = await queryGraph(ctx, `
      SELECT ?target WHERE {
        ?src minerva:relativePath "notes/a.md" ;
             minerva:references ?target .
      }
    `);
    const target = (results as Array<{ target: string }>)[0].target;
    expect(target).toMatch(/note\/notes\/foo#\^para-3$/);
  });

  it('findNotesLinkingTo tolerates anchored links to the same note', async () => {
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/a.md', 'See [[notes/foo]].');
    await indexNote(ctx, 'notes/b.md', 'See [[notes/foo#components]].');
    await indexNote(ctx, 'notes/c.md', 'See [[notes/foo#^block-1]].');

    const linkers = findNotesLinkingTo(ctx, 'notes/foo.md').sort();
    expect(linkers).toEqual(['notes/a.md', 'notes/b.md', 'notes/c.md']);
  });

  it('backlinks reports anchored links as backlinks to the bare note', async () => {
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/a.md', 'See [[notes/foo#section]].');

    const bl = backlinks(ctx, 'notes/foo.md');
    expect(bl.map((b) => b.source)).toEqual(['notes/a.md']);
  });

  it('outgoingLinks resolves anchored targets to the bare note metadata', async () => {
    await indexNote(ctx, 'notes/foo.md', '# Foo');
    await indexNote(ctx, 'notes/a.md', 'See [[notes/foo#section]].');

    const out = outgoingLinks(ctx, 'notes/a.md');
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe('notes/foo.md');
    expect(out[0].exists).toBe(true);
    expect(out[0].targetTitle).toBe('Foo');
  });
});
