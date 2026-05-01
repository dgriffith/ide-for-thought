/**
 * Static-site exporter (#252).
 *
 * Verifies the v1 acceptance: per-note pages with backlinks, tag
 * cloud + per-tag pages, consolidated bibliography, search index,
 * shared style + script, broken-wiki-link strikethrough, private +
 * config-filtered notes excluded from every output file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { staticSiteExporter } from '../../../src/main/publish/exporters/static-site';
import { buildSiteIndex } from '../../../src/main/publish/exporters/static-site/site-data';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-site-'));
}

describe('static-site exporter (#252)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkProject();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('emits one .html per note + style.css + search.js + search.json + index.html', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: First\n---\n# First\n\nA note.\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'), '---\ntitle: Second\n---\n# Second\n\n[[a]]\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);

    const paths = new Set(output.files.map((f) => f.path));
    expect(paths.has('a.html')).toBe(true);
    expect(paths.has('b.html')).toBe(true);
    expect(paths.has('style.css')).toBe(true);
    expect(paths.has('search.js')).toBe(true);
    expect(paths.has('search.json')).toBe(true);
    expect(paths.has('index.html')).toBe(true);
  });

  it('per-note page renders body + nav header + sidebar', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '---\ntitle: First\ntags: [philosophy, draft-test]\n---\n# First\n\nProse.\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const html = String(output.files.find((f) => f.path === 'a.html')!.contents);
    expect(html).toContain('<title>First');
    expect(html).toContain('<nav class="site-nav">');
    expect(html).toContain('<input class="site-search"');
    expect(html).toContain('<aside class="note-meta">');
    expect(html).toContain('#philosophy');
    expect(html).toContain('href="style.css"');
    expect(html).toContain('src="search.js"');
  });

  it('backlinks section appears on the target note for each inbound wiki-link', async () => {
    await fsp.writeFile(path.join(root, 'target.md'), '---\ntitle: Target\n---\n# Target\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'src1.md'), '---\ntitle: Source One\n---\n[[target]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'src2.md'), '---\ntitle: Source Two\n---\n[[target]]\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const html = String(output.files.find((f) => f.path === 'target.html')!.contents);
    expect(html).toContain('<section class="backlinks">');
    expect(html).toContain('Linked from');
    expect(html).toContain('Source One');
    expect(html).toContain('Source Two');
  });

  it('emits a tag cloud at tags/index.html and per-tag pages', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '---\ntitle: A\ntags: [foo]\n---\n# A\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'),
      '---\ntitle: B\ntags: [foo, bar]\n---\n# B\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const cloud = String(output.files.find((f) => f.path === 'tags/index.html')!.contents);
    expect(cloud).toContain('#foo');
    expect(cloud).toContain('#bar');
    // Tag cloud has counts per tag.
    expect(cloud).toMatch(/#foo<span class="count">2/);
    expect(cloud).toMatch(/#bar<span class="count">1/);

    const fooPage = output.files.find((f) => f.path === 'tags/foo.html');
    expect(fooPage).toBeDefined();
    const fooHtml = String(fooPage!.contents);
    expect(fooHtml).toContain('A');
    expect(fooHtml).toContain('B');
  });

  it('emits references.html when at least one note cites a source', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`, 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'), '# A\n[[cite::foo-2020]]\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const refs = String(output.files.find((f) => f.path === 'references.html')!.contents);
    expect(refs).toContain('References');
    expect(refs).toContain('Foo');
  });

  it('omits references.html when nothing was cited', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '# A\nno cites\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    expect(output.files.map((f) => f.path)).not.toContain('references.html');
  });

  it('private notes are excluded from every output file (including search index)', async () => {
    await fsp.writeFile(path.join(root, 'public.md'), '---\ntitle: Public\n---\n# Public\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'private.md'),
      '---\ntitle: Secret\nprivate: true\n---\n# Hush\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const paths = output.files.map((f) => f.path);
    expect(paths).toContain('public.html');
    expect(paths).not.toContain('private.html');
    const search = JSON.parse(String(output.files.find((f) => f.path === 'search.json')!.contents));
    const titles = (search as Array<{ title: string }>).map((r) => r.title);
    expect(titles).toContain('Public');
    expect(titles).not.toContain('Secret');
  });

  it('site-config landing override puts that note at index.html', async () => {
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/site-config.json'), JSON.stringify({
      title: 'My Garden',
      landing: 'home.md',
    }), 'utf-8');
    await fsp.writeFile(path.join(root, 'home.md'),
      '---\ntitle: Welcome\n---\n# Welcome to my garden\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'other.md'),
      '---\ntitle: Other\n---\n# Other\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const indexHtml = String(output.files.find((f) => f.path === 'index.html')!.contents);
    expect(indexHtml).toContain('Welcome to my garden');
    expect(indexHtml).toContain('My Garden');
  });

  it('without a landing override, index.html lists every note alphabetically', async () => {
    await fsp.writeFile(path.join(root, 'b.md'), '---\ntitle: B Note\n---\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: A Note\n---\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const html = String(output.files.find((f) => f.path === 'index.html')!.contents);
    const aIdx = html.indexOf('A Note');
    const bIdx = html.indexOf('B Note');
    expect(aIdx).toBeGreaterThan(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('site-config.excludeTags drops tagged notes from the site', async () => {
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/site-config.json'), JSON.stringify({
      excludeTags: ['draft'],
    }), 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: Public\ntags: [done]\n---\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'), '---\ntitle: WIP\ntags: [draft]\n---\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const paths = output.files.map((f) => f.path);
    expect(paths).toContain('a.html');
    expect(paths).not.toContain('b.html');
  });

  it('broken wiki-links render with a strikethrough class', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '---\ntitle: A\n---\n[[does-not-exist]]\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const html = String(output.files.find((f) => f.path === 'a.html')!.contents);
    expect(html).toContain('class="wikilink-broken"');
  });

  it('depth-aware nav: a nested note links back up to root via ../', async () => {
    await fsp.mkdir(path.join(root, 'sub/deep'), { recursive: true });
    await fsp.writeFile(path.join(root, 'sub/deep/leaf.md'),
      '---\ntitle: Leaf\n---\n# Leaf\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const html = String(output.files.find((f) => f.path === 'sub/deep/leaf.html')!.contents);
    // Two `../` to climb out of `sub/deep/`.
    expect(html).toContain('href="../../style.css"');
    expect(html).toContain('href="../../index.html"');
    expect(html).toContain('src="../../search.js"');
  });

  it('search.json contains a title and snippet per included note', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '---\ntitle: First\n---\n# First\n\nThis is the body of the first note with some words.\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const records = JSON.parse(String(output.files.find((f) => f.path === 'search.json')!.contents));
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe('First');
    expect(records[0].url).toBe('a.html');
    expect(records[0].snippet).toContain('body of the first note');
  });

  it('exposes the expected exporter id + label', () => {
    expect(staticSiteExporter.id).toBe('static-site');
    expect(staticSiteExporter.label).toBe('Project as Static Site');
    expect(staticSiteExporter.acceptedKinds).toEqual(['project']);
    expect(staticSiteExporter.accepts({ kind: 'project' })).toBe(true);
    expect(staticSiteExporter.accepts({ kind: 'single-note' })).toBe(false);
  });
});

describe('buildSiteIndex (#252) — index-builder unit tests', () => {
  it('backlinks: A links to B → B has A in its backlinks', () => {
    const notes = [
      { relativePath: 'a.md', kind: 'note', content: '[[b]]', frontmatter: {}, title: 'A' },
      { relativePath: 'b.md', kind: 'note', content: 'no links', frontmatter: {}, title: 'B' },
    ] as const;
    const index = buildSiteIndex(notes as never);
    const bBacklinks = index.backlinks.get('b.md') ?? [];
    expect(bBacklinks).toHaveLength(1);
    expect(bBacklinks[0].relativePath).toBe('a.md');
  });

  it('backlinks: duplicate links from the same note dedupe', () => {
    const notes = [
      { relativePath: 'a.md', kind: 'note', content: '[[b]] and [[b]] again', frontmatter: {}, title: 'A' },
      { relativePath: 'b.md', kind: 'note', content: '', frontmatter: {}, title: 'B' },
    ] as const;
    const index = buildSiteIndex(notes as never);
    expect(index.backlinks.get('b.md')!.length).toBe(1);
  });

  it('tags: notes with the same tag cluster together', () => {
    const notes = [
      { relativePath: 'a.md', kind: 'note', content: '', frontmatter: { tags: ['foo'] }, title: 'A' },
      { relativePath: 'b.md', kind: 'note', content: '', frontmatter: { tags: ['foo', 'bar'] }, title: 'B' },
    ] as const;
    const index = buildSiteIndex(notes as never);
    expect(index.tags.get('foo')!.length).toBe(2);
    expect(index.tags.get('bar')!.length).toBe(1);
  });

  it('search records: snippet strips frontmatter, headings, and code fences', () => {
    const notes = [{
      relativePath: 'a.md',
      kind: 'note',
      content: '---\ntitle: X\n---\n# Heading\n\nProse here. ```js\ncode\n``` more prose.',
      frontmatter: {},
      title: 'X',
    }] as const;
    const index = buildSiteIndex(notes as never);
    const snippet = index.searchRecords[0].snippet;
    expect(snippet).not.toContain('---');
    expect(snippet).not.toContain('# Heading');
    expect(snippet).not.toContain('```');
    expect(snippet).toContain('Prose here');
    expect(snippet).toContain('more prose');
  });
});
