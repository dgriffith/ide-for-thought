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

describe('static-site source pages (#252 follow-up)', () => {
  let root: string;
  beforeEach(() => { root = mkProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('emits a source page + sources index + Sources nav for a cited source', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:abstract "A study of foos." ;
  dc:issued "2020"^^xsd:gYear .\n`, 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: Note A\n---\n# A\n[[cite::foo-2020]]\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const byPath = new Map(output.files.map((f) => [f.path, String(f.contents)]));

    const page = byPath.get('sources/foo-2020.html');
    expect(page).toBeDefined();
    expect(page!).toContain('Foo Studies');
    expect(page!).toContain('A study of foos.');      // abstract
    expect(page!).toContain('Cited by');
    expect(page!).toContain('../a.html');             // backlink to the citing note

    expect(byPath.get('sources/index.html')).toContain('foo-2020.html');
    expect(byPath.get('a.html')).toContain('sources/index.html'); // nav link present
  });

  it('omits source pages and the Sources nav link when nothing is cited', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '# A\nno cites\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const paths = output.files.map((f) => f.path);
    expect(paths.some((p) => p.startsWith('sources/'))).toBe(false);
    const a = String(output.files.find((f) => f.path === 'a.html')!.contents);
    expect(a).not.toContain('sources/index.html');
  });

  it('shows the user excerpts and resolves quote-only citations to a source page', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/brooks-1986'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/brooks-1986/meta.ttl'),
      `this: a thought:Book ;
  dc:title "No Silver Bullet" ;
  dc:creator "Brooks, Fred" .\n`, 'utf-8');
    await fsp.mkdir(path.join(root, '.minerva/excerpts'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/excerpts/brooks-essence.ttl'),
      `this: a thought:Excerpt ;
  thought:fromSource sources:brooks-1986 ;
  thought:page 11 ;
  thought:citedText "essence of a software entity" .\n`, 'utf-8');
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: Note A\n---\n# A\nSee [[quote::brooks-essence]]\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const page = String(output.files.find((f) => f.path === 'sources/brooks-1986.html')!.contents);
    expect(page).toContain('No Silver Bullet');
    expect(page).toContain('Excerpts');
    expect(page).toContain('essence of a software entity');
  });
});

describe('static-site link + nav fixes (live GitHub Pages bugs)', () => {
  let root: string;
  beforeEach(() => { root = mkProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('body links are relative to the linking note folder (no doubled directory)', async () => {
    await fsp.mkdir(path.join(root, 'sub'), { recursive: true });
    await fsp.writeFile(path.join(root, 'sub/a.md'), '---\ntitle: A\n---\n# A\nSee [[sub/b]] and [[top]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'sub/b.md'), '---\ntitle: B\n---\n# B\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'top.md'), '---\ntitle: Top\n---\n# Top\n[[sub/a]]\n', 'utf-8');

    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const byPath = new Map(output.files.map((f) => [f.path, String(f.contents)]));

    const aPage = byPath.get('sub/a.html')!;
    expect(aPage).toContain('href="b.html"');          // same folder → bare filename
    expect(aPage).not.toContain('href="sub/b.html"');  // NOT root-relative (would double)
    expect(aPage).toContain('href="../top.html"');     // climb to root

    expect(byPath.get('top.html')!).toContain('href="sub/a.html"'); // root → nested
  });

  it('nav omits Tags/References/Sources links when those pages are not emitted', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: A\n---\n# A\nplain note\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const a = String(output.files.find((f) => f.path === 'a.html')!.contents);
    expect(a).not.toContain('tags/index.html');
    expect(a).not.toContain('references.html');
    expect(a).not.toContain('sources/index.html');
  });

  it('nav includes the Tags link only when the site has tags', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: A\ntags: [x]\n---\n# A\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const a = String(output.files.find((f) => f.path === 'a.html')!.contents);
    expect(a).toContain('tags/index.html');
  });

  it('defaults the site title to the project folder name (#1134)', async () => {
    // No site-config.json → title falls back to the thoughtbase folder name.
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: First\n---\n# First\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'project' });
    const output = await runExporter(staticSiteExporter, plan);
    const projectName = path.basename(root);
    const idx = String(output.files.find((f) => f.path === 'index.html')!.contents);
    expect(idx).toContain(`<title>${projectName}`);
    expect(idx).not.toContain('My Notes');
    // Explicit config title still wins.
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/site-config.json'), JSON.stringify({ title: 'Chosen' }), 'utf-8');
    const out2 = await runExporter(staticSiteExporter, await resolvePlan(root, { kind: 'project' }));
    expect(String(out2.files.find((f) => f.path === 'index.html')!.contents)).toContain('<title>Chosen');
  });

  it('copies .minerva/site.css and links it after style.css (#1135)', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: First\n---\n# First\n', 'utf-8');
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/site.css'), ':root { --accent: #b5179e; }', 'utf-8');
    const output = await runExporter(staticSiteExporter, await resolvePlan(root, { kind: 'project' }));
    expect(output.files.some((f) => f.path === 'site.css')).toBe(true);
    const html = String(output.files.find((f) => f.path === 'a.html')!.contents);
    // Both links present, site.css after style.css so it wins the cascade.
    expect(html.indexOf('href="style.css"')).toBeLessThan(html.indexOf('href="site.css"'));
  });

  it('no site.css → no site.css link (zero-config unchanged, #1135)', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: First\n---\n# First\n', 'utf-8');
    const output = await runExporter(staticSiteExporter, await resolvePlan(root, { kind: 'project' }));
    expect(output.files.some((f) => f.path === 'site.css')).toBe(false);
    expect(String(output.files.find((f) => f.path === 'a.html')!.contents)).not.toContain('site.css');
  });

  it('per-note publish frontmatter emits OG/Twitter meta + validated background + per-note css (#1136)', async () => {
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/site-config.json'), JSON.stringify({ baseUrl: 'https://ex.com/' }), 'utf-8');
    await fsp.writeFile(path.join(root, 'card.md'), [
      '---', 'title: Card', 'description: A share blurb',
      'publish:', '  image: https://ex.com/card.png', '  background: "#faf3e0"', '  css: fancy.css',
      '---', '# Card', '', 'Body.',
    ].join('\n'), 'utf-8');
    await fsp.writeFile(path.join(root, 'fancy.css'), 'article { max-width: 40rem; }', 'utf-8');

    const output = await runExporter(staticSiteExporter, await resolvePlan(root, { kind: 'project' }));
    const html = String(output.files.find((f) => f.path === 'card.html')!.contents);
    expect(html).toContain('<meta name="description" content="A share blurb">');
    expect(html).toContain('<meta property="og:image" content="https://ex.com/card.png">');
    expect(html).toContain('twitter:card" content="summary_large_image"');
    // baseUrl set → canonical + og:url.
    expect(html).toContain('<link rel="canonical" href="https://ex.com/card.html">');
    expect(html).toContain('og:url" content="https://ex.com/card.html"');
    // Validated background applied to <body>; per-note css copied + linked after style.css.
    expect(html).toContain('style="background:#faf3e0"');
    expect(output.files.some((f) => f.path === 'fancy.css')).toBe(true);
    expect(html).toContain('href="fancy.css"');
  });

  it('with baseUrl empty, absolute-URL OG tags are cleanly omitted (#1136)', async () => {
    await fsp.writeFile(path.join(root, 'card.md'),
      '---\ntitle: Card\ndescription: blurb\npublish:\n  image: https://ex.com/c.png\n---\n# Card\n', 'utf-8');
    const output = await runExporter(staticSiteExporter, await resolvePlan(root, { kind: 'project' }));
    const html = String(output.files.find((f) => f.path === 'card.html')!.contents);
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('og:url');
    // description still emitted (relative-safe); og:image still works (absolute).
    expect(html).toContain('name="description"');
    expect(html).toContain('og:image');
  });
});
