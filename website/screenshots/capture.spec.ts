/**
 * Docs screenshot harness — Notes section.
 *
 * Launches the packaged app once against a copy of the demo thoughtbase (with
 * the showcase notes from ./fixtures dropped in), then renders each feature note
 * in Preview and crops the rendered content to website/docs/img/<id>.png.
 *
 * The manifest below is the single registry of Notes-section shots. `id` is the
 * output image name (matches the doc page); `note` is the file-tree label to
 * open; `settle` gives async renders (charts, diagrams, live query cells) time
 * to paint before the crop.
 */
import { test } from '@playwright/test';
import { launchDemo, openNote, setView, shoot, shootPreview, type Harness } from './lib/harness';

interface Shot { id: string; note: string; settle?: number }

const NOTES_SHOTS: Shot[] = [
  { id: 'notes-links',        note: 'links' },
  { id: 'notes-highlights',   note: 'highlights' },
  { id: 'notes-tasks',        note: 'tasks' },
  { id: 'notes-callouts',     note: 'callouts' },
  { id: 'notes-footnotes',    note: 'footnotes' },
  { id: 'notes-math',         note: 'math' },
  { id: 'notes-tables',       note: 'tables' },
  { id: 'notes-diagrams',     note: 'diagrams', settle: 1800 },
  { id: 'notes-charts',       note: 'charts',   settle: 1800 },
  { id: 'notes-code',         note: 'code' },
  { id: 'notes-rdf',          note: 'rdf' },
  { id: 'notes-query',        note: 'query',    settle: 2000 },
  { id: 'notes-search',       note: 'search',   settle: 2500 },
];

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

for (const shot of NOTES_SHOTS) {
  test(shot.id, async () => {
    await openNote(h.win, shot.note);
    await setView(h.win, 'Preview');
    if (shot.settle) await h.win.waitForTimeout(shot.settle);
    await shootPreview(h.win, shot.id);
  });
}

// Properties are stripped from the rendered note — they live in the right
// sidebar's Properties panel, so this shot opens that panel instead.
test('notes-frontmatter', async () => {
  await openNote(h.win, 'properties');
  await h.win.locator('[title^="Toggle Right Sidebar"]').first().click();
  await h.win.waitForTimeout(500);
  await h.win.locator('.sub-tab[title="Properties"]').first().click();
  await h.win.waitForTimeout(600);
  await shoot(h.win, 'notes-frontmatter', h.win.locator('.properties-panel'));
});
