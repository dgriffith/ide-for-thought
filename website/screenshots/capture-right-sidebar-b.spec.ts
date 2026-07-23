/**
 * Docs screenshot harness — Right sidebar (batch B: Links + Activity groups).
 *
 * Captures the Outgoing, Backlinks, Related, Citations, Bookmarks and Proposals
 * panels of the right sidebar. Each test opens a note that populates the panel,
 * reveals the right sidebar, switches to the panel's group + sub-tab, and crops
 * `aside.right-sidebar` so the group chips, the active sub-tab, the panel title
 * and its populated body are all visible.
 *
 * Data sourcing (no live model needed):
 * - Outgoing / Backlinks — real richly-linked history notes in the demo vault.
 * - Related — an existing note that is present in the pre-built vector index.
 * - Citations — a fixture note that cites two real `.minerva/sources` entries
 *   via `[[cite::<sourceId>]]`.
 * - Bookmarks — the demo vault already ships one bookmark on "Mandolin Family
 *   Tree" (`.minerva/bookmarks.json`).
 * - Proposals — a fixture note whose embedded turtle cell seeds a few
 *   `thought:Proposal` nodes so the review queue has content (no live approval
 *   flow, which would require an API key).
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

/** The crop target for every shot: the whole right sidebar, so the active
 *  group chip + sub-tab + panel title + body all read in one image. */
const RIGHT_SIDEBAR = 'aside.right-sidebar';

/** Reveal the right sidebar if it isn't already showing. It's a persistent,
 *  app-level toggle, so blindly clicking would close it on the second test —
 *  hence the visibility guard. */
async function ensureRightSidebar(win: Harness['win']): Promise<void> {
  const aside = win.locator(RIGHT_SIDEBAR);
  if (await aside.isVisible().catch(() => false)) return;
  await win.locator('[title^="Toggle Right Sidebar"]').first().click();
  await win.locator(RIGHT_SIDEBAR).waitFor({ state: 'visible', timeout: 5000 });
  await win.waitForTimeout(400);
}

/** Switch the right sidebar to a group chip + one of its panels. Clicking the
 *  group first is required — the sub-strip only renders the active group's
 *  items (see RightSidebar.svelte). */
async function openPanel(win: Harness['win'], group: string, panel: string): Promise<void> {
  await ensureRightSidebar(win);
  await win.locator(`.group-tab[title="${group}"]`).first().click();
  await win.waitForTimeout(200);
  await win.locator(`.sub-tab[title="${panel}"]`).first().click();
  await win.waitForTimeout(500);
}

/** Folders start collapsed and the file tree only auto-reveals a note *after*
 *  it becomes active — a chicken-and-egg for a tree click. Expand ancestors
 *  first. Guarded by the chevron's aria-label so re-running never collapses. */
async function ensureExpanded(win: Harness['win'], relPath: string): Promise<void> {
  const chev = win
    .locator(`aside.sidebar .tree-item.dir[data-relative-path="${relPath}"] [data-chevron]`)
    .first();
  await chev.waitFor({ state: 'visible', timeout: 5000 });
  const label = (await chev.getAttribute('aria-label')) ?? '';
  if (label.toLowerCase().startsWith('expand')) {
    await chev.click();
    await win.waitForTimeout(250);
  }
}

/** Open a note that lives under notes/mandolin-history/ by first expanding its
 *  two ancestor folders, then clicking its (now-visible) tree row. */
async function openHistoryNote(win: Harness['win'], label: string): Promise<void> {
  await ensureExpanded(win, 'notes');
  await ensureExpanded(win, 'notes/mandolin-history');
  await openNote(win, label);
}

test('right-sidebar-outgoing-links', async () => {
  // This note carries typed links (references / supports / supersedes / …), so
  // the Outgoing panel renders several colour-coded type groups.
  await openHistoryNote(h.win, 'America and the Gibson Revolution');
  await openPanel(h.win, 'Links', 'Outgoing');
  await h.win.waitForTimeout(500);
  await shoot(h.win, 'right-sidebar-outgoing-links', h.win.locator(RIGHT_SIDEBAR));
});

test('right-sidebar-backlinks', async () => {
  // The hub note of the vault — a dozen other notes link to it.
  await openHistoryNote(h.win, 'History of the Mandolin');
  await openPanel(h.win, 'Links', 'Backlinks');
  await h.win.waitForTimeout(500);
  await shoot(h.win, 'right-sidebar-backlinks', h.win.locator(RIGHT_SIDEBAR));
});

test('right-sidebar-related', async () => {
  // Related is semantic: it reads the pre-built vector index, which already
  // covers this existing note. Give the embedding runtime time to answer.
  await openHistoryNote(h.win, 'History of the Mandolin');
  await openPanel(h.win, 'Links', 'Related');
  await h.win.waitForTimeout(3000);
  await shoot(h.win, 'right-sidebar-related', h.win.locator(RIGHT_SIDEBAR));
});

test('right-sidebar-citations', async () => {
  // Fixture note at the vault root; cites two real .minerva/sources entries.
  await openNote(h.win, 'rsb-citations');
  await openPanel(h.win, 'Links', 'Citations');
  await h.win.waitForTimeout(600);
  await shoot(h.win, 'right-sidebar-citations', h.win.locator(RIGHT_SIDEBAR));
});

test('right-sidebar-bookmarks', async () => {
  // The demo vault ships one bookmark on this note (.minerva/bookmarks.json).
  await openNote(h.win, 'Mandolin Family Tree');
  await openPanel(h.win, 'Links', 'Bookmarks');
  await h.win.waitForTimeout(500);
  await shoot(h.win, 'right-sidebar-bookmarks', h.win.locator(RIGHT_SIDEBAR));
});

test('right-sidebar-proposals', async () => {
  // Proposals are project-wide (not note-scoped); the fixture's embedded turtle
  // seeds the queue. Open the fixture note just for a coherent editor context.
  await openNote(h.win, 'rsb-proposals');
  await openPanel(h.win, 'Activity', 'Proposals');
  await h.win.waitForTimeout(800);
  await shoot(h.win, 'right-sidebar-proposals', h.win.locator(RIGHT_SIDEBAR));
});
