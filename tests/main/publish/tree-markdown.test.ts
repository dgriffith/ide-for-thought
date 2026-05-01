/**
 * Tree-markdown zip exporter (#291).
 *
 * The zip output is decoded back into individual files (via JSZip's
 * `loadAsync`) so each entry can be asserted on individually — that
 * mirrors how a user actually consumes the export.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { treeMarkdownExporter } from '../../../src/main/publish/exporters/tree-markdown';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tree-md-'));
}

async function loadZip(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  await Promise.all(
    Object.keys(zip.files).map(async (name) => {
      const f = zip.files[name];
      if (f.dir) return;
      out.set(name, await f.async('string'));
    }),
  );
  return out;
}

describe('tree-markdown zip exporter (#291)', () => {
  let root: string;

  beforeEach(() => { root = mkProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('emits a single .zip file containing every reachable note', async () => {
    await fsp.writeFile(path.join(root, 'root.md'),
      '---\ntitle: Thesis\n---\n# Thesis\n\nLinks to [[ch1]] and [[ch2]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'ch1.md'),
      '---\ntitle: One\n---\n# One\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'ch2.md'),
      '---\ntitle: Two\n---\n# Two\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 3 });
    const output = await runExporter(treeMarkdownExporter, plan);
    expect(output.files).toHaveLength(1);
    expect(output.files[0].path).toBe('thesis-tree.zip');

    const unzipped = await loadZip(output.files[0].contents as Uint8Array);
    const paths = [...unzipped.keys()].sort();
    expect(paths).toEqual(['ch1.md', 'ch2.md', 'root.md']);
  });

  it('rewrites wiki-links in zip entries to relative .md paths', async () => {
    await fsp.writeFile(path.join(root, 'root.md'),
      '# Root\n\nSee [[ch1]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'ch1.md'),
      '---\ntitle: Chapter One\n---\n# Chapter One\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 2 });
    const output = await runExporter(treeMarkdownExporter, plan);
    const unzipped = await loadZip(output.files[0].contents as Uint8Array);
    const rootContent = unzipped.get('root.md');
    expect(rootContent).toBeDefined();
    expect(rootContent).toContain('[Chapter One](ch1.md)');
    expect(rootContent).not.toContain('[[ch1]]');
  });

  it('drops embedded turtle blocks but preserves other fenced blocks', async () => {
    await fsp.writeFile(path.join(root, 'root.md'),
      '# Root\n\n```turtle\n@prefix ex: <http://x.com/> .\n```\n\n```python\nprint("hi")\n```\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 1 });
    const output = await runExporter(treeMarkdownExporter, plan);
    const unzipped = await loadZip(output.files[0].contents as Uint8Array);
    const rootContent = unzipped.get('root.md')!;
    expect(rootContent).not.toContain('```turtle');
    expect(rootContent).not.toContain('@prefix');
    expect(rootContent).toContain('```python');
  });

  it('emits references.md at the bundle root when any note cites a source', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`, 'utf-8');
    await fsp.writeFile(path.join(root, 'root.md'),
      '# Root\n[[a]] cites [[cite::foo-2020]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\nAlso cites [[cite::foo-2020]]\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 2 });
    const output = await runExporter(treeMarkdownExporter, plan);
    const unzipped = await loadZip(output.files[0].contents as Uint8Array);
    expect(unzipped.has('references.md')).toBe(true);
    const refs = unzipped.get('references.md')!;
    expect(refs).toMatch(/^# References/m);
    expect(refs).toContain('Foo');
    // De-duplicated: Foo cited from two notes appears once.
    expect((refs.match(/Foo Studies/g) ?? []).length).toBe(1);
  });

  it('per-note files do NOT carry a ## References footer in tree mode (consolidated)', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`, 'utf-8');
    await fsp.writeFile(path.join(root, 'root.md'), '# Root\n[[cite::foo-2020]]\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 1 });
    const output = await runExporter(treeMarkdownExporter, plan);
    const unzipped = await loadZip(output.files[0].contents as Uint8Array);
    const rootContent = unzipped.get('root.md')!;
    expect(rootContent).not.toContain('## References');
    // But the consolidated references.md still appears.
    expect(unzipped.has('references.md')).toBe(true);
  });

  it('Chicago notes & bibliography: per-note [^N]: footnote defs + bundle Bibliography', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`, 'utf-8');
    await fsp.writeFile(path.join(root, 'root.md'),
      '# Root\nClaim [[cite::foo-2020]] [[a]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\nAlso [[cite::foo-2020]]\n', 'utf-8');

    const plan = await resolvePlan(
      root,
      { kind: 'tree', relativePath: 'root.md', maxDepth: 2 },
      { citationStyle: 'chicago-notes-bibliography' },
    );
    const output = await runExporter(treeMarkdownExporter, plan);
    const unzipped = await loadZip(output.files[0].contents as Uint8Array);
    // Each note has its own [^1] inline marker + [^1]: footnote definition.
    expect(unzipped.get('root.md')).toContain('[^1]');
    expect(unzipped.get('root.md')).toMatch(/\[\^1\]: .*Foo/);
    expect(unzipped.get('a.md')).toContain('[^1]');
    expect(unzipped.get('a.md')).toMatch(/\[\^1\]: .*Foo/);
    // Bundle-level Bibliography (heading flips for note styles).
    const refs = unzipped.get('references.md')!;
    expect(refs).toMatch(/^# Bibliography/m);
  });

  it('omits references.md when no notes cite anything', async () => {
    await fsp.writeFile(path.join(root, 'root.md'), '# Root\n[[a]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'), '# A\nno cites\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 2 });
    const output = await runExporter(treeMarkdownExporter, plan);
    const unzipped = await loadZip(output.files[0].contents as Uint8Array);
    expect(unzipped.has('references.md')).toBe(false);
  });

  it('exposes the expected exporter id + label', () => {
    expect(treeMarkdownExporter.id).toBe('tree-markdown');
    expect(treeMarkdownExporter.label).toBe('Note Tree as Markdown Zip');
    expect(treeMarkdownExporter.acceptedKinds).toEqual(['tree']);
    expect(treeMarkdownExporter.accepts({ kind: 'tree' })).toBe(true);
    expect(treeMarkdownExporter.accepts({ kind: 'project' })).toBe(false);
  });
});
