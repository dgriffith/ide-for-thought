/**
 * An object view's `width` (#2709) on the export surfaces — main's half.
 *
 * The window draws the block at its width and frames it (`frameForWidth`,
 * tested in `tests/renderer/export/render-object-view.test.ts`). What main
 * owes it: telling the window whether the export is PAGED — a PDF's printable
 * width is a hard limit, a screen's isn't — and, on the static site, a page
 * the frame can break out of: a size container to measure against, and the
 * per-note sidebar moved out of the way. The markdown family keeps the fence,
 * `width` included, verbatim.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { extractLiveBlocks, type LiveBlockRenderer } from '../../../src/main/publish/live-blocks';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';
import { staticSiteExporter } from '../../../src/main/publish/exporters/static-site';
import { STATIC_SITE_STYLE } from '../../../src/main/publish/exporters/static-site/style';
import { noteMarkdownExporter } from '../../../src/main/publish/exporters/note-markdown';
import { buildTreePdfHtml } from '../../../src/main/publish/exporters/tree-pdf';
import type { LiveBlockRequest } from '../../../src/shared/live-blocks';

const FENCE = '```object-view\n{"typeId":"task","layout":"kanban","width":1400}\n```';

let root: string;
let asked: LiveBlockRequest[];
/** A window that records what it was asked, and frames the block as a wide one. */
const fakeWindow: LiveBlockRenderer = async (blocks) => {
  asked.push(...blocks);
  return blocks.map((b) => ({
    id: b.id, ok: true,
    html: `<div class="minerva-live-frame"${b.paged ? '' : ' data-breakout="1"'}><div class="minerva-live-block">BOARD</div></div>`,
  }));
};

beforeEach(async () => {
  asked = [];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-width-'));
  await fsp.writeFile(path.join(root, 'board.md'), `# Board\n\nIntro.\n\n${FENCE}\n`, 'utf-8');
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

describe('extractLiveBlocks — paged (#2709)', () => {
  it('marks every request when the export is paged, and none otherwise', () => {
    expect(extractLiveBlocks(`${FENCE}\n`, 'a.md', { paged: true }).blocks.map((b) => b.paged)).toEqual([true]);
    expect(extractLiveBlocks(`${FENCE}\n`, 'a.md').blocks[0]).not.toHaveProperty('paged');
  });
});

describe('a wide object view in the exports', () => {
  it('note HTML asks for a screen render — the block may break out', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'board.md' });
    plan.renderLiveBlocks = fakeWindow;
    const out = await runExporter(noteHtmlExporter, plan);
    expect(asked.map((b) => b.paged)).toEqual([undefined]);
    expect(String(out.files[0]!.contents)).toContain('<div class="minerva-live-frame" data-breakout="1">');
  });

  it('a PDF asks for a paged render — the window keeps it to the printable width', async () => {
    const plan = await resolvePlan(root, { kind: 'tree', relativePath: 'board.md', maxDepth: 1 });
    plan.renderLiveBlocks = fakeWindow;
    const built = await buildTreePdfHtml(plan);
    expect(asked.map((b) => b.paged)).toEqual([true]);
    expect(built.html).toContain('<div class="minerva-live-frame"><div class="minerva-live-block">BOARD');
  });

  it('the static site measures the frame against the column beside its sidebar, and clears the per-note sidebar', async () => {
    const plan = await resolvePlan(root, { kind: 'project' }, { linkPolicy: 'follow-to-file' });
    plan.renderLiveBlocks = fakeWindow;
    const out = await runExporter(staticSiteExporter, plan);
    const page = String(out.files.find((f) => f.path === 'board.html')!.contents);
    expect(page).toMatch(/<div class="page-frame">\s*<main class="page">[\s\S]*BOARD[\s\S]*<\/main>\s*<\/div>/);
    expect(STATIC_SITE_STYLE).toContain('.page-frame { container-type: inline-size;');
    expect(STATIC_SITE_STYLE).toContain('.page:has(.minerva-live-frame[data-breakout]) { grid-template-columns: minmax(0, 1fr); }');
  });

  it('clean markdown keeps the fence, width included, verbatim', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'board.md' });
    const out = await runExporter(noteMarkdownExporter, plan);
    expect(String(out.files.find((f) => f.path === 'board.md')!.contents)).toContain(FENCE);
  });
});
