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
 *   refactoring-ai-assisted  — FLAGGED: the ReorgDraftCard is a live-model
 *                              artifact (a ConversationReorgDraft produced when
 *                              the assistant proposes a reorganization). No
 *                              pre-baked conversation in the demo vault contains
 *                              one, and the harness only injects `.md` fixtures,
 *                              not conversation JSON, so it can't be staged.
 *                              The recipe below opens the conversation surface as
 *                              a best-effort placeholder and needs human review.
 *
 * Fixtures (fixtures/refactoring/*.md, copied to the vault root and indexed on
 * open): refactoring-loar-f5 (delete target) + three notes that wiki-link to it
 * (refactoring-bluegrass-tone, refactoring-gibson-catalog,
 * refactoring-collector-notes).
 */
import { test } from '@playwright/test';
import { launchDemo, shoot, type Harness } from './lib/harness';

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
  const dialog = h.win.locator('.dialog[aria-label^="Safe Delete"]');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'refactoring-safe-delete', dialog);
  // Cancel — nothing is deleted.
  await h.win.keyboard.press('Escape');
  await h.win.waitForTimeout(300);
  await reset(h.win);
});

// ── AI-assisted reorg review card ── (FLAGGED — see file header)
// Best-effort: open the conversations surface. The actual ReorgDraftCard cannot
// be captured here without a live model producing a ConversationReorgDraft.
test('refactoring-ai-assisted', async () => {
  await reset(h.win);
  // Open the command palette (⌘K) and toggle the conversations panel visible.
  await h.win.keyboard.press('Meta+k');
  await h.win.waitForTimeout(400);
  await h.win.getByPlaceholder('Type a command…').fill('Toggle Conversations');
  await h.win.waitForTimeout(300);
  await h.win.keyboard.press('Enter');
  await h.win.waitForTimeout(800);
  // NOTE: this captures the conversation panel, NOT the reorg review card — the
  // card only appears mid-conversation after the assistant proposes a
  // reorganization. Needs a staged live conversation for a correct shot.
  const panel = h.win.locator('.conv-panel');
  if (await panel.count()) {
    await shoot(h.win, 'refactoring-ai-assisted', panel);
  } else {
    await shoot(h.win, 'refactoring-ai-assisted');
  }
  await reset(h.win);
});
