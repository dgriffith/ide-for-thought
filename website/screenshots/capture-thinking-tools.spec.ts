/**
 * Docs screenshot harness — Thinking tools section.
 *
 * The Learning / Research / Analysis menus that this section documents are
 * *native OS menus* (Electron `Menu`), which Playwright cannot screenshot. So
 * every shot here uses the faithful **in-app DOM surrogate** for the same
 * thinking-tool surface:
 *
 *  - the conversation composer's `/` skill launcher (#648) — the DOM list of
 *    thinking-tool skills, each with its name + description, that you pick from
 *    to run a skill without touching the native menu; and
 *  - the Settings → Skills panel — the one place all three menus (Learning /
 *    Research / Analysis) and their skills are rendered in the DOM, with the
 *    on/off + reorder + reassign controls.
 *
 * Several shots are therefore FLAGGED for human review: the native-menu views
 * the doc pages describe (a menu popped open, thematic submenus, the Proposals
 * card a skill files) have no DOM equivalent to capture. See each test.
 *
 * Launches the packaged app once against a copy of the demo thoughtbase (which
 * ships the full set of stock skills, so the `/` launcher and Skills panel are
 * populated) and closes it in afterAll.
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

/**
 * Reveal the conversation composer by starting a fresh (freeform) conversation
 * via the editor toolbar's "New Conversation" button. Idempotent across the
 * serial run — if a composer is already on screen we reuse it rather than pile
 * up tabs. The demo vault's 25 pre-baked conversations are all archived (there's
 * no reopen UI), so a fresh one is the reliable way to get a live composer.
 */
async function ensureComposer(): Promise<void> {
  const composer = h.win.locator('.composer textarea');
  if ((await composer.count()) > 0 && (await composer.first().isVisible())) return;
  await h.win.locator('[title="New Conversation"]').first().click();
  await composer.first().waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(400);
}

/** Type a slash query into the composer and wait for its `/` menu to open.
 *  Clears any prior text first (the two slash shots share one composer). */
async function openSlashMenu(query: string): Promise<void> {
  const ta = h.win.locator('.composer textarea').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially(query, { delay: 25 });
  await h.win.locator('.slash-menu').first().waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(400);
}

/** Open the Settings dialog via the command palette if it isn't already open. */
async function ensureSettingsOpen(): Promise<void> {
  const dialog = h.win.locator('[role="dialog"][aria-label="Settings"]');
  if ((await dialog.count()) > 0 && (await dialog.first().isVisible())) return;
  // A composer textarea may hold focus from an earlier shot; drop the slash
  // menu / blur so ⌘K reaches the window-level command-palette handler.
  await h.win.keyboard.press('Escape');
  await h.win.keyboard.press('Meta+k');
  const palette = h.win.locator('[role="dialog"][aria-label="Command palette"]');
  await palette.waitFor({ state: 'visible', timeout: 5000 });
  await palette.getByPlaceholder('Type a command…').fill('Settings');
  await h.win.waitForTimeout(300);
  await h.win.keyboard.press('Enter');
  await dialog.first().waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(400);
}

/** Switch the open Settings dialog to the Skills tab and let the async catalog
 *  (api.skills.list on mount) settle. */
async function openSkillsTab(): Promise<void> {
  await ensureSettingsOpen();
  await h.win.locator('nav.tabs').getByText('Skills', { exact: true }).first().click();
  await h.win.waitForTimeout(1000);
}

// ── What thinking tools are ────────────────────────────────────────────────
// FLAG: the doc page depicts the native Analysis menu popped open. That's an OS
// menu Playwright can't shoot. Surrogate: the composer's `/` launcher, the DOM
// list of thinking-tool skills — each a mono command, a name, and a one-line
// description, exactly the "skill = name + instruction" idea the page teaches.
// "/find" pulls a cross-menu sample (Find Sources, Find Tensions, Find
// Prerequisites, …) so the shot reads as a menu of tools.
test('thinking-tools-what-they-are', async () => {
  await ensureComposer();
  await openSlashMenu('/find');
  await shoot(h.win, 'thinking-tools-what-they-are', h.win.locator('.slash-menu').first());
});

// ── Running a skill ────────────────────────────────────────────────────────
// FLAG: the doc page shows a native Research menu on the left and a Proposals
// card on the right. Neither is capturable here — the menu is native, and the
// demo vault has no pending proposals baked in (all 25 conversations are
// archived; proposals live in the graph and none exist), and filing one needs a
// live model. Surrogate: the composer's `/` launcher filtered to a single
// Research skill (Find Sources), the actual in-app way you launch a skill into
// a conversation (#648). Crops the whole composer card so the typed command and
// the highlighted skill both show. The proposal half is NOT captured.
test('thinking-tools-running-a-skill', async () => {
  await ensureComposer();
  await openSlashMenu('/find-sources');
  await shoot(h.win, 'thinking-tools-running-a-skill', h.win.locator('.composer-card').first());
});

// ── The three menus ────────────────────────────────────────────────────────
// FLAG: the doc page shows the native Analysis menu with thematic *submenus*
// (Disagreement, Verification, …). Grouping (#525) is a native-menu-only
// feature with no DOM rendering, so the submenus can't be captured. Surrogate:
// the Settings → Skills panel is the one DOM surface that renders all three
// menus (Learning / Research / Analysis) with their skills; the panel is
// scrolled so the menu-section labels are in frame, conveying the three-way
// split even though the thematic submenus can't be shown.
test('thinking-tools-three-menus', async () => {
  await openSkillsTab();
  // Scroll the panel so the Learning / Research / Analysis section labels sit in
  // the crop rather than the intro + action buttons at the very top.
  await h.win
    .locator('[role="dialog"][aria-label="Settings"] .panel')
    .first()
    .evaluate((el) => el.scrollTo(0, 320));
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'thinking-tools-three-menus', h.win.locator('[role="dialog"][aria-label="Settings"]').first());
});

// ── Managing & authoring ───────────────────────────────────────────────────
// Solid DOM shot: the Settings → Skills dialog. Scrolled back to the top so the
// per-row controls the page describes — the on/off checkbox, the up/down
// reorder arrows, and the move-to-menu dropdown — are all visible, alongside
// the tab rail (Skills active) and the Import / Reveal / Reload actions.
test('thinking-tools-managing-authoring', async () => {
  await openSkillsTab();
  await h.win
    .locator('[role="dialog"][aria-label="Settings"] .panel')
    .first()
    .evaluate((el) => el.scrollTo(0, 0));
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'thinking-tools-managing-authoring', h.win.locator('[role="dialog"][aria-label="Settings"]').first());
});
