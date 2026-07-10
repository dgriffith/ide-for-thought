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
async function launchApp(seedProjectDir?: string) {
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
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
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
    }
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
