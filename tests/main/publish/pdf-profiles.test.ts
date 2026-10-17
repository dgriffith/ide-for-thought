/**
 * @vitest-environment node
 *
 * PDF style profiles (#2429): Notes passes through untouched, and Essay and
 * Academic each lay the same rendered note out with their own stylesheet,
 * title block and (Academic) abstract, keeping its links and its CSL
 * bibliography. Golden HTML per profile holds the layout; the e2e spec
 * renders real PDFs and checks their page counts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyPdfProfile } from '../../../src/main/publish/pdf-profiles';
import { resolvePlan } from '../../../src/main/publish/pipeline';
import { runExporter } from '../../../src/main/publish';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';
import { buildTreePdfHtml } from '../../../src/main/publish/exporters/tree-pdf';
import { PDF_PROFILES, isPdfProfile } from '../../../src/shared/export-pdf-profiles';

const BODY = '<h1>On Growth</h1>\n<p>Trees grow <a href="https://ex.com">slowly</a>.</p>\n<h2>Method</h2>\n<p>We watched.</p>';

describe('applyPdfProfile (#2429)', () => {
  it('Notes is today\'s output: the body untouched, no style, no class', () => {
    expect(applyPdfProfile('notes', { title: 'On Growth', frontmatter: {}, body: BODY })).toEqual({ body: BODY, style: '', bodyClass: '' });
  });

  it('Essay adds a title block from the frontmatter, once, and wraps the body', () => {
    const r = applyPdfProfile('essay', { title: 'On Growth', frontmatter: { author: ['Ada', 'Bo'], date: '2026-05-01' }, body: BODY });
    expect(r.bodyClass).toBe('profile-essay');
    expect(r.body).toMatch(/^<header class="doc-title-block">\n {2}<h1 class="doc-title">On Growth<\/h1>\n {2}<p class="doc-meta">Ada, Bo · 2026-05-01<\/p>\n<\/header>\n<div class="doc-body">/);
    // The note's own H1 repeated the title: the block replaces it.
    expect(r.body.match(/On Growth/g)).toHaveLength(1);
    expect(r.body).toContain('<a href="https://ex.com">slowly</a>');
    expect(r.style).toMatch(/max-width: 65ch/);
    expect(r.style).toMatch(/break-after: avoid/);
  });

  it('a leading H1 that isn\'t the title stays', () => {
    const r = applyPdfProfile('essay', { title: 'Other', frontmatter: {}, body: BODY });
    expect(r.body).toContain('<h1>On Growth</h1>');
  });

  it('Academic takes the abstract from the frontmatter, escaped, or else the first paragraph', () => {
    const declared = applyPdfProfile('academic', { title: 'On Growth', frontmatter: { abstract: 'We find <b>growth</b>.' }, body: BODY });
    expect(declared.body).toContain('<section class="doc-abstract"><h2>Abstract</h2><p>We find &lt;b&gt;growth&lt;/b&gt;.</p></section>');
    expect(declared.body).toContain('<p>Trees grow');

    const taken = applyPdfProfile('academic', { title: 'On Growth', frontmatter: {}, body: BODY });
    expect(taken.body).toContain('<p>Trees grow <a href="https://ex.com">slowly</a>.</p></section>');
    expect(taken.body.split('Trees grow')).toHaveLength(2); // moved, not copied
    expect(taken.style).toMatch(/column-count: 2/);
    expect(taken.style).toMatch(/counter\(sec\)/);
    expect(taken.style).toMatch(/\.references, .*column-span: all/);
  });

  it('the title is escaped, and no title block when the caller has its own', () => {
    expect(applyPdfProfile('essay', { title: 'A <b> & co', frontmatter: {}, body: '' }).body).toContain('A &lt;b&gt; &amp; co');
    const chapter = applyPdfProfile('academic', { title: 'On Growth', frontmatter: { abstract: 'x' }, body: BODY, titleBlock: false });
    expect(chapter.body).toBe(`<div class="doc-body">\n${BODY}\n</div>`);
  });

  it('the profiles are the three, and only those', () => {
    expect(PDF_PROFILES.map((p) => p.id)).toEqual(['notes', 'essay', 'academic']);
    expect(isPdfProfile('essay')).toBe(true);
    expect(isPdfProfile('memo')).toBe(false);
  });
});

describe('through the exporters (#2429)', () => {
  let root: string;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pdf-profiles-'));
    await fsp.mkdir(path.join(root, '.minerva/sources/smith-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/smith-2020/meta.ttl'),
      'this: a thought:Article ;\n  dc:title "On the Growth of Things" ;\n  dc:creator "Smith, Jane" ;\n  dc:issued "2020-04-15"^^xsd:date .\n');
    await fsp.writeFile(path.join(root, 'growth.md'),
      '---\ntitle: On Growth\nauthor: Ada Lovelace\ndate: 2026-05-01\n---\n# On Growth\n\nTrees grow, as [[cite::smith-2020]] showed.\n\n## Method\n\nWe watched [[other]].\n');
    await fsp.writeFile(path.join(root, 'other.md'), '# Other\n\nMore.\n');
  });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  const exportHtml = async (pdfProfile?: 'notes' | 'essay' | 'academic', paged = true) => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'growth.md' });
    const out = await runExporter(noteHtmlExporter, { ...plan, paged, ...(pdfProfile ? { pdfProfile } : {}) });
    return String(out.files[0]!.contents).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<time>');
  };

  it.each(['notes', 'essay', 'academic'] as const)('%s: the golden HTML, links and bibliography included', async (profile) => {
    const html = await exportHtml(profile);
    expect(html).toContain('<section class="references">');
    expect(html).toContain('Smith, J.');
    expect(html).toMatchSnapshot();
  });

  it('Notes, and a plan not bound for a page, are the export as it was', async () => {
    expect(await exportHtml('notes')).toBe(await exportHtml(undefined));
    expect(await exportHtml('essay', false)).toBe(await exportHtml(undefined, false));
  });

  it('the tree PDF lays each chapter out in the profile, under its own title page', async () => {
    await fsp.writeFile(path.join(root, 'root.md'), '---\ntitle: The Book\n---\n# The Book\n\nSee [[growth]].\n');
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'root.md', maxDepth: 2 });
    const built = await buildTreePdfHtml({ ...plan, pdfProfile: 'academic' });
    expect(built.html).toContain('<body class="profile-academic">');
    expect(built.html).toMatch(/column-count: 2/);
    expect(built.html).toContain('<section class="tree-pdf-title-page">');
    expect(built.html).not.toContain('<header class="doc-title-block">');
    expect(built.html.match(/<div class="doc-body">/g)).toHaveLength(built.chapterCount);
    const plain = await buildTreePdfHtml(plan);
    expect(plain.html).toContain('<body>');
    expect(plain.html).not.toContain('doc-body');
  });
});
