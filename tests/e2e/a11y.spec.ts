/**
 * Real-browser accessibility pass (#1005, #2375, #2376, #2378).
 *
 * The unit suite runs axe against modal dialogs in jsdom with `color-contrast`
 * disabled (jsdom computes no layout/colour). This spec runs axe in the actual
 * Electron renderer, where Chromium computes layout and colour, so the
 * `color-contrast` check runs for real.
 *
 * Zero tolerance. Every scan fails on ANY serious or critical violation — there
 * is no per-surface allowlist of known rule ids any more (#2376 emptied the last
 * two, both `scrollable-region-focusable`). A finding is fixed in the product,
 * not tolerated here. Minor/moderate findings are reported, non-fatal.
 *
 * Coverage is surfaces × themes:
 *
 *  - **Surfaces** (#2375 added the last five): welcome screen, workspace shell
 *    + editor, source viewer, PDF viewer, proposals panel, conversation panel,
 *    Settings dialog (every section), Query panel (with results), neighborhood
 *    graph, and the `:::argument` map.
 *  - **Themes** (#2378): every shipped theme — dark, light, contrast. The theme
 *    tokens are the thing most likely to regress contrast, and each theme pairs
 *    them differently (the contrast theme's `--bg-titlebar` is dark over a
 *    light body, so `--bg-titlebar` + `--text` is a broken pairing there and
 *    nowhere else). A scan in one theme says nothing about the others.
 *  - **One narrow window** (#2378): 1024×700, with both sidebars and the
 *    conversation panel open — the size at which sidebar overflow shows up.
 *
 * Launches the in-tree `.vite/build` app (like smoke.spec.ts), so it needs
 * `pnpm build:e2e` first (the `pnpm test:e2e` script does that).
 */
import { test, expect, type ElectronApplication, type Page } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot, seedProposal } from './helpers/launch';
import { runAxe, formatViolations, seriousOrWorse } from '../helpers/axe-playwright';

/** Every theme a user can pick (THEME_MODES minus `system`, which resolves to
 *  dark or light). */
const THEMES = ['dark', 'light', 'contrast'] as const;
type Theme = (typeof THEMES)[number];

/** The PDF-backed source in tests/fixtures/sample-project. */
const PDF_SOURCE_TITLE = 'A Census of Na D-traced neutral ISM';

/** Pinned so the argument map's `supports:` URI can be computed by hand — see
 *  argument-map.spec.ts for why. */
const ARG_BASE_URI = 'https://sample.minerva.dev/a11y-e2e/';

interface LaunchOpts {
  theme: Theme;
  /** Copy tests/fixtures/sample-project in and restore it on boot. */
  withProject?: boolean;
  /** Extra files written into the project copy before launch. */
  extraFiles?: Record<string, string>;
  /** Window size seeded through session.json. */
  size?: { width: number; height: number };
  /** Runs against the workspace BEFORE the theme reload — anything the
   *  renderer only reads at init (e.g. the open conversation tabs). */
  beforeThemeBoot?: (win: Page) => Promise<void>;
}

interface Session {
  app: ElectronApplication;
  win: Page;
}

/**
 * Launch against an isolated profile (optionally restoring a copy of the
 * sample project), pin the theme, and hand the window to `body`. Always tears
 * the app and its temp dirs down.
 *
 * Each phase is a `test.step` (#2458): a hung attempt's JSON report names the
 * phase that ate the time, where it used to say only "Test timeout of 60000ms
 * exceeded".
 */
async function withApp(opts: LaunchOpts, body: (s: Session) => Promise<void>): Promise<void> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-a11y-userdata-'));
  let projectDir: string | undefined;
  if (opts.withProject) {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-a11y-project-'));
    fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
    for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) {
      fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(projectDir, rel), content);
    }
    const { width, height } = opts.size ?? { width: 1200, height: 800 };
    fs.writeFileSync(
      path.join(userDataDir, 'session.json'),
      JSON.stringify([{ x: 80, y: 80, width, height, rootPath: projectDir }]),
    );
  }
  // MINERVA_E2E exposes the main-process seed hooks (src/main/e2e-hooks.ts).
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await test.step('first window', async () => {
      const w = await app.firstWindow({ timeout: 20_000 });
      await w.waitForLoadState('domcontentloaded');
      return w;
    });
    if (opts.withProject) {
      await waitForWorkspace(win);
      if (opts.beforeThemeBoot) await test.step('before theme boot', () => opts.beforeThemeBoot!(win));
    }
    await bootTheme(win, opts.theme);
    if (opts.withProject) await waitForWorkspace(win);
    await body({ app, win });
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

/**
 * Pin a theme deterministically, then reload so the app boots straight into
 * it. Seeding localStorage + reloading (rather than switching live) is
 * deliberate: a live switch animates `transition: background` on buttons, and
 * axe can capture a mid-transition frame — a background from the old theme
 * under text from the new one — as a phantom contrast violation.
 */
async function bootTheme(win: Page, theme: Theme): Promise<void> {
  // `reload` and `waitForLoadState` are bounded by the config's
  // `navigationTimeout` (#2458) — Playwright Test's default is none.
  await test.step(`boot ${theme} theme (reload)`, async () => {
    await win.evaluate((t) => localStorage.setItem('themeMode', t), theme);
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    const attr = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr, `theme did not apply`).toBe(theme === 'dark' ? null : theme);
  });
}

async function waitForWorkspace(win: Page): Promise<void> {
  await test.step('wait for workspace', async () => {
    // Session restore replaces the welcome screen with the workspace.
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    // Wait for the sidebar tree to actually render rather than sleeping.
    await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 10_000 });
  });
}

/** Open the first note and wait for its editor to mount. */
async function openFirstNote(win: Page): Promise<void> {
  await test.step('open first note', async () => {
    await win.locator('[data-relative-path$=".md"]').first().click();
    await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
  });
}

/** Send a native-menu command to the renderer, the way menu.ts does. */
async function sendMenu(app: ElectronApplication, channel: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, ch) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send(ch);
  }, channel);
}

/**
 * Zero-tolerance gate: fail on any serious/critical violation. Soft, so a test
 * that scans several states (every Settings section, empty + populated panels)
 * reports all of them in one run rather than stopping at the first.
 */
async function expectNoSerious(win: Page, surface: string, theme: Theme, context?: string): Promise<void> {
  const violations = seriousOrWorse(await runAxe(win, context));
  expect.soft(
    violations.map((v) => v.id),
    `${surface} [${theme}] a11y violations:\n${formatViolations(violations)}`,
  ).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`a11y [${theme} theme]`, () => {
    test('welcome screen', async () => {
      await withApp({ theme }, async ({ win }) => {
        await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toBeVisible({ timeout: 15_000 });
        await expectNoSerious(win, 'welcome', theme);
      });
    });

    test('workspace shell + editor', async () => {
      await withApp({ theme, withProject: true }, async ({ win }) => {
        await expectNoSerious(win, 'workspace shell', theme);

        await openFirstNote(win);
        await expectNoSerious(win, 'workspace+editor', theme);

        // The editable content must stay keyboard-reachable — the positive
        // half of the CodeMirror scroller fix (#1104, #2376).
        const reach = await win.evaluate(() => {
          const content = document.querySelector<HTMLElement>('.cm-content');
          if (!content) return { found: false, focusable: false };
          content.focus();
          return { found: true, focusable: document.activeElement === content };
        });
        expect(reach.found, '.cm-content should be present').toBe(true);
        expect(reach.focusable, '.cm-content must accept keyboard focus').toBe(true);
      });
    });

    test('source viewer', async () => {
      await withApp({ theme, withProject: true }, async ({ win }) => {
        await win.getByTitle('Sources', { exact: true }).click();
        const firstSource = win.locator('.source-item').first();
        await expect(firstSource).toBeVisible({ timeout: 10_000 });
        await firstSource.click();
        await expect(win.locator('.source-detail')).toBeVisible({ timeout: 10_000 });
        await expect(win.locator('.body-view')).toBeVisible({ timeout: 10_000 });
        await expectNoSerious(win, 'source viewer', theme);
      });
    });

    test('PDF viewer', async () => {
      await withApp({ theme, withProject: true }, async ({ win }) => {
        await win.getByTitle('Sources', { exact: true }).click();
        const pdfSource = win.locator('.source-item', { hasText: PDF_SOURCE_TITLE }).first();
        await expect(pdfSource).toBeVisible({ timeout: 10_000 });
        await pdfSource.click();
        await expect(win.locator('.source-detail')).toBeVisible({ timeout: 10_000 });
        await win.getByRole('button', { name: 'Open original PDF' }).click();
        await expect(win.locator('.pdf-viewer')).toBeVisible({ timeout: 15_000 });
        // Wait for pdf.js to finish loading and paint the first page.
        await expect(win.locator('.pdf-viewer .status')).toHaveCount(0, { timeout: 20_000 });
        await expect(win.locator('.pdf-viewer canvas').first()).toBeVisible({ timeout: 20_000 });
        await expectNoSerious(win, 'PDF viewer', theme);
      });
    });

    test('proposals panel', async () => {
      await withApp({ theme, withProject: true }, async ({ app, win }) => {
        await openFirstNote(win);
        // Seed a pending proposal through the real approval engine so the
        // panel has something to review, not just its empty state. Bounded,
        // with main probed on a miss — the prime suspect in #2458.
        await seedProposal(app);
        await test.step('open proposals panel', async () => {
          // The Proposals panel lives in the LEFT sidebar (#1526).
          await win.locator('.panel-tab[title="Proposals"]').first().click();
          const firstProposal = win.locator('.proposal-item').first();
          await expect(firstProposal).toBeVisible({ timeout: 10_000 });
          await firstProposal.click();
          await expect(win.locator('.proposal-detail')).toBeVisible({ timeout: 10_000 });
          // Expand a payload so its preview renders too.
          const payload = win.locator('.payload-row').first();
          if (await payload.count()) await payload.click();
        });
        await expectNoSerious(win, 'proposals panel', theme);
      });
    });

    test('conversation panel', async () => {
      await withApp({
        theme,
        withProject: true,
        // A conversation with a real transcript, created before the theme
        // reload so the panel restores it as an open tab on init. `create` and
        // `append` only persist the log — no LLM call.
        beforeThemeBoot: async (win) => {
          await win.evaluate(async () => {
            const conv = await window.api.conversations.create({ notePath: 'README.md' });
            await window.api.conversations.append(conv.id, 'user', 'Summarise the **key claims** in this note.');
            await window.api.conversations.append(
              conv.id,
              'assistant',
              '## Key claims\n\n1. Complexity is *essential*, not accidental.\n2. See [[overview]] for context.\n\n' +
              '> A quoted passage.\n\n```ts\nconst answer = 42;\n```\n\nInline `code` and a [link](https://example.com).',
            );
          });
        },
      }, async ({ win }) => {
        await openFirstNote(win);
        await win.getByRole('button', { name: 'New Conversation', exact: true }).click();
        await expect(win.locator('.conv-panel')).toBeVisible({ timeout: 10_000 });
        // Empty composer state of the freshly-opened conversation…
        await expectNoSerious(win, 'conversation panel (new)', theme);
        // …and the seeded transcript, with rendered markdown.
        await win.locator('.conv-item-btn').first().click();
        await expect(win.locator('.conv-panel').getByText('Complexity is')).toBeVisible({ timeout: 10_000 });
        await expectNoSerious(win, 'conversation panel (transcript)', theme);
      });
    });

    test('Settings dialog (every section)', async () => {
      await withApp({ theme, withProject: true }, async ({ app, win }) => {
        await sendMenu(app, 'menu:openSettings');
        const dialog = win.getByRole('dialog', { name: 'Settings' });
        await expect(dialog).toBeVisible({ timeout: 10_000 });
        const tabs = dialog.locator('nav.tabs button.tab');
        const count = await tabs.count();
        expect(count, 'Settings should have sections').toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
          const tab = tabs.nth(i);
          const label = (await tab.locator('.tab-label').textContent())?.trim() ?? `#${i}`;
          await tab.click();
          await expect(dialog.locator('.panel-title')).toHaveText(label, { timeout: 5_000 });
          // Let async-loaded section content settle before scanning.
          await win.waitForLoadState('domcontentloaded');
          await expectNoSerious(win, `Settings › ${label}`, theme);
        }
      });
    });

    test('Query panel (with results)', async () => {
      await withApp({ theme, withProject: true }, async ({ app, win }) => {
        await sendMenu(app, 'menu:newQuery');
        await expect(win.locator('.query-panel')).toBeVisible({ timeout: 10_000 });
        await expect(win.locator('.query-panel .cm-content')).toBeVisible({ timeout: 10_000 });
        await expectNoSerious(win, 'Query panel (empty)', theme);
        // Run is disabled on an empty query — type one first.
        await win.locator('.query-panel .cm-content').click();
        await win.keyboard.type('SELECT ?title WHERE { ?note dc:title ?title } LIMIT 5');
        await win.keyboard.press('Escape'); // dismiss any completion popup
        await win.locator('.query-panel .run-btn').click();
        await expect(win.locator('.query-panel .results-count')).toBeVisible({ timeout: 15_000 });
        await expectNoSerious(win, 'Query panel (results)', theme);
      });
    });

    test('neighborhood graph', async () => {
      await withApp({ theme, withProject: true }, async ({ win }) => {
        await openFirstNote(win);
        await win.getByTitle('Toggle Right Sidebar (Cmd+Shift+B)').first().click();
        await win.locator('.right-sidebar .group-tab[title="Links"]').click();
        await win.locator('.right-sidebar .sub-tab[title="Outgoing"]').click();
        await win.locator('.right-sidebar').getByTitle('Open as graph').click();
        await expect(win.locator('.neighborhood-graph')).toBeVisible({ timeout: 10_000 });
        await expect(win.locator('.neighborhood-graph svg, .neighborhood-graph canvas').first()).toBeVisible({ timeout: 10_000 });
        await expectNoSerious(win, 'neighborhood graph', theme);
      });
    });

    test('argument map', async () => {
      const claimUri = `${ARG_BASE_URI}note/notes/${encodeURIComponent('The Claim')}`;
      await withApp({
        theme,
        withProject: true,
        extraFiles: {
          '.minerva/config.json': JSON.stringify({ baseUri: ARG_BASE_URI }),
          'notes/The Claim.md': '---\ntitle: The Claim\n---\n\n# The Claim\n\nSome assertion.\n\n```turtle\nthis: a thought:Claim .\n```\n',
          'notes/Cited Evidence.md': `---\ntitle: Cited Evidence\nsupports: ${claimUri}\n---\n\n# Cited Evidence\n\nThe supporting case.\n`,
          // Root level: folder rows start collapsed on a fresh profile.
          'Argument Host.md': '---\ntitle: Argument Host\n---\n\n# Argument Host\n\n:::argument\n[[The Claim]]\n:::\n',
        },
      }, async ({ win }) => {
        await win.locator('[data-relative-path="Argument Host.md"]').first().click();
        await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
        await win.getByRole('button', { name: 'Preview', exact: true }).click();
        const outline = win.locator('.argument-map');
        await expect(outline).toBeVisible({ timeout: 10_000 });
        await expect(outline.getByRole('button', { name: 'Cited Evidence' })).toBeVisible({ timeout: 10_000 });
        await expectNoSerious(win, 'argument map', theme);
      });
    });
  });
}

/**
 * One run at a narrow window (#2378). 1024×700 is where a crowded chrome — left
 * sidebar, editor, right sidebar, conversation panel — starts to overflow, so
 * it gets both an axe scan and a direct check that nothing pushes the page into
 * horizontal scroll.
 */
for (const theme of ['dark', 'contrast'] as const) {
  test(`a11y at 1024×700 [${theme} theme]: workspace with both sidebars + conversation panel`, async () => {
    await withApp({ theme, withProject: true, size: { width: 1024, height: 700 } }, async ({ win }) => {
      const inner = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      expect(inner.w, 'window should be at the narrow width').toBeLessThanOrEqual(1024);

      await openFirstNote(win);
      await win.getByTitle('Toggle Right Sidebar (Cmd+Shift+B)').first().click();
      await expect(win.locator('.right-sidebar')).toBeVisible({ timeout: 10_000 });
      await win.getByRole('button', { name: 'New Conversation', exact: true }).click();
      await expect(win.locator('.conv-panel')).toBeVisible({ timeout: 10_000 });

      const overflow = await win.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollW, 'page must not scroll horizontally at 1024×700').toBeLessThanOrEqual(overflow.clientW);

      await expectNoSerious(win, 'workspace @1024×700', theme);
    });
  });
}
