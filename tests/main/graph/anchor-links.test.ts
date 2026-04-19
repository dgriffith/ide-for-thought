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

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-anchor-test-'));
}

describe('anchor links (issue #137)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('indexes heading anchors as an IRI fragment (slug)', async () => {
    await indexNote('notes/foo.md', '# Foo\n\n## Components');
    await indexNote('notes/a.md', 'See [[notes/foo#Components]].');

    const { results } = await queryGraph(`
      SELECT ?target WHERE {
        ?src minerva:relativePath "notes/a.md" .
        ?src minerva:references ?target .
      }
    `);
    const target = (results as Array<{ target: string }>)[0].target;
    expect(target).toMatch(/note\/notes\/foo#components$/);
  });

  it('preserves block-id anchors verbatim (with ^ prefix, no slugification)', async () => {
    await indexNote('notes/a.md', 'See [[notes/foo#^para-3]].');

    const { results } = await queryGraph(`
      SELECT ?target WHERE {
        ?src minerva:relativePath "notes/a.md" ;
             minerva:references ?target .
      }
    `);
    const target = (results as Array<{ target: string }>)[0].target;
    expect(target).toMatch(/note\/notes\/foo#\^para-3$/);
  });

  it('findNotesLinkingTo tolerates anchored links to the same note', async () => {
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('notes/a.md', 'See [[notes/foo]].');
    await indexNote('notes/b.md', 'See [[notes/foo#components]].');
    await indexNote('notes/c.md', 'See [[notes/foo#^block-1]].');

    const linkers = findNotesLinkingTo('notes/foo.md').sort();
    expect(linkers).toEqual(['notes/a.md', 'notes/b.md', 'notes/c.md']);
  });

  it('backlinks reports anchored links as backlinks to the bare note', async () => {
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('notes/a.md', 'See [[notes/foo#section]].');

    const bl = backlinks('notes/foo.md');
    expect(bl.map((b) => b.source)).toEqual(['notes/a.md']);
  });

  it('outgoingLinks resolves anchored targets to the bare note metadata', async () => {
    await indexNote('notes/foo.md', '# Foo');
    await indexNote('notes/a.md', 'See [[notes/foo#section]].');

    const out = outgoingLinks('notes/a.md');
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe('notes/foo.md');
    expect(out[0].exists).toBe(true);
    expect(out[0].targetTitle).toBe('Foo');
  });
});
