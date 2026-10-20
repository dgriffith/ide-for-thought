/**
 * How long copying a note set into a plugin frame takes (#2827), measured in
 * the real app — the real port between main and the frame's process. Opt-in
 * (`MINERVA_MEASURE=1`): it builds a thoughtbase of 500 and 5,000 notes, and
 * is a measurement, not a gate. The numbers are recorded in
 * docs/plugin-code.md → *The plugin UI kit*.
 *
 *   MINERVA_MEASURE=1 pnpm exec playwright test tests/e2e/plugin-note-copy.measure.spec.ts
 */
import { test, expect } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot, servePluginFrame } from './helpers/launch';
import { PLUGIN_API_VERSION } from '../../src/shared/plugins/api';

const FIXTURE = path.join(projectRoot, 'tests', 'fixtures', 'hostile-plugins', 'frame');
const ORIGIN = 'minerva-plugin://hostile';

/** A note of about 2 KB: frontmatter a type view uses, and a body. */
function note(i: number): string {
  const body = Array.from({ length: 12 }, (_, l) => `Line ${l} of note ${i}: some ordinary prose about the work, with a [[link-${(i + l) % 97}]] in it.`).join('\n');
  return `---\ntype: project\nstatus: ${['todo', 'doing', 'done'][i % 3]}\ndue: 2026-11-${String((i % 28) + 1).padStart(2, '0')}\n---\n# Note ${i}\n\n${body}\n`;
}

for (const count of [500, 5000]) {
  test(`copy ${count} notes into a plugin frame`, async () => {
    test.skip(process.env.MINERVA_MEASURE !== '1', 'a measurement: MINERVA_MEASURE=1 runs it');
    test.setTimeout(300_000);
    const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), `minerva-measure-${p}-`));
    const userDataDir = tmp('userdata');
    const projectDir = tmp('project');
    const pluginDir = tmp('plugin');
    fs.mkdirSync(path.join(projectDir, 'notes'));
    const paths: string[] = [];
    for (let i = 0; i < count; i++) {
      const rel = `notes/n${i}.md`;
      fs.writeFileSync(path.join(projectDir, rel), note(i));
      paths.push(rel);
    }
    fs.cpSync(FIXTURE, pluginDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]));
    const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
    try {
      const win = await app.firstWindow({ timeout: 60_000 });
      await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 120_000 });
      await servePluginFrame(app, 'hostile', pluginDir, ['notes:read']);
      await win.evaluate((origin) => {
        const f = document.createElement('iframe');
        f.id = 'e2e-plugin';
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        f.src = `${origin}/index.html?measure`;
        document.body.appendChild(f);
      }, ORIGIN);
      await expect.poll(() => win.frames().some((fr) => fr.url().endsWith('?measure')), { timeout: 10_000 }).toBe(true);
      const frame = win.frames().find((fr) => fr.url().endsWith('?measure'))!;
      await frame.waitForFunction(() => (window as unknown as { scriptRan?: boolean }).scriptRan === true);
      await frame.evaluate(() => {
        (window as unknown as { minerva: Promise<unknown> }).minerva = import('/@minerva/plugin-api.js').then((m: { connect(): Promise<unknown> }) => m.connect());
      });
      const opened = Date.now();
      await win.evaluate(async ([origin, scope, apiVersion]) => {
        const w = window as unknown as { api: { plugins: { openSession(id: string, s: string[]): Promise<unknown> } } };
        const port = await new Promise<MessagePort>((resolve) => {
          const on = (e: MessageEvent) => {
            if (e.source !== window || (e.data as { type?: string } | null)?.type !== 'minerva.plugin-session-port') return;
            window.removeEventListener('message', on);
            resolve(e.ports[0]!);
          };
          window.addEventListener('message', on);
          void w.api.plugins.openSession('hostile', scope);
        });
        (document.getElementById('e2e-plugin') as HTMLIFrameElement).contentWindow!.postMessage({ type: 'minerva.plugin-port', apiVersion }, origin, [port]);
      }, [ORIGIN, paths, PLUGIN_API_VERSION] as const);
      const openMs = Date.now() - opened;

      const result = await frame.evaluate(async () => {
        type M = { notes: { list(): Promise<{ paths: string[] }>; read(p: { path: string }): Promise<{ content: string }> } };
        const minerva = await (window as unknown as { minerva: Promise<M> }).minerva;
        const t0 = performance.now();
        const { paths: all } = await minerva.notes.list();
        const t1 = performance.now();
        let bytes = 0;
        // As a view would: 16 at a time, the broker's in-flight limit.
        for (let i = 0; i < all.length; i += 16) {
          const batch = await Promise.all(all.slice(i, i + 16).map((p) => minerva.notes.read({ path: p })));
          for (const n of batch) bytes += n.content.length;
        }
        const t2 = performance.now();
        return { notes: all.length, listMs: Math.round(t1 - t0), readMs: Math.round(t2 - t1), bytes };
      });
      console.log(`[measure] ${count} notes: session ${openMs}ms, list ${result.listMs}ms, read all ${result.readMs}ms (${(result.readMs / count).toFixed(2)}ms/note), ${(result.bytes / 1024 / 1024).toFixed(1)} MB`);
      expect(result.notes).toBe(count);
    } finally {
      await closeMinerva(app);
      for (const d of [userDataDir, projectDir, pluginDir]) fs.rmSync(d, { recursive: true, force: true });
    }
  });
}
