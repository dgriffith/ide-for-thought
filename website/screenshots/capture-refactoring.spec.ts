/**
 * Docs screenshot harness — Refactoring section.
 *
 * Three UI-chrome shots (not rendered note content), so each recipe navigates to
 * a state and crops a DOM element rather than using shootPreview:
 *
 *   refactoring-manual       — the file-tree right-click context menu (Rename,
 *                              Delete, Cut/Copy/Paste, …). DOM `.context-menu`.
 *   refactoring-safe-delete  — the Safe Delete blocker dialog, triggered by
 *                              deleting a fixture note that other fixture notes
 *                              link to (guaranteed external inbound links). We
 *                              screenshot the dialog, then Escape to cancel — no
 *                              note is actually deleted.
 *   refactoring-ai-assisted  — the ReorgDraftCard (#1400): a seeded
 *                              conversation, then the real main → renderer
 *                              `conversation:reorgDraft` event replayed with a
 *                              draft the app's own planner produced (below).
 *
 * Fixtures (fixtures/refactoring/*.md, copied to the vault root and indexed on
 * open): refactoring-loar-f5 (delete target) + three notes that wiki-link to it
 * (refactoring-bluegrass-tone, refactoring-gibson-catalog,
 * refactoring-collector-notes).
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchDemo, shoot, type Harness } from './lib/harness';

const FIXTURES = path.join(__dirname, 'fixtures', 'refactoring');

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Dismiss any open menu/dialog and return the tree to a clean state. */
async function reset(win: Harness['win']): Promise<void> {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
}

// ── Manual rename/move/delete: the file-tree right-click context menu ──
test('refactoring-manual', async () => {
  await reset(h.win);
  // Right-click a clean-named root note to open its per-note menu. The menu is
  // a DOM `.context-menu` (not a native OS menu), so it's screenshottable.
  const row = h.win.locator('aside.sidebar').getByText('Mandolin Family Tree', { exact: true }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click({ button: 'right' });
  await h.win.waitForTimeout(600); // async entrypoint-state patch settles
  await shoot(h.win, 'refactoring-manual', h.win.locator('.context-menu'));
  await reset(h.win);
});

// ── Safe delete: the external-references blocker dialog ──
test('refactoring-safe-delete', async () => {
  await reset(h.win);
  // Open the context menu on the fixture note that three other fixtures link to.
  const target = h.win.locator('aside.sidebar').getByText('refactoring-loar-f5', { exact: true }).first();
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: 'right' });
  await h.win.waitForTimeout(400);
  // Click Delete → the pre-flight check finds the external inbound links and
  // shows SafeDeleteBlockerDialog instead of deleting.
  await h.win.locator('.context-menu button', { hasText: 'Delete' }).click();
  const dialog = h.win.locator('[role="dialog"][aria-labelledby="safe-delete-blocker-title"]');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'refactoring-safe-delete', dialog);
  // Cancel — nothing is deleted.
  await h.win.keyboard.press('Escape');
  await h.win.waitForTimeout(300);
  await reset(h.win);
});

// ── AI-assisted reorg review card ──
// The ReorgDraftCard is pure runtime state: `propose_reorganization` dry-runs
// the plan and pushes it over Channels.CONVERSATION_REORG_DRAFT during a live
// turn; it is never persisted. So the recipe seeds the conversation that asked
// for it, then replays that exact event from the main process — the same
// technique capture-conversations.spec.ts uses for propose_notes drafts.
//
// fixtures/refactoring/reorg-draft.json is REAL planner output, not a mock:
// `planReorg` (src/main/notebase/reorg.ts, what the tool calls) run over an
// indexed copy of the demo vault for seven moves into eras/ / regions/ / craft/.
// Each affected note's before/after is trimmed to its changed lines — the card
// renders `changedLines(before, after)`, which pairs lines by index, so the
// trim renders identically at a twelfth of the size. Regenerate it the same way
// if the demo vault's links change.
test('refactoring-ai-assisted', async () => {
  await reset(h.win);
  const conv = fs.readFileSync(path.join(FIXTURES, 'conv-docs-reorg.json'), 'utf-8');
  const draft = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'reorg-draft.json'), 'utf-8'));

  await h.win.evaluate(async (files: Array<{ rel: string; content: string }>) => {
    for (const f of files) await window.api.notebase.writeFile(f.rel, f.content);
    // The conversations store opens the panel on load only with this flag.
    localStorage.setItem('conversationsSettings', JSON.stringify({ openOnLoad: true }));
  }, [
    { rel: '.minerva/conversations/conv-docs-reorg.json', content: conv },
    { rel: '.minerva/conversations/_ui.json', content: JSON.stringify({ visible: true, height: 700, activeTabId: 'conv-docs-reorg' }) },
  ]);
  await h.win.reload();
  await h.win.waitForLoadState('domcontentloaded');
  await expect(h.win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 30_000 });
  await expect(h.win.locator('.conv-panel')).toBeVisible({ timeout: 10_000 });
  await h.win.waitForTimeout(900);

  // Replay the real main → renderer reorg-draft event.
  await h.app.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('conversation:reorgDraft', payload);
  }, draft);
  const card = h.win.locator('.conv-panel .draft-card').filter({ has: h.win.locator('.items') });
  await expect(card).toBeVisible({ timeout: 5_000 });

  // Open one item to show how the links pointing at it get rewritten — Brazil,
  // whose four referrers make a compact diff.
  await card.locator('.item', { hasText: 'The Mandolin in Brazil' }).locator('.links-badge').click();
  await h.win.waitForTimeout(400);
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await h.win.waitForTimeout(300);
  await shoot(h.win, 'refactoring-ai-assisted', h.win.locator('.conv-panel'));
  await reset(h.win);
});
