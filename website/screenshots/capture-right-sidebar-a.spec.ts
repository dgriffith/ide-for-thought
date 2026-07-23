/**
 * Docs screenshot harness — Right sidebar (part A).
 *
 * Captures the "Note"-group panels of the right sidebar: Outline, Heading Map,
 * Properties, Footnotes, Tags, and Tables — plus the (v1.0-hidden) Inspections
 * panel. Every shot opens the same purpose-built showcase note ("Mandolin
 * Anatomy"), reveals the right sidebar, selects the panel's sub-tab, and crops
 * that panel's body element to website/docs/img/<id>.png.
 *
 * The showcase note is engineered so each panel has real content:
 *  - a three-level heading tree  → Outline + Heading Map
 *  - rich frontmatter            → Properties
 *  - two cited + one orphan note → Footnotes
 *  - flat + nested #tags         → Tags
 *  - a ```sql fence reading the demo's registered `mandolin_models` CSV → Tables
 *
 * All six real panels live in the default "Note" group, so no group-chip switch
 * is needed. Inspections is a HARD CASE (see its test) captured best-effort.
 */
import { test } from '@playwright/test';
import { launchDemo, openNote, shoot, type Harness } from './lib/harness';

/** The showcase note dropped into the vault root by the fixtures copy. Its
 *  file-tree label (and the Heading Map's synthetic root node) is the stem. */
const NOTE = 'Mandolin Anatomy';

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Reveal the right sidebar if it isn't already showing. It's hidden by
 *  default and stays open once toggled, so this is idempotent across the
 *  serial run — we never toggle it back off. */
async function ensureRightSidebar(): Promise<void> {
  const sidebar = h.win.locator('aside.right-sidebar');
  const visible = (await sidebar.count()) > 0 && (await sidebar.first().isVisible());
  if (!visible) {
    await h.win.locator('[title^="Toggle Right Sidebar"]').first().click();
    await h.win.waitForTimeout(500);
  }
}

/** Open the showcase note, reveal the sidebar, pick a Note-group sub-tab by its
 *  title, let it settle, then crop the panel body to <id>.png. */
async function shootPanel(id: string, subTabTitle: string, bodySelector: string, settle = 500): Promise<void> {
  await openNote(h.win, NOTE);
  await ensureRightSidebar();
  await h.win.locator(`.sub-tab[title="${subTabTitle}"]`).first().click();
  await h.win.waitForTimeout(settle);
  await shoot(h.win, id, h.win.locator(bodySelector).first());
}

test('right-sidebar-outline', async () => {
  await shootPanel('right-sidebar-outline', 'Outline', '.outline-panel');
});

test('right-sidebar-heading-graph', async () => {
  // The Heading Map renders a cytoscape graph; give the breadthfirst layout
  // time to lay out and paint, and nudge a resize so the canvas measures its
  // final column width before the crop.
  await openNote(h.win, NOTE);
  await ensureRightSidebar();
  await h.win.locator('.sub-tab[title="Heading Map"]').first().click();
  await h.win.waitForTimeout(600);
  await h.win.evaluate(() => window.dispatchEvent(new Event('resize')));
  await h.win.waitForTimeout(1600);
  await shoot(h.win, 'right-sidebar-heading-graph', h.win.locator('.heading-graph-panel').first());
});

test('right-sidebar-properties', async () => {
  await shootPanel('right-sidebar-properties', 'Properties', '.properties-panel');
});

test('right-sidebar-footnotes', async () => {
  await shootPanel('right-sidebar-footnotes', 'Footnotes', '.footnotes-panel');
});

test('right-sidebar-tags', async () => {
  await shootPanel('right-sidebar-tags', 'Tags', '.tags-panel');
});

test('right-sidebar-tables', async () => {
  // The Tables panel lists live DuckDB tables (api.tables.list). `mandolin_models`
  // is registered from the demo's CSV on project open, so the note's ```sql fence
  // resolves to a registered "Referenced" row — give the async list a beat.
  await shootPanel('right-sidebar-tables', 'Tables', '.tables-panel', 900);
});

// Inspections page dropped: the panel has no in-app path in v1.0 (sub-tab kept
// commented out, status-bar badge never triggered), so there is nothing real to
// capture. Removed rather than shipping a wrong image.
