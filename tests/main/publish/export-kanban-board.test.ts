/**
 * A Kanban board on every export surface (#2604, epic #2600).
 *
 * The board itself is drawn by the window (`renderObjectViewForExport` →
 * `TypeViewKanban` in export mode → `snapshotLiveBlock`; its own tests and the
 * e2e specs cover that). This pins what main does with it on each surface:
 *
 * - the HTML family (note HTML, tree HTML, static site — and the PDFs, which
 *   print note HTML's body) splices the window's board in where the fence was,
 *   and links each card under the export's link policy: a working href that
 *   lands on a file the export wrote, or plain text under `inline-title`;
 * - publishing (git, S3) ships a page carrying the board and working card
 *   links — checked on the published page itself, not the exporter's string;
 * - the markdown family (clean markdown, passthrough, tree markdown, Pandoc)
 *   keeps the fence verbatim, by #2508's decision: portable source.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import JSZip from 'jszip';

const h = vi.hoisted(() => ({
  gitTarget: {
    id: 'site', label: 'Site', exporter: 'static-site', gitRemote: 'https://example.org/o/r.git',
    gitBranch: 'gh-pages', subdir: '', commitMessageTemplate: 'Publish',
  },
}));
// Only the target lookup is stubbed; the rest of project-config (base URI,
// exclusions) stays real, so the export runs exactly as a publish does.
vi.mock('../../../src/main/project-config', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/project-config')>()),
  getPublishTarget: () => h.gitTarget,
  getGitCredentials: () => ({}),
}));
// Git transport: no clone, commit or push — the page is read from the work
// tree the commit would take.
vi.mock('../../../src/main/git/publish-git', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/git/publish-git')>()),
  resolveGitHubToken: vi.fn(() => 'tok'),
  prepareWorkspace: vi.fn(async () => ({ branchExisted: true })),
  clearWorkTree: vi.fn(async () => {}),
  pendingChanges: vi.fn(async () => [{ path: 'board.html', status: 'added' }]),
  stageAll: vi.fn(async () => {}),
  commit: vi.fn(async () => 'sha'),
  push: vi.fn(async () => {}),
}));
// See publish-to-s3.test.ts: the real SDK mis-resolves under the runner.
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
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';
import { treeHtmlExporter } from '../../../src/main/publish/exporters/tree-html';
import { staticSiteExporter } from '../../../src/main/publish/exporters/static-site';
import { noteMarkdownExporter } from '../../../src/main/publish/exporters/note-markdown';
import { markdownExporter } from '../../../src/main/publish/exporters/markdown';
import { treeMarkdownExporter } from '../../../src/main/publish/exporters/tree-markdown';
import { pandocExporter } from '../../../src/main/publish/exporters/pandoc';
import { publishToGit } from '../../../src/main/publish/publish-to-git';
import { publishToS3 } from '../../../src/main/publish/publish-to-s3';
import { _setRemoteApprovalsPathForTests, approveRemote } from '../../../src/main/publish/remote-approvals';
import type { Exporter, LinkPolicy } from '../../../src/main/publish/types';
import type { LiveBlockRenderer } from '../../../src/main/publish/live-blocks';

const FENCE = '```object-view\n{"typeId":"project","layout":"kanban","groupBy":"status","columnOrder":["done"]}\n```';
const CARDS = [['projects/Garden Shed.md', 'Garden Shed', 'active'], ['projects/Tax Return.md', 'Tax Return', 'done']] as const;

/** What the window hands back for a board: `snapshotLiveBlock`'s shape. */
const fakeWindow: LiveBlockRenderer = async (blocks) => blocks.map((b) => ({
  id: b.id, ok: true,
  html: `<div class="minerva-live-block"><style>.minerva-live-block .kb-board.kb-export{display:grid}</style><div data-theme="light"><div class="kb-board kb-export">${
    CARDS.map(([p, title, status]) => `<section class="kb-column" data-column-value="${status}"><h2 class="kb-col-header"><span class="kb-col-label">${status}</span><span class="kb-col-count">1</span></h2><ul class="kb-cards"><li class="kb-item"><a class="kb-card" data-kanban-card="" data-note-link="${p}"><span class="kb-card-name">${title}</span></a></li></ul></section>`).join('')
  }</div></div></div>`,
}));

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-kanban-'));
  await fsp.mkdir(path.join(root, 'projects'), { recursive: true });
  await fsp.writeFile(path.join(root, 'board.md'), `# Board\n\n${FENCE}\n`, 'utf-8');
  for (const [p, title, status] of CARDS) await fsp.writeFile(path.join(root, p), `---\ntype: project\nstatus: ${status}\n---\n# ${title}\n`, 'utf-8');
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

async function exportFile(exporter: Exporter, kind: 'single-note' | 'project', pick: (p: string) => boolean, linkPolicy: LinkPolicy = 'follow-to-file') {
  const input = kind === 'single-note' ? { kind, relativePath: 'board.md' } as const : { kind } as const;
  const plan = await resolvePlan(root, input, { linkPolicy });
  plan.renderLiveBlocks = fakeWindow;
  const out = await runExporter(exporter, plan);
  const file = out.files.find((f) => pick(f.path));
  expect(file, out.files.map((f) => f.path).join(', ')).toBeDefined();
  return { file: file!, files: out.files.map((f) => f.path) };
}

/** Each card's href, resolved against the page's folder, decoded. */
function cardTargets(html: string, pageDir: string): string[] {
  return [...html.matchAll(/<a class="kb-card"[^>]*href="([^"]+)"/g)].map((m) => path.posix.normalize(path.posix.join(pageDir, decodeURIComponent(m[1]!))));
}

function expectBoard(html: string): void {
  expect(html).toContain('class="minerva-live-block"');
  expect(html).toContain('kb-board kb-export');
  expect(html).toContain('Garden Shed');
  expect(html).toContain('Tax Return');
  expect(html).not.toContain('&quot;typeId&quot;');
  expect(html).not.toContain('```');
  expect(html).not.toContain('data-note-link'); // every card resolved, one way or the other
}

describe('a Kanban board in the HTML exports (#2604)', () => {
  for (const [name, exporter, kind, page] of [
    ['note HTML', noteHtmlExporter, 'single-note', 'board.html'],
    ['tree HTML', treeHtmlExporter, 'project', 'board.html'],
    ['static site', staticSiteExporter, 'project', 'board.html'],
  ] as const) {
    it(`${name}: the window's board, each card linked to a page the export wrote`, async () => {
      const { file, files } = await exportFile(exporter, kind, (p) => p === page || (kind === 'project' && exporter === treeHtmlExporter && p.endsWith('.html')));
      const html = String(file.contents);
      expectBoard(html);
      if (exporter === staticSiteExporter) {
        // Every card lands on a page the site ships.
        expect(cardTargets(html, '.')).toEqual(['projects/Garden Shed.html', 'projects/Tax Return.html']);
        for (const target of cardTargets(html, '.')) expect(files).toContain(target);
      } else if (exporter === treeHtmlExporter) {
        expect([...html.matchAll(/<a class="kb-card"[^>]*href="([^"]+)"/g)]).toHaveLength(2);
      } else {
        // A single-note export ships no page for a card to land on, so the
        // card is text — exactly as a wiki-link to that note is.
        expect(html).not.toMatch(/<a class="kb-card"[^>]*href=/);
      }
    });
  }

  it('note HTML under inline-title: a card is plain text, no link', async () => {
    const { file } = await exportFile(noteHtmlExporter, 'single-note', (p) => p.endsWith('.html'), 'inline-title');
    const html = String(file.contents);
    expectBoard(html);
    expect(html).toContain('<a class="kb-card" data-kanban-card=""><span class="kb-card-name">Garden Shed</span></a>');
    expect(html).not.toMatch(/<a class="kb-card"[^>]*href=/);
  });
});

describe('a Kanban board in a published site (#2604)', () => {
  beforeEach(() => {
    registerBuiltinExporters();
    _setRemoteApprovalsPathForTests(path.join(root, '..', `${path.basename(root)}-approvals.json`));
    approveRemote(root, 'site', 'https://example.org/o/r.git');
  });
  afterEach(() => { fs.rmSync(path.join(root, '..', `${path.basename(root)}-approvals.json`), { force: true }); });

  it('git: the committed page carries the board, and its card links land on committed pages', async () => {
    const res = await publishToGit(root, 'site', { renderLiveBlocks: fakeWindow, nowIso: '2026-10-06T00:00:00Z' });
    expect(res.pushed).toBe(true);
    const workTree = path.join(root, '.minerva', 'publish-cache', 'site');
    const html = fs.readFileSync(path.join(workTree, 'board.html'), 'utf-8');
    expectBoard(html);
    const targets = cardTargets(html, '.');
    expect(targets).toEqual(['projects/Garden Shed.html', 'projects/Tax Return.html']);
    for (const t of targets) expect(fs.existsSync(path.join(workTree, t)), t).toBe(true);
  });

  it('S3: the uploaded page carries the board, and its card links land on uploaded objects', async () => {
    const puts = new Map<string, string>();
    const send = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (cmd.constructor.name === 'ListObjectsV2Command') return { Contents: [], IsTruncated: false };
      if (cmd.constructor.name === 'PutObjectCommand') puts.set(cmd.input.Key as string, String(cmd.input.Body));
      return {};
    });
    const target = { id: 's3', kind: 's3' as const, label: 'S3', exporter: 'static-site', bucket: 'b', subdir: 'site' };
    await publishToS3(root, target, {}, { renderLiveBlocks: fakeWindow }, { client: { send } as unknown as S3Client });
    const html = puts.get('site/board.html');
    expect(html, [...puts.keys()].join(', ')).toBeDefined();
    expectBoard(html!);
    const targets = cardTargets(html!, 'site');
    expect(targets).toEqual(['site/projects/Garden Shed.html', 'site/projects/Tax Return.html']);
    for (const t of targets) expect(puts.has(t), t).toBe(true);
  });
});

describe('a Kanban board in the markdown exports: the fence, verbatim (#2604, per #2508)', () => {
  for (const [name, exporter, kind] of [
    ['clean markdown', noteMarkdownExporter, 'single-note'],
    ['markdown passthrough', markdownExporter, 'project'],
  ] as const) {
    it(name, async () => {
      const { file } = await exportFile(exporter, kind, (p) => p === 'board.md');
      expect(String(file.contents)).toContain(FENCE);
    });
  }

  it('tree markdown (a zip of clean markdown)', async () => {
    const { file } = await exportFile(treeMarkdownExporter, 'project', (p) => p.endsWith('.zip'));
    const zip = await JSZip.loadAsync(file.contents);
    const entry = Object.keys(zip.files).find((n) => n.endsWith('board.md'));
    expect(entry, Object.keys(zip.files).join(', ')).toBeDefined();
    expect(await zip.file(entry!)!.async('string')).toContain(FENCE);
  });

  it('Pandoc', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'board.md' }, { linkPolicy: 'inline-title' });
    const out = await runExporter(pandocExporter, plan);
    const md = out.files.find((f) => f.path.endsWith('board.md'));
    expect(md, out.files.map((f) => f.path).join(', ')).toBeDefined();
    expect(String(md!.contents)).toContain(FENCE);
  });
});
