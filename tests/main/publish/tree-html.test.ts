import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { treeHtmlExporter } from '../../../src/main/publish/exporters/tree-html';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tree-html-test-'));
}

describe('tree-html exporter (#251) — through the pipeline', () => {
  let root: string;

  beforeEach(() => { root = mkTempProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('bundles the root and its wiki-link closure, root → index.html, others keep tree paths', async () => {
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/root.md'),
      '---\ntitle: The Thesis\n---\n\n# The Thesis\n\nLinked to [[notes/ch1]] and [[notes/ch2]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'notes/ch1.md'),
      '---\ntitle: Chapter One\n---\n\n# Chapter One\n\nSee [[notes/ch2]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'notes/ch2.md'),
      '---\ntitle: Chapter Two\n---\n\n# Chapter Two\n', 'utf-8');
    // A floating note outside the reachable closure — must not appear.
    await fsp.writeFile(path.join(root, 'notes/unreachable.md'), '# nope\n', 'utf-8');

    const plan = await resolvePlan(root, {
      kind: 'tree',
      relativePath: 'notes/root.md',
      maxDepth: 3,
    }, { linkPolicy: 'follow-to-file' });
    const output = await runExporter(treeHtmlExporter, plan);

    const paths = output.files.map((f) => f.path).sort();
    expect(paths).toEqual(['index.html', 'notes/ch1.html', 'notes/ch2.html']);

    const indexHtml = String(output.files.find((f) => f.path === 'index.html')!.contents);
    expect(indexHtml).toContain('<title>The Thesis</title>');
    // Cross-links use relative .html paths so the bundle browses as-is.
    expect(indexHtml).toContain('href="notes/ch1.html"');
    expect(indexHtml).toContain('href="notes/ch2.html"');
  });

  it('respects maxDepth — a note at depth > limit is excluded from the bundle', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '[[b]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'), '[[c]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'c.md'), '[[d]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'd.md'), 'deep\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'a.md', maxDepth: 2 });
    const output = await runExporter(treeHtmlExporter, plan);
    const paths = output.files.map((f) => f.path).sort();
    expect(paths).toEqual(['b.html', 'c.html', 'index.html']);
    expect(paths).not.toContain('d.html');
  });

  it('excludes private notes from the bundle and records them in the plan', async () => {
    await fsp.mkdir(path.join(root, 'private'), { recursive: true });
    await fsp.writeFile(path.join(root, 'root.md'), '[[public]] [[private/secret]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'public.md'), 'hello\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'private/secret.md'), 'shh\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 3 });
    expect(plan.excluded.map((e) => e.relativePath)).toEqual(['private/secret.md']);
    const output = await runExporter(treeHtmlExporter, plan);
    const paths = output.files.map((f) => f.path).sort();
    expect(paths).toEqual(['index.html', 'public.html']);
  });

  it('cycles in the link graph do not cause infinite loops', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '[[b]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'), '[[a]]\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'a.md', maxDepth: 10 });
    const output = await runExporter(treeHtmlExporter, plan);
    expect(output.files.map((f) => f.path).sort()).toEqual(['b.html', 'index.html']);
  });

  it('forces follow-to-file even when the plan arrived with inline-title', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '[[b]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'), '# B\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'tree', relativePath: 'a.md', maxDepth: 3 },
      { linkPolicy: 'inline-title' },
    );
    const output = await runExporter(treeHtmlExporter, plan);
    const indexHtml = String(output.files.find((f) => f.path === 'index.html')!.contents);
    expect(indexHtml).toContain('href="b.html"');
  });
});
