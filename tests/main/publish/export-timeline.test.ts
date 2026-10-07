/**
 * A Timeline on every export surface (#2609, epic #2606).
 *
 * The drawing itself is made by the window (`renderObjectViewForExport` →
 * `TypeViewTimeline` in export mode → `snapshotLiveBlock`; its own tests and
 * the e2e specs cover that). It is SVG, and each event is an `<a
 * data-note-link>` *inside* the `<svg>` (the HTML parser puts it in the SVG
 * namespace, where `href` is a real link, and a PDF link annotation, per the
 * #2611 spike). This pins what main does with it on each surface:
 *
 * - the HTML family (note HTML, tree HTML, static site, and the PDFs, which
 *   print note HTML's body) splices the window's timeline in where the fence
 *   was, and links each event, in the drawing and in the dated list, under the
 *   export's link policy: an href that lands on a file the export wrote, or
 *   plain text under `inline-title`;
 * - publishing (git, S3) ships a page carrying the timeline and working event
 *   links, checked on the published page itself, not the exporter's string;
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
  pendingChanges: vi.fn(async () => [{ path: 'year.html', status: 'added' }]),
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

const FENCE = '```object-view\n{"typeId":"event","layout":"timeline","from":"1969-07","to":"1969-08"}\n```';
/** Events, one of them a Meeting (an Event subtype since #2612). */
const EVENTS = [
  ['events/Apollo 11.md', 'Apollo 11', 'event', '1969-07-16', '1969-07-24'],
  ['events/Moon landing.md', 'Moon landing', 'event', '1969-07-20', null],
  ['events/Mission debrief.md', 'Mission debrief', 'meeting', '1969-08-12', null],
] as const;
const PAGES = ['events/Apollo 11.html', 'events/Moon landing.html', 'events/Mission debrief.html'];

/** What the window hands back for a timeline: `snapshotLiveBlock`'s shape —
 *  each event an `<a>` inside the SVG drawing, then the dated list. */
const fakeWindow: LiveBlockRenderer = async (blocks) => blocks.map((b) => ({
  id: b.id, ok: true,
  html: `<div class="minerva-live-block"><style>.minerva-live-block .tl-export svg{max-width:100%;height:auto}</style><div data-theme="light"><div class="tl tl-export"><div class="tl-stage"><div class="tl-viewport"><svg class="tl-plot" width="760" height="88" viewBox="0 0 760 88" role="group" aria-label="Event timeline, 3 dated events">${
    EVENTS.map(([p, title], i) => `<a class="tl-event" transform="translate(0 ${8 + i * 24})" aria-label="${title}" data-timeline-event="" data-note-link="${p}" data-kind="point"><circle class="tl-point" cx="${100 + i * 200}" cy="7" r="5"></circle><text class="tl-label" x="${110 + i * 200}" y="11">${title}</text></a>`).join('')
  }</svg></div></div><section class="tl-export-events"><h3 class="tl-undated-head">Dated <span class="tl-undated-count">3</span></h3><ol class="tl-export-list">${
    EVENTS.map(([p, title, , date]) => `<li class="tl-export-row"><a class="tl-list-title" data-note-link="${p}">${title}</a> <span class="tl-list-date">${date}</span></li>`).join('')
  }</ol></section></div></div></div>`,
}));

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-timeline-'));
  await fsp.mkdir(path.join(root, 'events'), { recursive: true });
  await fsp.writeFile(path.join(root, 'year.md'), `# Nineteen sixty-nine\n\n${FENCE}\n`, 'utf-8');
  for (const [p, title, type, date, end] of EVENTS) {
    await fsp.writeFile(path.join(root, p), `---\ntype: ${type}\ndate: ${date}\n${end ? `end: ${end}\n` : ''}---\n# ${title}\n`, 'utf-8');
  }
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

async function exportFile(exporter: Exporter, kind: 'single-note' | 'project', pick: (p: string) => boolean, linkPolicy: LinkPolicy = 'follow-to-file') {
  const input = kind === 'single-note' ? { kind, relativePath: 'year.md' } as const : { kind } as const;
  const plan = await resolvePlan(root, input, { linkPolicy });
  plan.renderLiveBlocks = fakeWindow;
  const out = await runExporter(exporter, plan);
  const file = out.files.find((f) => pick(f.path));
  expect(file, out.files.map((f) => f.path).join(', ')).toBeDefined();
  return { file: file!, files: out.files.map((f) => f.path) };
}

/** Each event's href — in the SVG drawing, or in the dated list — resolved against the page's folder. */
function eventTargets(html: string, cls: 'tl-event' | 'tl-list-title', pageDir: string): string[] {
  const re = new RegExp(`<a class="${cls}"[^>]*href="([^"]+)"`, 'g');
  return [...html.matchAll(re)].map((m) => path.posix.normalize(path.posix.join(pageDir, decodeURIComponent(m[1]!))));
}

function expectTimeline(html: string): void {
  expect(html).toContain('class="minerva-live-block"');
  expect(html).toContain('tl tl-export');
  expect(html).toMatch(/<svg class="tl-plot"[^>]*>[\s\S]*<a class="tl-event"[\s\S]*<\/svg>/); // links inside the SVG
  for (const [, title] of EVENTS) expect(html).toContain(title);
  expect(html).not.toContain('&quot;typeId&quot;');
  expect(html).not.toContain('"typeId"');
  expect(html).not.toContain('```');
  expect(html).not.toContain('data-note-link'); // every event resolved, one way or the other
}

describe('a Timeline in the HTML exports (#2609)', () => {
  for (const [name, exporter, kind] of [
    ['note HTML', noteHtmlExporter, 'single-note'],
    ['tree HTML', treeHtmlExporter, 'project'],
    ['static site', staticSiteExporter, 'project'],
  ] as const) {
    it(`${name}: the window's timeline, each event linked to a page the export wrote`, async () => {
      const { file, files } = await exportFile(exporter, kind, (p) => p === 'year.html');
      const html = String(file.contents);
      expectTimeline(html);
      if (exporter === noteHtmlExporter) {
        // A single-note export ships no page for an event to land on, so it is
        // text, exactly as a wiki-link to that note is.
        expect(html).not.toMatch(/<a class="tl-(event|list-title)"[^>]*href=/);
      } else if (exporter === treeHtmlExporter) {
        // A tree bundle always follows links (its pages are named by the tree's root).
        for (const cls of ['tl-event', 'tl-list-title'] as const) expect(eventTargets(html, cls, '.')).toHaveLength(3);
      } else {
        for (const cls of ['tl-event', 'tl-list-title'] as const) {
          expect(eventTargets(html, cls, '.')).toEqual(PAGES);
          for (const target of eventTargets(html, cls, '.')) expect(files).toContain(target);
        }
      }
    });
  }

  it('note HTML under inline-title: an event is plain text, no link', async () => {
    const { file } = await exportFile(noteHtmlExporter, 'single-note', (p) => p === 'year.html', 'inline-title');
    const html = String(file.contents);
    expectTimeline(html);
    expect(html).not.toMatch(/<a class="tl-(event|list-title)"[^>]*href=/);
    expect(html).toContain('<a class="tl-list-title">Moon landing</a>');
  });
});

describe('a Timeline in a published site (#2609)', () => {
  beforeEach(() => {
    registerBuiltinExporters();
    _setRemoteApprovalsPathForTests(path.join(root, '..', `${path.basename(root)}-approvals.json`));
    approveRemote(root, 'site', 'https://example.org/o/r.git');
  });
  afterEach(() => { fs.rmSync(path.join(root, '..', `${path.basename(root)}-approvals.json`), { force: true }); });

  it('git: the committed page carries the timeline, and its event links land on committed pages', async () => {
    const res = await publishToGit(root, 'site', { renderLiveBlocks: fakeWindow, nowIso: '2026-10-07T00:00:00Z' });
    expect(res.pushed).toBe(true);
    const workTree = path.join(root, '.minerva', 'publish-cache', 'site');
    const html = fs.readFileSync(path.join(workTree, 'year.html'), 'utf-8');
    expectTimeline(html);
    for (const cls of ['tl-event', 'tl-list-title'] as const) {
      const targets = eventTargets(html, cls, '.');
      expect(targets).toEqual(PAGES);
      for (const t of targets) expect(fs.existsSync(path.join(workTree, t)), t).toBe(true);
    }
  });

  it('S3: the uploaded page carries the timeline, and its event links land on uploaded objects', async () => {
    const puts = new Map<string, string>();
    const send = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (cmd.constructor.name === 'ListObjectsV2Command') return { Contents: [], IsTruncated: false };
      if (cmd.constructor.name === 'PutObjectCommand') puts.set(cmd.input.Key as string, String(cmd.input.Body));
      return {};
    });
    const target = { id: 's3', kind: 's3' as const, label: 'S3', exporter: 'static-site', bucket: 'b', subdir: 'site' };
    await publishToS3(root, target, {}, { renderLiveBlocks: fakeWindow }, { client: { send } as unknown as S3Client });
    const html = puts.get('site/year.html');
    expect(html, [...puts.keys()].join(', ')).toBeDefined();
    expectTimeline(html!);
    for (const cls of ['tl-event', 'tl-list-title'] as const) {
      const targets = eventTargets(html!, cls, 'site');
      expect(targets).toEqual(PAGES.map((p) => `site/${p}`));
      for (const t of targets) expect(puts.has(t), t).toBe(true);
    }
  });
});

describe('a Timeline in the markdown exports: the fence, verbatim (#2609, per #2508)', () => {
  for (const [name, exporter, kind] of [
    ['clean markdown', noteMarkdownExporter, 'single-note'],
    ['markdown passthrough', markdownExporter, 'project'],
  ] as const) {
    it(name, async () => {
      const { file } = await exportFile(exporter, kind, (p) => p === 'year.md');
      expect(String(file.contents)).toContain(FENCE);
    });
  }

  it('tree markdown (a zip of clean markdown)', async () => {
    const { file } = await exportFile(treeMarkdownExporter, 'project', (p) => p.endsWith('.zip'));
    const zip = await JSZip.loadAsync(file.contents);
    const entry = Object.keys(zip.files).find((n) => n.endsWith('year.md'));
    expect(entry, Object.keys(zip.files).join(', ')).toBeDefined();
    expect(await zip.file(entry!)!.async('string')).toContain(FENCE);
  });

  it('Pandoc', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'year.md' }, { linkPolicy: 'inline-title' });
    const out = await runExporter(pandocExporter, plan);
    const md = out.files.find((f) => f.path.endsWith('year.md'));
    expect(md, out.files.map((f) => f.path).join(', ')).toBeDefined();
    expect(String(md!.contents)).toContain(FENCE);
  });
});
