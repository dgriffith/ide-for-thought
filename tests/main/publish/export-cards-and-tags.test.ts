/**
 * Link cards and #tags in exports (#2526), main side: a card paragraph the
 * window doesn't render stays an ordinary, policy-correct link (never an
 * error note); tags are chips in a single file and links in a static site,
 * whose every tag link — body, sidebar, cloud — names the file it wrote.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { renderNoteBody } from '../../../src/main/publish/exporters/note-html/render';
import { staticSiteExporter } from '../../../src/main/publish/exporters/static-site';

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-cards-tags-'));
  await fsp.mkdir(path.join(root, 'places'), { recursive: true });
  await fsp.writeFile(path.join(root, 'plan.md'), '---\ntags: [trip/prague]\n---\n# Plan\n\n[[Kampa Museum]]\n\nVisiting #trip/prague soon, #museums too.\n', 'utf-8');
  await fsp.writeFile(path.join(root, 'places', 'Kampa Museum.md'), '# Kampa Museum\n\n#museums\n', 'utf-8');
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

describe('cards (#2526)', () => {
  it('with no window to render it, a card paragraph is an ordinary link under the export\'s policy', async () => {
    const plan = await resolvePlan(root, { kind: 'project' }, { linkPolicy: 'follow-to-file' });
    const html = await renderNoteBody(plan.inputs.find((f) => f.relativePath === 'plan.md')!, plan);
    expect(html).toContain('<p><a href="places/Kampa%20Museum.html">Kampa Museum</a></p>');
    expect(html).not.toContain('couldn&#39;t be rendered');
  });

  it('a window that declines (an untyped note) gets the same ordinary link', async () => {
    const plan = await resolvePlan(root, { kind: 'project' }, { linkPolicy: 'follow-to-file' });
    plan.renderLiveBlocks = async (blocks) => blocks.map((b) => ({ id: b.id, ok: true, html: '' }));
    const html = await renderNoteBody(plan.inputs.find((f) => f.relativePath === 'plan.md')!, plan);
    expect(html).toContain('<p><a href="places/Kampa%20Museum.html">Kampa Museum</a></p>');
  });
});

describe('#tags (#2526)', () => {
  it('a single-file export shows the preview\'s tag chip', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'plan.md' });
    const html = await renderNoteBody(plan.inputs[0]!, plan);
    expect(html).toContain('<span class="note-tag" data-tag="trip/prague">#trip/prague</span>');
  });

  it('a static site links every tag to the page it wrote — hierarchical tags included', async () => {
    const plan = await resolvePlan(root, { kind: 'project' });
    const out = await runExporter(staticSiteExporter, plan);
    const files = new Map(out.files.map((f) => [f.path, String(f.contents)]));
    expect(files.has('tags/trip-prague.html')).toBe(true);
    const page = [...files.entries()].find(([p]) => p.endsWith('plan.html'))![1];
    // Body tag, and the note's sidebar tag list, both name the written file.
    expect(page).toContain('<a class="note-tag" href="tags/trip-prague.html">#trip/prague</a>');
    expect(page).toContain('<a href="tags/trip-prague.html">#trip/prague</a>');
    expect(page).not.toContain('trip%2Fprague');
    expect(files.get('tags/index.html')).toContain('href="trip-prague.html"');
  });
});
