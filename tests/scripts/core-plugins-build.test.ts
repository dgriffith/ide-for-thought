/**
 * @vitest-environment node
 *
 * A built-in plugin's view builds to a page served from its own origin
 * (#2828): every asset relative, nothing inline for `script-src 'self'` to
 * refuse, and the plugin API left to the copy Minerva serves.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
// Vite's JS entry under this Node, not the `.bin` shim (`vite.cmd` on Windows,
// which Node won't spawn without a shell) (#2180).
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-core-plugin-build-'));
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

describe('the built-in plugin view build (#2828)', () => {
  it('builds kanban to relative, external-API, script-src-self-safe files', () => {
    execFileSync(process.execPath, [VITE, 'build', '--config', 'vite.core-plugins.config.mts', '--logLevel', 'error'], {
      cwd: ROOT, env: { ...process.env, CORE_PLUGIN: 'kanban', CORE_PLUGIN_OUT: out }, stdio: 'pipe',
    });
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref, ref).toMatch(/^\.\/assets\//);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/); // no inline script
    const js = fs.readdirSync(path.join(out, 'assets')).filter((f) => f.endsWith('.js'));
    const bundle = js.map((f) => fs.readFileSync(path.join(out, 'assets', f), 'utf8')).join('\n');
    expect(bundle).toContain('/@minerva/plugin-api.js');
    expect(bundle).not.toContain('class PluginApiError'); // not bundled
  }, 120_000);

  it('refuses to build without a plugin id', () => {
    expect(() => execFileSync(process.execPath, [VITE, 'build', '--config', 'vite.core-plugins.config.mts'], {
      cwd: ROOT, env: { ...process.env, CORE_PLUGIN: '' }, stdio: 'pipe',
    })).toThrow();
  }, 60_000);
});

describe('where the views are built (pnpm dev)', () => {
  // `pnpm dev` builds the views, then `electron-forge start`, whose Vite plugin
  // deletes all of `.vite/` after every hook a config can run. Built there,
  // every built-in view was a "Not found" under `pnpm dev`.
  const DEV_DIR = "'node_modules', '.cache', 'minerva', 'core-plugins'";
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('builds outside .vite/, where main reads them in dev and packaging copies them from', () => {
    expect(read('vite.core-plugins.config.mts')).toContain(`path.resolve(import.meta.dirname, ${DEV_DIR}, id)`);
    expect(read('src/main/main.ts')).toContain(`path.join(app.getAppPath(), ${DEV_DIR})`);
    expect(read('forge.config.ts')).toContain(`path.join(process.cwd(), ${DEV_DIR})`);
  });
});
