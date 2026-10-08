/**
 * Link-hover previews in published HTML (#2710, part 2).
 *
 * The static site (and so git / S3 publishing) and the tree HTML bundle ship
 * one `previews.js` data file keyed by page, built with the app's own
 * `buildNotePreview`, and a `preview.js` that shows it. The rule this file is
 * mostly about: **a preview exists only for a note that is itself
 * published** — an excluded, private, site-config-filtered or missing target
 * has none, and its text appears in NO output file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

/** search.js's sidebar state reads localStorage, which jsdom refuses on file://; not this test's concern. */
const quietConsole = () => new VirtualConsole();
import type { S3Client } from '@aws-sdk/client-s3';

const h = vi.hoisted(() => ({
  gitTarget: {
    id: 'site', label: 'Site', exporter: 'static-site', gitRemote: 'https://example.org/o/r.git',
    gitBranch: 'gh-pages', subdir: '', commitMessageTemplate: 'Publish',
  },
}));
vi.mock('../../../src/main/project-config', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/project-config')>()),
  getPublishTarget: () => h.gitTarget,
  getGitCredentials: () => ({}),
}));
vi.mock('../../../src/main/git/publish-git', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/git/publish-git')>()),
  resolveGitHubToken: vi.fn(() => 'tok'),
  prepareWorkspace: vi.fn(async () => ({ branchExisted: true })),
  clearWorkTree: vi.fn(async () => {}),
  pendingChanges: vi.fn(async () => [{ path: 'index.html', status: 'added' }]),
  stageAll: vi.fn(async () => {}),
  commit: vi.fn(async () => 'sha'),
  push: vi.fn(async () => {}),
}));
vi.mock('@aws-sdk/client-s3', () => {
  class Cmd { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  return {
    S3Client: class { send = vi.fn(); },
    PutObjectCommand: class extends Cmd {},
    ListObjectsV2Command: class extends Cmd {},
    DeleteObjectsCommand: class extends Cmd {},
    HeadBucketCommand: class extends Cmd {},
  };
});

import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { registerBuiltinExporters } from '../../../src/main/publish';
import { staticSiteExporter } from '../../../src/main/publish/exporters/static-site';
import { treeHtmlExporter } from '../../../src/main/publish/exporters/tree-html';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';
import { publishToGit } from '../../../src/main/publish/publish-to-git';
import { publishToS3 } from '../../../src/main/publish/publish-to-s3';
import { _setRemoteApprovalsPathForTests, approveRemote } from '../../../src/main/publish/remote-approvals';
import { buildLinkPreviews, linkPreviewsScript, LINK_PREVIEWS_GLOBAL, type LinkPreviewMap } from '../../../src/main/publish/link-previews';
import { buildNotePreview } from '../../../src/shared/note-preview';
import type { ExportOutputFile, LinkPolicy } from '../../../src/main/publish/types';

const SHED = '# Garden Shed\n\nA cedar shed at the bottom of the garden, built over two summers.\n\n## Roof\n\nCedar shingles, laid in May.\n\nA block paragraph. ^nails\n';
const XSS = '# Hostile\n\n<script>window.__pwned = 1</script> and <img src=x onerror="window.__pwned = 2"> & "quotes"\n';
/** Canaries: each excluded target's body. None may appear in any output file. */
const CANARIES = ['CANARY-private-flag', 'CANARY-private-folder', 'CANARY-private-tag', 'CANARY-site-config'];

const NOTES: Record<string, string> = {
  'Links.md': '# Links\n\nSee [[Garden Shed]], its [[Garden Shed#Roof]], its [[Garden Shed#^nails|nails]], [[Hostile]], [[Diary]], [[Plans]], [[Journal]], [[Draft]] and [[Nowhere]].\n\n![[Draft]]\n',
  'projects/Garden Shed.md': `---\ntype: project\n---\n${SHED}`,
  'Hostile.md': XSS,
  // The tree closure follows full paths.
  'Tree.md': '# Tree\n\n[[projects/Garden Shed]], its [[projects/Garden Shed#Roof]], and [[Diary]] and [[private/Plans]].\n',
  'Diary.md': `---\nprivate: true\n---\n# Diary\n\n${CANARIES[0]}\n`,
  'private/Plans.md': `# Plans\n\n${CANARIES[1]}\n`,
  'Journal.md': `---\ntags: [private]\n---\n# Journal\n\n${CANARIES[2]}\n`,
  // Filtered by the site config (`excludeTags: [wip]`) — and transcluded by Links.md.
  'Draft.md': `---\ntags: [wip]\n---\n# Draft\n\n${CANARIES[3]}\n`,
};

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-link-previews-'));
  for (const [rel, body] of Object.entries(NOTES)) {
    await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fsp.writeFile(path.join(root, rel), body, 'utf-8');
  }
  await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
  await fsp.writeFile(path.join(root, '.minerva', 'site-config.json'), JSON.stringify({ excludeTags: ['wip'] }), 'utf-8');
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

async function site(): Promise<ExportOutputFile[]> {
  return (await runExporter(staticSiteExporter, await resolvePlan(root, { kind: 'project' }))).files;
}

/** Run a `previews.js` in a fresh VM context and return the map it assigns. */
function previewsOf(files: ExportOutputFile[] | Map<string, string>, file = 'previews.js'): LinkPreviewMap {
  const js = files instanceof Map ? files.get(file) : String(files.find((f) => f.path === file)?.contents);
  expect(js, `${file} written`).toBeTruthy();
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(js!, { window: sandbox });
  return sandbox[LINK_PREVIEWS_GLOBAL] as LinkPreviewMap;
}

const preview = (rel: string, section = {}) => {
  const p = buildNotePreview(NOTES[rel]!, rel, section);
  return { t: p.title, s: p.snippet };
};

function expectNoCanary(files: Iterable<[string, string]>): void {
  for (const [p, text] of files) {
    for (const c of CANARIES) expect(text, `${c} leaked into ${p}`).not.toContain(c);
  }
}

describe('static site: previews (#2710)', () => {
  it('ships one data file, keyed by page, with the app\'s preview of each published note', async () => {
    const files = await site();
    const map = previewsOf(files);
    expect(map['projects/Garden Shed.html']).toEqual(preview('projects/Garden Shed.md'));
    expect(map['projects/Garden Shed.html']!.s).toContain('cedar shed');
    expect(map['Links.html']).toEqual(preview('Links.md'));
    // A link to a section carries the section's preview, under the fragment the link uses.
    expect(map['projects/Garden Shed.html#roof']).toEqual(preview('projects/Garden Shed.md', { heading: 'Roof' }));
    expect(map['projects/Garden Shed.html#roof']!.s).toContain('Cedar shingles');
    expect(map['projects/Garden Shed.html#^nails']).toEqual(preview('projects/Garden Shed.md', { blockId: 'nails' }));
    const page = String(files.find((f) => f.path === 'Links.html')!.contents);
    expect(page).toContain('href="projects/Garden%20Shed.html#roof"');
    expect(page).toContain('href="projects/Garden%20Shed.html#^nails"');
    // Every page loads the script, from the site root; style.css styles it.
    expect(page).toContain('<script src="preview.js" defer></script>');
    expect(String(files.find((f) => f.path === 'projects/Garden Shed.html')!.contents)).toContain('<script src="../preview.js" defer></script>');
    expect(String(files.find((f) => f.path === 'style.css')!.contents)).toContain('.minerva-link-preview');
    expect(files.some((f) => f.path === 'preview.js')).toBe(true);
  });

  it('an excluded, private, site-config-filtered or missing target has no preview, and its text is in NO output file', async () => {
    const files = await site();
    const map = previewsOf(files);
    expect(Object.keys(map).sort()).toEqual([
      'Hostile.html', 'Links.html', 'Tree.html',
      'projects/Garden Shed.html', 'projects/Garden Shed.html#^nails', 'projects/Garden Shed.html#roof',
    ]);
    expectNoCanary(files.map((f) => [f.path, String(f.contents)] as [string, string]));
    // Not linked either: a link to a note the site doesn't publish is broken text, not an href to a missing page.
    const page = String(files.find((f) => f.path === 'Links.html')!.contents);
    for (const name of ['Diary', 'Plans', 'Journal', 'Draft', 'Nowhere']) {
      expect(page).toContain(`<em class="wikilink-broken">${name}</em>`);
      expect(page).not.toMatch(new RegExp(`href="[^"]*${name}`));
    }
  });

  it('a hostile snippet is escaped in the data file, and the page script shows it as text', async () => {
    const files = await site();
    const js = String(files.find((f) => f.path === 'previews.js')!.contents);
    expect(js).not.toMatch(/<script|<img|<\/script/i);
    expect(previewsOf(files)['Hostile.html']).toEqual(preview('Hostile.md'));

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-link-previews-out-'));
    try {
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(outDir, f.path)), { recursive: true });
        fs.writeFileSync(path.join(outDir, f.path), f.contents);
      }
      const dom = await JSDOM.fromFile(path.join(outDir, 'Links.html'), { runScripts: 'dangerously', resources: 'usable', virtualConsole: quietConsole() });
      try {
        const { window } = dom;
        await new Promise<void>((resolve) => { window.addEventListener('load', () => resolve()); });
        const doc = window.document;
        const link = doc.querySelector('article a[href="Hostile.html"]') as HTMLAnchorElement;
        expect(link).toBeTruthy();
        link.focus(); // keyboard focus (:focus-visible) opens it at once
        const tip = await poll(() => doc.querySelector('#minerva-link-preview:not([hidden])'));
        expect(tip.getAttribute('role')).toBe('tooltip');
        expect(link.getAttribute('aria-describedby')).toBe('minerva-link-preview');
        expect(tip.querySelector('.mlp-title')!.textContent).toBe('Hostile');
        expect(tip.querySelector('.mlp-snippet')!.textContent).toBe(preview('Hostile.md').s);
        expect(tip.querySelector('script, img')).toBeNull();
        expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
        // Escape closes it, and the link no longer points at it.
        doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(tip.hasAttribute('hidden')).toBe(true);
        expect(link.hasAttribute('aria-describedby')).toBe(false);
        // A link to an unpublished note has no href, so nothing to preview.
        // The structure sidebar links every page too, but only the page body gets previews.
        const sidebarLink = doc.querySelector('.site-tree a[href="Hostile.html"]') as HTMLAnchorElement;
        sidebarLink.focus();
        expect(tip.hasAttribute('hidden')).toBe(true);
        const broken = doc.querySelector('.wikilink-broken')!;
        broken.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
        broken.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        expect(tip.hasAttribute('hidden')).toBe(true);
      } finally {
        dom.window.close();
      }
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('tree HTML and single-note HTML (#2710)', () => {
  it('tree HTML: the same data file and script, from the bundle\'s notes only', async () => {
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'Tree.md' });
    const files = (await runExporter(treeHtmlExporter, plan)).files;
    const map = previewsOf(files);
    expect(map['projects/Garden Shed.html']).toEqual(preview('projects/Garden Shed.md'));
    expect(map['projects/Garden Shed.html#roof']).toEqual(preview('projects/Garden Shed.md', { heading: 'Roof' }));
    expect(String(files.find((f) => f.path === 'index.html')!.contents)).toContain('<script src="preview.js" defer></script>');
    expect(String(files.find((f) => f.path === 'style.css')!.contents)).toContain('.minerva-link-preview');
    expect(Object.keys(map).sort()).toEqual(['Tree.html', 'projects/Garden Shed.html', 'projects/Garden Shed.html#roof']);
    // The private notes the tree links to were excluded by the pipeline: no preview, no text anywhere.
    expect(plan.excluded.map((e) => e.relativePath).sort()).toEqual(['Diary.md', 'private/Plans.md']);
    expectNoCanary(files.map((f) => [f.path, String(f.contents)] as [string, string]));
  });

  for (const policy of ['inline-title', 'follow-to-file'] as LinkPolicy[]) {
    it(`single-note HTML (${policy}): no preview script and no data — nothing else is published`, async () => {
      const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'Links.md' }, { linkPolicy: policy });
      const files = (await runExporter(noteHtmlExporter, plan)).files;
      expect(files.map((f) => f.path)).toEqual(['Links.html']);
      const html = String(files[0]!.contents);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('minerva-link-preview');
      expect(html).not.toContain('cedar shed');
    });
  }
});

describe('buildLinkPreviews (#2710)', () => {
  it('reads only the notes it is handed: a link to anything else has no entry', () => {
    const published = [{ relativePath: 'a.md', kind: 'note' as const, content: '# A\n\n[[b]] [[b#H]] [[c#H]]\n', frontmatter: {}, title: 'A' }];
    const map = buildLinkPreviews({ published, pageFor: (p) => p.replace(/\.md$/, '.html'), resolveTarget: (t) => `${t}.md` });
    expect(Object.keys(map)).toEqual(['a.html']);
  });

  it('drops hidden fences, which no export publishes (#2509)', () => {
    const content = '# A\n\nVisible.\n\n```turtle-hidden\n<urn:canary> <urn:p> "x" .\n```\n';
    const map = buildLinkPreviews({ published: [{ relativePath: 'a.md', kind: 'note', content, frontmatter: {}, title: 'A' }], pageFor: (p) => p, resolveTarget: () => null });
    expect(map['a.md']!.s).toBe('Visible.');
  });

  it('the data file is an inert assignment: no `<`, no raw line separators', () => {
    const js = linkPreviewsScript({ 'a.html': { t: '</script><b>', s: 'x y' } });
    expect(js).not.toContain('<');
    expect(js).not.toContain(' ');
    const sandbox: Record<string, unknown> = {};
    vm.runInNewContext(js, { window: sandbox });
    expect(sandbox[LINK_PREVIEWS_GLOBAL]).toEqual({ 'a.html': { t: '</script><b>', s: 'x y' } });
  });
});

describe('published sites carry the previews (#2710)', () => {
  beforeEach(() => {
    registerBuiltinExporters();
    _setRemoteApprovalsPathForTests(path.join(root, '..', `${path.basename(root)}-approvals.json`));
    approveRemote(root, 'site', 'https://example.org/o/r.git');
  });
  afterEach(() => { fs.rmSync(path.join(root, '..', `${path.basename(root)}-approvals.json`), { force: true }); });

  it('git: the committed tree has the data file and script; no excluded text anywhere in it', async () => {
    const res = await publishToGit(root, 'site', { nowIso: '2026-10-07T00:00:00Z' });
    expect(res.pushed).toBe(true);
    const workTree = path.join(root, '.minerva', 'publish-cache', 'site');
    const committed = new Map<string, string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else committed.set(path.relative(workTree, abs).split(path.sep).join('/'), fs.readFileSync(abs, 'utf-8'));
      }
    };
    walk(workTree);
    expect(committed.has('preview.js')).toBe(true);
    expect(committed.get('Links.html')).toContain('<script src="preview.js" defer></script>');
    expect(previewsOf(committed)['projects/Garden Shed.html']).toEqual(preview('projects/Garden Shed.md'));
    expectNoCanary(committed);
  });

  it('S3: the uploaded bodies have the data file and script; no excluded text in any of them', async () => {
    const puts = new Map<string, string>();
    const send = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (cmd.constructor.name === 'ListObjectsV2Command') return { Contents: [], IsTruncated: false };
      if (cmd.constructor.name === 'PutObjectCommand') puts.set(cmd.input.Key as string, String(cmd.input.Body));
      return {};
    });
    const target = { id: 's3', kind: 's3' as const, label: 'S3', exporter: 'static-site', bucket: 'b', subdir: 'site' };
    await publishToS3(root, target, {}, {}, { client: { send } as unknown as S3Client });
    expect(puts.has('site/preview.js')).toBe(true);
    expect(previewsOf(puts, 'site/previews.js')['projects/Garden Shed.html']).toEqual(preview('projects/Garden Shed.md'));
    expectNoCanary(puts);
  });
});

async function poll<T>(get: () => T | null, ms = 2000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
