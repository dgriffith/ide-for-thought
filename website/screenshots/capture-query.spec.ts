/**
 * Docs screenshot harness — Query section.
 *
 * Three shots:
 *   • query-runnable-cells / query-result-blocks — rendered note content, shot
 *     in Preview from the fixtures dropped into the vault root (a runnable SPARQL
 *     cell with its output table, and a live timeseries chart result block).
 *   • query-menu-panel — the Query panel itself, opened via the command palette
 *     ("New Query"), a real SPARQL query typed in and run, then the whole
 *     `.query-panel` (toolbar + editor + sortable results) cropped.
 *
 * Copies the Notes template's launch/serial/teardown scaffolding verbatim.
 */
import { test } from '@playwright/test';
import { launchDemo, openNote, setView, shoot, shootPreview, type Harness } from './lib/harness';

interface Shot { id: string; note: string; settle?: number }

// The two note-content shots: open the fixture, render it, crop the Preview.
const NOTE_SHOTS: Shot[] = [
  { id: 'query-runnable-cells', note: 'query-runnable-cells' },
  { id: 'query-result-blocks',  note: 'query-result-blocks', settle: 2000 },
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

for (const shot of NOTE_SHOTS) {
  test(shot.id, async () => {
    await openNote(h.win, shot.note);
    await setView(h.win, 'Preview');
    if (shot.settle) await h.win.waitForTimeout(shot.settle);
    await shootPreview(h.win, shot.id);
  });
}

// The Query panel is a first-class tab, not note content. Native-menu
// accelerators (Cmd+Shift+Q) can't be driven by Playwright, so we reach the
// same "New Query" command through the command palette (Cmd+K → filter → run),
// then type a real query and run it so the results table is populated.
test('query-menu-panel', async () => {
  const win = h.win;

  // Open the command palette and run "New Query".
  await win.keyboard.press('Meta+k');
  await win.waitForTimeout(400);
  const palette = win.getByPlaceholder('Type a command…');
  await palette.click();
  await palette.fill('New Query');
  await win.waitForTimeout(300);
  await win.keyboard.press('Enter');

  // The Query panel mounts as the active tab.
  await win.locator('.query-panel').first().waitFor({ state: 'visible', timeout: 5000 });
  await win.waitForTimeout(400);

  // Type a SPARQL query into the CodeMirror surface. insertText lands the whole
  // block in one atomic insertion, so per-keystroke autocomplete never fires
  // (the Enter-accepts-completion keymap can't swallow a newline this way).
  const cm = win.locator('.query-panel .cm-content').first();
  await cm.click();
  await win.keyboard.insertText(
    'SELECT ?title ?path WHERE {\n' +
    '  ?note dc:title ?title ;\n' +
    '        minerva:relativePath ?path .\n' +
    '}\n' +
    'ORDER BY ?title\n' +
    'LIMIT 12',
  );
  await win.waitForTimeout(300);

  // Run it and wait for the results table to fill in.
  await win.locator('.query-panel .run-btn').click();
  await win.locator('.query-panel .table-wrap').first().waitFor({ state: 'visible', timeout: 8000 });
  await win.waitForTimeout(600);

  await shoot(win, 'query-menu-panel', win.locator('.query-panel'));
});
