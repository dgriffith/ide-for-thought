/**
 * A plugin frame talks to Minerva over the session port, and only within what
 * it was given (#2825) — end to end, through the real relay: main opens the
 * session and posts the port, the preload posts it into the page, the page
 * hands it to the hostile fixture's frame (`tests/fixtures/hostile-plugins/frame/`).
 *
 * The page half here is the same check `stores/plugin-sessions.svelte.ts`
 * makes — take the port only when `event.source` is the window itself — run
 * in a real Electron, which is what proves the preload's message satisfies it.
 *
 * The fixture declares `notes:read`, `graph:query` and
 * `notes:write-properties`, and nothing else.
 */
import { test, expect, type Page, type ElectronApplication } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot, servePluginFrame } from './helpers/launch';

const FIXTURE = path.join(projectRoot, 'tests', 'fixtures', 'hostile-plugins', 'frame');
const ORIGIN = 'minerva-plugin://hostile';
const IN_SCOPE = 'notes/architecture.md';
const OUT_OF_SCOPE = 'research/overview.md';

type Reply = { id: number; result?: Record<string, unknown>; error?: { code: string; message: string } };

async function launch() {
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), `minerva-e2e-pluginsession-${p}-`));
  const userDataDir = tmp('userdata');
  const projectDir = tmp('project');
  const pluginDir = tmp('plugin');
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.cpSync(FIXTURE, pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  const cleanup = () => {
    for (const d of [userDataDir, projectDir, pluginDir]) fs.rmSync(d, { recursive: true, force: true });
  };
  return { app, projectDir, pluginDir, cleanup };
}

async function connect(app: ElectronApplication, win: Page, pluginDir: string) {
  await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 25_000 });
  await servePluginFrame(app, 'hostile', pluginDir, ['notes:read', 'graph:query', 'notes:write-properties']);
  await win.evaluate((origin) => {
    const f = document.createElement('iframe');
    f.id = 'e2e-plugin';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    f.src = `${origin}/index.html?session`;
    document.body.appendChild(f);
  }, ORIGIN);
  await expect.poll(() => win.frames().some((fr) => fr.url().endsWith('?session')), { timeout: 10_000 }).toBe(true);
  const frame = win.frames().find((fr) => fr.url().endsWith('?session'))!;
  await frame.waitForFunction(() => (window as unknown as { scriptRan?: boolean }).scriptRan === true);

  // The host's half: open a session, take the port from THIS window only, hand it to the frame.
  const relayed = await win.evaluate(async ([origin, scope]) => {
    const w = window as unknown as { api: { plugins: { openSession(id: string, s: string[]): Promise<{ sessionId: string }> } } };
    let foreign = 0;
    const port = await new Promise<MessagePort>((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        const data = e.data as { type?: string } | null;
        if (data?.type !== 'minerva:plugin-session-port') return;
        if (e.source !== window || e.origin !== window.location.origin || !e.ports[0]) { foreign += 1; return; }
        window.removeEventListener('message', onMessage);
        resolve(e.ports[0]);
      };
      window.addEventListener('message', onMessage);
      setTimeout(() => reject(new Error('no session port arrived')), 5000);
      void w.api.plugins.openSession('hostile', scope);
    });
    const frameEl = document.getElementById('e2e-plugin') as HTMLIFrameElement;
    frameEl.contentWindow!.postMessage({ type: 'minerva:plugin-port', apiVersion: 1 }, origin, [port]);
    return { foreign };
  }, [ORIGIN, [IN_SCOPE]] as const);
  expect(relayed.foreign).toBe(0);
  await frame.waitForFunction(() => !!(window as unknown as { pluginPort?: unknown }).pluginPort, null, { timeout: 5000 });
  const call = (method: string, params?: unknown) =>
    frame.evaluate(([m, p]) => (window as unknown as { callMinerva(m: string, p: unknown): Promise<unknown> }).callMinerva(m, p), [method, params] as const) as Promise<Reply>;
  return { frame, call };
}

test('a plugin frame reads and changes only what it was given, with only what it declared (#2825)', async () => {
  const { app, projectDir, pluginDir, cleanup } = await launch();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    const { call } = await connect(app, win, pluginDir);

    expect((await call('notes.list')).result).toEqual({ paths: [IN_SCOPE] });
    const read = await call('notes.read', { path: IN_SCOPE });
    expect(read.result?.content).toBe(fs.readFileSync(path.join(projectDir, IN_SCOPE), 'utf8'));

    // Outside its scope, and never Minerva's own data.
    expect((await call('notes.read', { path: OUT_OF_SCOPE })).error?.code).toBe('scope');
    expect((await call('notes.read', { path: '.minerva/config.json' })).error?.code).toBe('scope');
    expect((await call('notes.read', { path: '../../../etc/hosts' })).error?.code).toBe('scope');

    // Undeclared capabilities: no body writes, no intents.
    const before = fs.readFileSync(path.join(projectDir, IN_SCOPE), 'utf8');
    const write = await call('notes.write', { path: IN_SCOPE, content: 'pwned' });
    expect(write.error?.code).toBe('capability');
    expect(write.error?.message).toContain('"notes:write"');
    expect((await call('ui.copyText', { text: 'x' })).error?.code).toBe('capability');
    expect(fs.readFileSync(path.join(projectDir, IN_SCOPE), 'utf8')).toBe(before);

    // Its one write capability, on its one note, lands on disk.
    const set = await call('notes.setProperties', { path: IN_SCOPE, properties: { status: 'moved-by-plugin' } });
    expect(set.result).toEqual({ changed: ['status'] });
    await expect.poll(() => fs.readFileSync(path.join(projectDir, IN_SCOPE), 'utf8')).toContain('status: moved-by-plugin');
    expect((await call('notes.setProperties', { path: OUT_OF_SCOPE, properties: { status: 'x' } })).error?.code).toBe('scope');

    // A read-only query works; an unknown method is refused.
    expect((await call('graph.query', { sparql: 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1' })).result?.columns).toEqual(['s']);
    expect((await call('approve', { uri: 'x' })).error?.code).toBe('unknown-method');
  } finally {
    await closeMinerva(app);
    cleanup();
  }
});
