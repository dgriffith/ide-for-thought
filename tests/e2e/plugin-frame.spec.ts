/**
 * A plugin's view runs in a frame that can reach nothing of the app's (#2824).
 *
 * The hostile fixture (`tests/fixtures/hostile-plugins/frame/`) is served at
 * `minerva-plugin://hostile/` by the real protocol handler and framed by the
 * real renderer, then tries, with real clicks (so with user activation):
 * the network, inline script, the IPC bridge, the microphone and clipboard,
 * taking over the top page, opening a window, and navigating itself.
 *
 * It is framed twice. Once with `PLUGIN_FRAME_SANDBOX`, the way a host will
 * frame it, and once BARE, with no sandbox attribute and with the microphone
 * and clipboard delegated by `allow=`. The bare frame is what proves main's
 * own layer: with the host's attribute and Permissions Policy out of the way,
 * only what main serves (the frame CSP, its `sandbox` directive included) and
 * `security.ts` are left to refuse. Measured: without the CSP's `sandbox`,
 * the bare frame's popup reached `shell.openExternal`.
 *
 * `shell.openExternal` is stubbed to record, because the failure that matters
 * most is quiet: a plugin's popup or top navigation handed to the OS browser
 * is a network request its `connect-src 'none'` exists to refuse.
 */
import { test, expect, type Page, type ElectronApplication } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot, servePluginFrame } from './helpers/launch';
import { PLUGIN_FRAME_SANDBOX } from '../../src/shared/plugins/frame';
import { runAxe, seriousOrWorse } from '../helpers/axe-playwright';

const FIXTURE = path.join(projectRoot, 'tests', 'fixtures', 'hostile-plugins', 'frame');
const ORIGIN = 'minerva-plugin://hostile';

async function launch() {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), `minerva-e2e-pluginframe-${p}-`));
  const userDataDir = tmp('userdata');
  const projectDir = tmp('project');
  const pluginDir = tmp('plugin');
  const outsideDir = tmp('outside');
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.cpSync(FIXTURE, pluginDir, { recursive: true });
  // A link inside the plugin folder that leads out of it: must be a 404.
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'outside-canary');
  fs.symlinkSync(outsideDir, path.join(pluginDir, 'link-out'));
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  const cleanup = () => {
    for (const d of [userDataDir, projectDir, pluginDir, outsideDir]) fs.rmSync(d, { recursive: true, force: true });
  };
  return { app, pluginDir, cleanup };
}

async function waitForWorkspace(win: Page): Promise<void> {
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 25_000 });
}

/** Record every URL main tries to hand to the OS browser. */
async function recordOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as typeof globalThis & { __e2eOpened?: string[] };
    g.__e2eOpened = [];
    shell.openExternal = async (url: string) => { g.__e2eOpened!.push(url); };
  });
}
const openedExternally = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as typeof globalThis & { __e2eOpened?: string[] }).__e2eOpened ?? []);

/** Fetch through the real protocol handler, from main. */
const fetchFromMain = (app: ElectronApplication, url: string) =>
  app.evaluate(async ({ net }, u) => {
    const res = await net.fetch(u);
    return { status: res.status, csp: res.headers.get('content-security-policy'), body: res.ok ? await res.text() : '' };
  }, url);

/** Frame the fixture in the app's renderer: sandboxed (as a host will) or bare. */
async function frameFixture(win: Page, kind: 'sandboxed' | 'bare') {
  await win.evaluate(([k, origin, sandbox]) => {
    const f = document.createElement('iframe');
    f.id = `e2e-plugin-${k}`;
    if (k === 'sandboxed') f.setAttribute('sandbox', sandbox);
    // Delegate the permissions, so Permissions Policy isn't what refuses them.
    f.setAttribute('allow', 'microphone; camera; clipboard-read; clipboard-write');
    f.src = `${origin}/index.html?${k}`;
    f.style.cssText = 'position:fixed;top:120px;left:320px;width:420px;height:220px;z-index:99999;background:#fff';
    document.body.appendChild(f);
  }, [kind, ORIGIN, PLUGIN_FRAME_SANDBOX] as const);
  await expect.poll(() => win.frames().some((fr) => fr.url().endsWith(`?${kind}`)), { timeout: 10_000 }).toBe(true);
  const frame = win.frames().find((fr) => fr.url().endsWith(`?${kind}`))!;
  await frame.waitForFunction(() => (window as unknown as { scriptRan?: boolean }).scriptRan === true, null, { timeout: 10_000 });
  return { frame, locator: win.frameLocator(`#e2e-plugin-${kind}`) };
}

test('the minerva-plugin: protocol serves the plugin folder under the frame CSP, and nothing outside it (#2824)', async () => {
  const { app, pluginDir, cleanup } = await launch();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);
    await servePluginFrame(app, 'hostile', pluginDir);

    const index = await fetchFromMain(app, `${ORIGIN}/index.html`);
    expect(index.status).toBe(200);
    expect(index.csp).toContain("connect-src 'none'");
    expect(index.csp).toContain("script-src 'self'");
    expect(index.csp).toContain('frame-ancestors app://minerva');
    expect(index.csp).toContain('sandbox allow-scripts allow-same-origin');

    for (const url of [
      `${ORIGIN}/link-out/secret.txt`,          // a link out of the folder
      `${ORIGIN}/%2e%2e/%2e%2e/etc/hosts`,      // encoded escape
      `${ORIGIN}/missing.html`,
      'minerva-plugin://nobody/index.html',    // not a plugin with a frame
    ]) {
      const res = await fetchFromMain(app, url);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('outside-canary');
    }
  } finally {
    await closeMinerva(app);
    cleanup();
  }
});

for (const kind of ['bare', 'sandboxed'] as const) {
  test(`a ${kind} plugin frame reaches no network, no IPC, no permission, no navigation and no window (#2824)`, async () => {
    const { app, pluginDir, cleanup } = await launch();
    try {
      const win = await app.firstWindow({ timeout: 20_000 });
      await waitForWorkspace(win);
      await servePluginFrame(app, 'hostile', pluginDir);
      await recordOpenExternal(app);
      const startUrl = win.url();
      const windowsBefore = app.windows().length;
      const { frame, locator } = await frameFixture(win, kind);

      const reach = await frame.evaluate(async () => {
        const w = window as unknown as Record<string, unknown>;
        const refused = async (p: () => Promise<unknown>) => {
          try { await p(); return false; } catch { return true; }
        };
        const mic = await navigator.permissions.query({ name: 'microphone' });
        let gum = 'granted';
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
        } catch (e) { gum = (e as Error).name; }
        return {
          origin: location.origin,
          inlineRan: w.inlineRan === true,
          api: typeof w.api,
          require: typeof w.require,
          process: typeof w.process,
          fetchOut: await refused(() => fetch('https://example.com/')),
          fetchOwn: await refused(() => fetch('other.html')),
          clipboardRead: await refused(() => navigator.clipboard.readText()),
          mic: mic.state,
          gum,
        };
      });
      expect(reach).toEqual({
        origin: ORIGIN,
        inlineRan: false,
        api: 'undefined',
        require: 'undefined',
        process: 'undefined',
        fetchOut: true,
        fetchOwn: true,
        clipboardRead: true,
        mic: 'denied',
        gum: 'NotAllowedError',
      });

      // Real clicks: each attempt runs with user activation.
      await locator.locator('#top-nav').click();
      await locator.locator('#popup').click();
      await win.waitForTimeout(1000);
      expect(win.url()).toBe(startUrl);
      expect(app.windows().length).toBe(windowsBefore);

      await locator.locator('#self-nav').click();
      await win.waitForTimeout(1000);
      const after = win.frames().find((fr) => fr.url().startsWith(ORIGIN));
      expect(after?.url()).toBe(`${ORIGIN}/index.html?${kind}`);
      expect(await after!.title()).not.toBe('NAVIGATED');

      expect(await openedExternally(app)).toEqual([]);
      // Still the app.
      await expect(win.locator('[data-relative-path]').first()).toBeVisible();
    } finally {
      await closeMinerva(app);
      cleanup();
    }
  });
}

test('only the app may frame a plugin: a note\'s HTML preview frame cannot (#2824)', async () => {
  const { app, pluginDir, cleanup } = await launch();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);
    await servePluginFrame(app, 'hostile', pluginDir);
    // A srcdoc frame, like the HTML preview's, that tries to embed the plugin.
    await win.evaluate((origin) => {
      const f = document.createElement('iframe');
      f.id = 'e2e-html-preview';
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = `<iframe id="inner" src="${origin}/index.html?nested"></iframe>`;
      document.body.appendChild(f);
    }, ORIGIN);
    await win.waitForTimeout(2000);
    expect(win.frames().some((fr) => fr.url().startsWith(ORIGIN))).toBe(false);
  } finally {
    await closeMinerva(app);
    cleanup();
  }
});

test("the a11y scan reaches into a plugin frame, and says which (#2828)", async () => {
  const { app, pluginDir, cleanup } = await launch();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);
    await servePluginFrame(app, 'hostile', pluginDir);
    const { frame } = await frameFixture(win, 'sandboxed');
    // A button with no name: a critical violation, only inside the frame.
    await frame.evaluate(() => { const b = document.createElement('button'); b.id = 'nameless'; document.body.append(b); });
    const found = seriousOrWorse(await runAxe(win)).filter((v) => v.id === 'button-name');
    expect(found.flatMap((v) => v.nodes.map((n) => n.target))).toContainEqual([ORIGIN, '#nameless']);
  } finally {
    await closeMinerva(app);
    cleanup();
  }
});
