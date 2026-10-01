/**
 * Object views in exports (#2510), through the real renderNoteBody: the
 * window's rendered HTML lands where the block was, its rows link exactly as
 * a wiki-link to the same note would, and without a window the block is a
 * one-line note — never the raw spec every export used to print.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolvePlan } from '../../../src/main/publish/pipeline';
import { renderNoteBody } from '../../../src/main/publish/exporters/note-html/render';
import type { LiveBlockRenderer } from '../../../src/main/publish/live-blocks';

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-views-'));
  await fsp.mkdir(path.join(root, 'trip', 'places'), { recursive: true });
  await fsp.writeFile(path.join(root, 'trip', 'plan.md'), '# Plan\n\nSee [[trip/places/Kampa]].\n\n```object-view\n{"typeId":"place","layout":"list"}\n```\n', 'utf-8');
  await fsp.writeFile(path.join(root, 'trip', 'places', 'Kampa.md'), '---\ntype: place\n---\n# Kampa\n', 'utf-8');
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

const fakeWindow: LiveBlockRenderer = async (blocks) =>
  blocks.map((b) => ({ id: b.id, ok: true, html: `<div class="minerva-live-block"><a class="tv-list-row" data-note-link="trip/places/Kampa.md">Kampa</a><!--${b.source.trim()}--></div>` }));

describe('object views in exports (#2510)', () => {
  it('render as the window rendered them, with rows linked like wiki-links (follow-to-file)', async () => {
    const plan = await resolvePlan(root, { kind: 'folder', relativePath: 'trip' }, { linkPolicy: 'follow-to-file' });
    plan.renderLiveBlocks = fakeWindow;
    const html = await renderNoteBody(plan.inputs.find((f) => f.relativePath === 'trip/plan.md')!, plan);
    expect(html).toContain('<a class="tv-list-row" href="places/Kampa.html">Kampa</a>');
    expect(html).toContain('<a href="places/Kampa.html">'); // the wiki-link resolves to the same href
    expect(html).toContain('<!--{"typeId":"place","layout":"list"}-->'); // the block's exact source reached the window
    expect(html).not.toContain('<pre><code>{');
  });

  it('keep the row text without a link under a non-linking policy', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'trip/plan.md' }, { linkPolicy: 'inline-title' });
    plan.renderLiveBlocks = fakeWindow;
    const html = await renderNoteBody(plan.inputs[0]!, plan);
    expect(html).toContain('<a class="tv-list-row">Kampa</a>');
  });

  it('become a one-line note with no window to render them — never raw JSON', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'trip/plan.md' });
    const html = await renderNoteBody(plan.inputs[0]!, plan);
    expect(html).toContain('This view couldn&#39;t be rendered for export');
    expect(html).not.toContain('typeId');
  });
});
