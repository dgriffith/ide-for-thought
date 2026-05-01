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

// ── Consolidated bibliography across the bundle (#300) ───────────────────

describe('tree-html consolidated bibliography (#300)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`,
      'utf-8');
    await fsp.mkdir(path.join(root, '.minerva/sources/bar-2021'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/bar-2021/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Bar Considered" ;
  dc:creator "Bar, Bob" ;
  dc:issued "2021"^^xsd:gYear .\n`,
      'utf-8');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('emits one references.html with deduplicated entries across all notes', async () => {
    // Three notes; both Foo and Bar are cited from multiple notes.
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\n\nSee [[cite::foo-2020]] and [[b]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'),
      '# B\n\nPer [[cite::foo-2020]], also [[cite::bar-2021]] and [[c]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'c.md'),
      '# C\n\nFinally [[cite::bar-2021]].\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'a.md', maxDepth: 3 });
    const output = await runExporter(treeHtmlExporter, plan);

    const paths = output.files.map((f) => f.path).sort();
    expect(paths).toContain('references.html');

    const refs = String(output.files.find((f) => f.path === 'references.html')!.contents);
    // One entry per source despite four total cite occurrences.
    expect(refs).toContain('Foo');
    expect(refs).toContain('Bar');
    expect(refs).toContain('<title>References</title>');
    // No duplicate Foo entries — count occurrences of "Foo Studies".
    const fooMatches = (refs.match(/Foo Studies/g) ?? []).length;
    expect(fooMatches).toBe(1);
  });

  it('each cite-bearing note grows a "References →" footer link to references.html', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\n\n[[cite::foo-2020]] and [[b]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'),
      '# B\n\nNo cites here.\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'a.md', maxDepth: 3 });
    const output = await runExporter(treeHtmlExporter, plan);

    const indexHtml = String(output.files.find((f) => f.path === 'index.html')!.contents);
    const bHtml = String(output.files.find((f) => f.path === 'b.html')!.contents);
    expect(indexHtml).toContain('class="bundle-refs-link"');
    expect(indexHtml).toContain('href="references.html"');
    // Note b.md has no citations, so no "References →" footer.
    expect(bHtml).not.toContain('class="bundle-refs-link"');
  });

  it('nested-path notes get a relative href to references.html', async () => {
    await fsp.mkdir(path.join(root, 'sub'), { recursive: true });
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\n\n[[sub/deep]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'sub/deep.md'),
      '# Deep\n\n[[cite::foo-2020]]\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'a.md', maxDepth: 3 });
    const output = await runExporter(treeHtmlExporter, plan);
    const deepHtml = String(output.files.find((f) => f.path === 'sub/deep.html')!.contents);
    // sub/deep.html is one directory deeper than the bundle root, so
    // the link climbs one level: ../references.html.
    expect(deepHtml).toContain('href="../references.html"');
  });

  it('omits references.html when no notes cite anything', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '# A\n[[b]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'), '# B\nno cites\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'a.md', maxDepth: 3 });
    const output = await runExporter(treeHtmlExporter, plan);
    expect(output.files.map((f) => f.path)).not.toContain('references.html');
  });

  it('note-style export: per-note Footnotes + bundle-level Bibliography', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\n\n[[cite::foo-2020]] and [[b]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'),
      '# B\n\n[[cite::bar-2021]]\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'tree', relativePath: 'a.md', maxDepth: 3 },
      { citationStyle: 'chicago-notes-bibliography' },
    );
    const output = await runExporter(treeHtmlExporter, plan);

    const indexHtml = String(output.files.find((f) => f.path === 'index.html')!.contents);
    const bHtml = String(output.files.find((f) => f.path === 'b.html')!.contents);
    // Each note has its own footnote section starting at 1.
    expect(indexHtml).toContain('<section class="footnotes">');
    expect(indexHtml).toContain('id="fn-1"');
    expect(bHtml).toContain('<section class="footnotes">');
    expect(bHtml).toContain('id="fn-1"');

    // Bundle-level Bibliography page (heading flips for note styles).
    const refs = String(output.files.find((f) => f.path === 'references.html')!.contents);
    expect(refs).toContain('<title>Bibliography</title>');
    expect(refs).toContain('Foo');
    expect(refs).toContain('Bar');
  });
});
