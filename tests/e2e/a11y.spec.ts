/**
 * Real-browser accessibility pass (#1005).
 *
 * The unit suite runs axe against modal dialogs in jsdom with `color-contrast`
 * disabled (jsdom computes no layout/colour). This spec extends the net to the
 * main workspace surfaces — welcome screen, sidebar/file-tree, editor tabs +
 * status bar — in the actual Electron renderer, where Chromium computes layout
 * and colour, so the `color-contrast` check runs for real.
 *
 * Baseline, not zero. The app has some pre-existing violations (faint
 * secondary text below AA contrast; a couple of structural ARIA-role issues on
 * the editor tabs). Rather than block this net on a full product-a11y sweep
 * (its own reviewed change), each surface carries an allowlist of the
 * currently-known violation *rule ids*; the test fails only on a NEW rule —
 * a real regression guard — and logs the tolerated ones so they stay visible.
 * The known set is tracked for a follow-up fix (see the PR).
 *
 * Launches the in-tree `.vite/build` app (like smoke.spec.ts), so it needs
 * `pnpm build:e2e` first (the `pnpm test:e2e` script does that). Gates on
 * serious + critical impact; minor/moderate are reported, non-fatal.
 */
import { test, expect, _electron as electron, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { runAxe, formatViolations, seriousOrWorse, type AxeViolation } from '../helpers/axe-playwright';

const projectRoot = path.resolve(__dirname, '..', '..');

// Pre-existing serious/critical violations tolerated so the net can land
// without a product-a11y sweep. NEW rule ids fail the test. Tracked for a
// follow-up fix — see #1005 / the PR.
const KNOWN_WELCOME = new Set<string>([
  // Clean: --text-faint was lifted to WCAG AA, so no tolerated violations here.
]);
const KNOWN_WORKSPACE = new Set<string>([
  // color-contrast is now ENFORCED (#1080): the oneDark editor theme was
  // replaced with the token-driven minervaHighlightStyle (#1117), and the code
  // surface + gutters moved to --bg-inset, where every syntax color and the
  // --text-faint gutter/decoration text clear WCAG AA (4.5:1). This spec forces
  // the dark theme (via bootDarkTheme — the first-run default is now 'system',
  // #1140), so a regression here fails CI.
  // CodeMirror's `.cm-scroller` (tabindex=-1); its `.cm-content` editable IS
  // keyboard-focusable, so this axe finding is a known CM quirk, not a real trap.
  'scrollable-region-focusable',
  // Fixed in this pass (kept out of the allowlist so a regression fails):
  //   aria-input-field-name — CM content now has an aria-label
  //   nested-interactive / aria-required-parent — editor tabs are plain
  //     buttons (switch + sibling close), no half-applied role=tab widget.
]);

// Extending the real-browser axe net to two more primary surfaces (#1104
// stretch): the source viewer (a major read surface) and the proposals panel
// (the trust-review surface). Same baseline-not-zero discipline — each carries
// an allowlist of the currently-known serious/critical rule ids so the net
// lands without a full product-a11y sweep; a NEW rule id fails CI.
const KNOWN_SOURCE = new Set<string>([
  // Clean: the source viewer (SourceDetail) has no tolerated serious violations
  // — the unlabeled reading-due date input surfaced by this pass was fixed
  // (aria-label added), not allowlisted. Strict gate.
]);
const KNOWN_PROPOSALS = new Set<string>([
  // The proposal diff renders in a CodeMirror view too.
  'scrollable-region-focusable',
]);

/** Serious/critical violations whose rule id isn't in the tolerated set. */
function unexpected(violations: AxeViolation[], allow: Set<string>): AxeViolation[] {
  return seriousOrWorse(violations).filter((v) => !allow.has(v.id));
}

/** Log the tolerated pre-existing violations so they stay visible in CI. */
function reportKnown(surface: string, violations: AxeViolation[], allow: Set<string>): void {
  const known = seriousOrWorse(violations).filter((v) => allow.has(v.id));
  if (known.length > 0) {
    console.log(`[a11y] ${surface}: ${known.length} known/tolerated violation(s):\n${formatViolations(known)}`);
  }
}

/** Launch the dev build with an isolated userData dir (optionally seeded to
 *  auto-open the sample project on boot via session restore). */
async function launchApp(seedProjectDir?: string, extraEnv?: Record<string, string>) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-a11y-userdata-'));
  if (seedProjectDir) {
    fs.writeFileSync(
      path.join(userDataDir, 'session.json'),
      JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: seedProjectDir }]),
    );
  }
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    timeout: 60_000,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ...extraEnv },
  });
  return { app, userDataDir };
}

/**
 * Pin the dark theme deterministically, then reload so the app boots straight
 * into it. The first-run default is 'system' (#1140), which would otherwise
 * resolve to the CI host's color scheme. Seeding localStorage + reloading
 * (rather than switching the theme live) is deliberate: a live switch animates
 * `.welcome button`'s `transition: background`, and axe can capture a
 * mid-transition frame — a light-theme background under already-snapped
 * dark-theme text — as a phantom contrast violation. Booting clean avoids it.
 */
async function bootDarkTheme(win: Page): Promise<void> {
  await win.evaluate(() => localStorage.setItem('themeMode', 'dark'));
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
}

test('welcome screen: no NEW serious a11y violations (real-browser, incl. color-contrast)', async () => {
  const { app, userDataDir } = await launchApp();
  try {
    const win: Page = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await bootDarkTheme(win);
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toBeVisible({ timeout: 15_000 });

    const violations = await runAxe(win);
    reportKnown('welcome', violations, KNOWN_WELCOME);
    const regressions = unexpected(violations, KNOWN_WELCOME);
    expect(regressions, `NEW welcome-screen a11y violations:\n${formatViolations(regressions)}`).toHaveLength(0);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('workspace (sidebar + editor): no NEW serious a11y violations (real-browser, incl. color-contrast)', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-a11y-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const { app, userDataDir } = await launchApp(projectDir);
  try {
    const win: Page = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await bootDarkTheme(win);
    // Session restore replaces the welcome screen with the workspace.
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await win.waitForTimeout(500); // let the sidebar tree + panels settle

    // Sidebar + shell.
    const shell = await runAxe(win);
    reportKnown('workspace shell', shell, KNOWN_WORKSPACE);
    const shellRegressions = unexpected(shell, KNOWN_WORKSPACE);
    expect(shellRegressions, `NEW workspace-shell a11y violations:\n${formatViolations(shellRegressions)}`).toHaveLength(0);

    // Open a note so the editor surface is populated, then re-check.
    const firstFile = win.locator('[data-relative-path$=".md"]').first();
    if (await firstFile.count()) {
      await firstFile.click();
      await win.waitForTimeout(500);
      const withEditor = await runAxe(win);
      reportKnown('workspace+editor', withEditor, KNOWN_WORKSPACE);
      const editorRegressions = unexpected(withEditor, KNOWN_WORKSPACE);
      expect(editorRegressions, `NEW workspace+editor a11y violations:\n${formatViolations(editorRegressions)}`).toHaveLength(0);

      // Justify the one allowlisted editor finding (`scrollable-region-focusable`
      // on CM's `.cm-scroller`, which carries tabindex=-1) with a POSITIVE check
      // rather than a bare comment: the editable content is keyboard-reachable,
      // so there is no real keyboard trap — the axe rule is a false positive for
      // CodeMirror's split scroller/content structure (#1104).
      const editorKeyboardReachable = await win.evaluate(() => {
        const content = document.querySelector('.cm-content');
        if (!content) return { found: false, focusable: false, notInert: false };
        content.focus();
        return {
          found: true,
          focusable: document.activeElement === content,
          // The scroller opts itself out of the tab order (tabindex=-1); the
          // content must NOT, or the editor would be unreachable by keyboard.
          notInert: content.getAttribute('tabindex') !== '-1',
        };
      });
      expect(editorKeyboardReachable.found, '.cm-content should be present').toBe(true);
      expect(editorKeyboardReachable.focusable, '.cm-content must accept keyboard focus').toBe(true);
      expect(editorKeyboardReachable.notInert, '.cm-content must stay in the tab order').toBe(true);
    }
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('source viewer: no NEW serious a11y violations (real-browser, incl. color-contrast)', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-a11y-source-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const { app, userDataDir } = await launchApp(projectDir);
  try {
    const win: Page = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await bootDarkTheme(win);
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    // Switch the left sidebar to Sources and open the first source into the
    // SourceDetail viewer (`.source-item` click → editor.openSource → tab).
    await win.getByTitle('Sources', { exact: true }).click();
    await win.waitForTimeout(400);
    const firstSource = win.locator('.source-item').first();
    await firstSource.click();
    await expect(win.locator('.source-detail')).toBeVisible({ timeout: 10_000 });
    await win.waitForTimeout(500); // let the excerpt list + preview settle

    const violations = await runAxe(win);
    reportKnown('source viewer', violations, KNOWN_SOURCE);
    const regressions = unexpected(violations, KNOWN_SOURCE);
    expect(regressions, `NEW source-viewer a11y violations:\n${formatViolations(regressions)}`).toHaveLength(0);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('proposals panel: no NEW serious a11y violations (real-browser, incl. color-contrast)', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-a11y-proposals-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  // MINERVA_E2E exposes the seedProposal hook so the panel has a real pending
  // proposal to review (see src/main/e2e-hooks.ts), not just its empty state.
  const { app, userDataDir } = await launchApp(projectDir, { MINERVA_E2E: '1' });
  try {
    const win: Page = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await bootDarkTheme(win);
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    // Open a note and WAIT for the editor to mount: the right sidebar only
    // renders for an active note tab (App.svelte `rightSidebarVisible &&
    // activeTab?.type === 'note'`), and waiting on `.cm-content` also guarantees
    // the renderer is fully live so its toggle-IPC listener is registered.
    await win.locator('[data-relative-path$=".md"]').first().click();
    await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });

    // Seed a pending proposal into the open project through the main-process hook.
    await app.evaluate(async () => {
      const g = globalThis as typeof globalThis & { __minervaE2E?: { seedProposal(): Promise<string | null> } };
      if (!g.__minervaE2E) throw new Error('e2e hook missing — MINERVA_E2E not set?');
      await g.__minervaE2E.seedProposal();
    });

    // The Proposals panel now lives in the LEFT sidebar (#1526, after the
    // right-sidebar surface was retired in #1540) — open it via its panel tab.
    // The left sidebar is already visible (we clicked a note in it above), so
    // no toggle is needed.
    await win.locator('.panel-tab[title="Proposals"]').first().click();
    await win.waitForTimeout(400);
    // Expand the seeded proposal's review detail (payloads + Approve/Reject).
    const firstProposal = win.locator('.proposal-item').first();
    if (await firstProposal.count()) {
      await firstProposal.click();
      await win.waitForTimeout(400);
    }

    const violations = await runAxe(win);
    reportKnown('proposals panel', violations, KNOWN_PROPOSALS);
    const regressions = unexpected(violations, KNOWN_PROPOSALS);
    expect(regressions, `NEW proposals-panel a11y violations:\n${formatViolations(regressions)}`).toHaveLength(0);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
