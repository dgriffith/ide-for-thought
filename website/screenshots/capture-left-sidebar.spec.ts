/**
 * Docs screenshot harness — Left sidebar section.
 *
 * Launches the packaged app once against a copy of the demo thoughtbase, then
 * for each shot switches the left sidebar to the relevant panel (Notes / Sources
 * / Tags / Tables / Bookmarks) and crops `aside.sidebar` to website/docs/img/.
 *
 * The panel switcher lives in Sidebar.svelte: each `.panel-tab` button carries
 * `title={label}` (Notes | Sources | Tags | Tables | Bookmarks). The demo vault
 * already ships everything these panels read — a nested notes tree, 3 sources,
 * frontmatter tags, a CSV + a `Table:`-captioned markdown table, and a bookmark
 * — so no fixtures are needed.
 */
import { test } from '@playwright/test';
import { launchDemo, openNote, shoot, type Harness } from './lib/harness';

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Crop the whole left sidebar to `<id>.png`. */
async function shootSidebar(id: string): Promise<void> {
  await shoot(h.win, id, h.win.locator('aside.sidebar'));
}

/** Switch the left sidebar to the panel whose tab title matches `label`. */
async function openPanel(label: string): Promise<void> {
  await h.win.locator(`aside.sidebar .panel-tab[title="${label}"]`).click();
  await h.win.waitForTimeout(600);
}

// Notes tree: expand every folder so the nested mandolin-history structure
// shows, then open a root note so a row reads as the active selection.
test('left-sidebar-notes-tree', async () => {
  await openPanel('Notes');
  await h.win.locator('aside.sidebar .notes-toolbar [title="Expand all folders"]').click();
  await h.win.waitForTimeout(400);
  await openNote(h.win, 'Mandolin Family Tree');
  await shootSidebar('left-sidebar-notes-tree');
});

test('left-sidebar-sources', async () => {
  await openPanel('Sources');
  await shootSidebar('left-sidebar-sources');
});

test('left-sidebar-tags', async () => {
  await openPanel('Tags');
  await shootSidebar('left-sidebar-tags');
});

test('left-sidebar-tables', async () => {
  await openPanel('Tables');
  await shootSidebar('left-sidebar-tables');
});

test('left-sidebar-bookmarks', async () => {
  await openPanel('Bookmarks');
  await shootSidebar('left-sidebar-bookmarks');
});
