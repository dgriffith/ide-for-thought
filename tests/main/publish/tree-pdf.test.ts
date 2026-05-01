/**
 * Tree-PDF concatenation builder (#290).
 *
 * Covers the pure HTML-assembly side. Electron's `printToPDF` rendering
 * is exercised at runtime — this suite validates the shape of the
 * concatenated HTML the rasteriser eventually consumes: TOC, chapter
 * order, in-document anchor linking, page-break CSS, consolidated
 * bibliography.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolvePlan } from '../../../src/main/publish/pipeline';
import { buildTreePdfHtml, treePdfExporter } from '../../../src/main/publish/exporters/tree-pdf';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tree-pdf-'));
}

describe('tree-pdf builder (#290)', () => {
  let root: string;

  beforeEach(() => { root = mkProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('concatenates all reachable notes in BFS order with TOC + chapter sections', async () => {
    await fsp.writeFile(path.join(root, 'root.md'),
      '---\ntitle: The Thesis\n---\n# The Thesis\n\nLinks to [[ch1]] and [[ch2]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'ch1.md'),
      '---\ntitle: Chapter One\n---\n# Chapter One\n\nThe first chapter.\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'ch2.md'),
      '---\ntitle: Chapter Two\n---\n# Chapter Two\n\nThe second chapter.\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 3 });
    const built = buildTreePdfHtml(plan);
    expect(built.chapterCount).toBe(3);
    expect(built.documentTitle).toBe('The Thesis');
    // Title page + TOC + 3 chapter sections.
    expect(built.html).toContain('<section class="tree-pdf-title-page">');
    expect(built.html).toContain('<nav class="tree-pdf-toc">');
    expect((built.html.match(/class="tree-pdf-chapter"/g) ?? []).length).toBe(3);
    // TOC has each title in BFS order.
    const tocBlock = built.html.match(/<nav class="tree-pdf-toc">[\s\S]*?<\/nav>/)![0];
    const order = ['The Thesis', 'Chapter One', 'Chapter Two'];
    let lastIdx = -1;
    for (const t of order) {
      const idx = tocBlock.indexOf(t);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('TOC links target intra-document chapter anchors', async () => {
    await fsp.writeFile(path.join(root, 'root.md'), '# Root\n[[chap]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'chap.md'),
      '---\ntitle: A Chapter\n---\n# A Chapter\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 2 });
    const built = buildTreePdfHtml(plan);
    expect(built.html).toContain('href="#chapter-root"');
    expect(built.html).toContain('href="#chapter-chap"');
    expect(built.html).toContain('id="chapter-root"');
    expect(built.html).toContain('id="chapter-chap"');
  });

  it('inter-chapter wiki-links rewrite to in-document anchors (no broken file refs)', async () => {
    await fsp.writeFile(path.join(root, 'root.md'),
      '# Root\n\nSee [[chap]] for details.\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'chap.md'),
      '---\ntitle: A Chapter\n---\n# A Chapter\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 2 });
    const built = buildTreePdfHtml(plan);
    // No inter-note references that would fail in a single-file PDF.
    expect(built.html).not.toContain('href="chap.html"');
    expect(built.html).not.toContain('href="./chap.html"');
    // The link to chap from root's body got rewritten to the anchor.
    expect(built.html).toContain('href="#chapter-chap"');
  });

  it('emits page-break CSS so chapters start on fresh pages', async () => {
    await fsp.writeFile(path.join(root, 'r.md'), '# R\n[[c]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'c.md'), '# C\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'r.md', maxDepth: 2 });
    const built = buildTreePdfHtml(plan);
    expect(built.html).toContain('.tree-pdf-chapter {');
    expect(built.html).toContain('page-break-before: always');
    expect(built.html).toContain('.tree-pdf-title-page');
    expect(built.html).toContain('page-break-after: always');
  });

  it('frontmatter title beats H1 for chapter heading', async () => {
    await fsp.writeFile(path.join(root, 'root.md'),
      '---\ntitle: From Frontmatter\n---\n# Different In Body\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 1 });
    const built = buildTreePdfHtml(plan);
    expect(built.documentTitle).toBe('From Frontmatter');
    // TOC entry uses frontmatter title.
    expect(built.html).toMatch(/<nav class="tree-pdf-toc">[\s\S]*?From Frontmatter[\s\S]*?<\/nav>/);
  });

  it('consolidated bibliography appears once across all chapters', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`, 'utf-8');
    await fsp.writeFile(path.join(root, 'root.md'),
      '# Root\n[[a]]\nCites [[cite::foo-2020]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\nAlso cites [[cite::foo-2020]]\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 2 });
    const built = buildTreePdfHtml(plan);
    expect(built.html).toContain('id="chapter-bibliography"');
    expect(built.html).toContain('References');
    // Bibliography lists Foo exactly once despite two cite references.
    expect((built.html.match(/Foo Studies/g) ?? []).length).toBe(1);
    // TOC includes the bibliography.
    expect(built.html).toMatch(/<nav class="tree-pdf-toc">[\s\S]*?References[\s\S]*?<\/nav>/);
  });

  it('Chicago notes & bibliography: per-chapter footnotes + bundle Bibliography', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`, 'utf-8');
    await fsp.writeFile(path.join(root, 'root.md'), '# R\n[[a]]\n[[cite::foo-2020]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'), '# A\n[[cite::foo-2020]]\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'tree', relativePath: 'root.md', maxDepth: 2 },
      { citationStyle: 'chicago-notes-bibliography' },
    );
    const built = buildTreePdfHtml(plan);
    // Each chapter's footnote counter starts at 1.
    expect(built.html).toContain('id="fn-1"');
    expect((built.html.match(/id="fnref-1"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Bundle-level Bibliography (heading flips for note styles).
    expect(built.html).toContain('Bibliography');
  });

  it('builder returns an empty result when the plan has no notes', () => {
    // Hand-roll a synthetic empty plan rather than going through
    // resolvePlan (which requires a real root note).
    const built = buildTreePdfHtml({
      inputKind: 'tree',
      inputs: [],
      excluded: [],
      linkPolicy: 'inline-title',
      assetPolicy: 'keep-relative',
      rootPath: root,
    });
    expect(built.chapterCount).toBe(0);
    expect(built.html).toBe('');
  });

  it('exposes the expected exporter id + label', () => {
    expect(treePdfExporter.id).toBe('tree-pdf');
    expect(treePdfExporter.label).toBe('Note Tree as Single PDF');
    expect(treePdfExporter.acceptedKinds).toEqual(['tree']);
    expect(treePdfExporter.accepts({ kind: 'tree' })).toBe(true);
    expect(treePdfExporter.accepts({ kind: 'project' })).toBe(false);
  });
});
