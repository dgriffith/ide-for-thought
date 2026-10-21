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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-core-plugin-build-'));
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

describe('the built-in plugin view build (#2828)', () => {
  it('builds kanban to relative, external-API, script-src-self-safe files', () => {
    execFileSync(path.join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--config', 'vite.core-plugins.config.mts', '--logLevel', 'error'], {
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
    expect(() => execFileSync(path.join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--config', 'vite.core-plugins.config.mts'], {
      cwd: ROOT, env: { ...process.env, CORE_PLUGIN: '' }, stdio: 'pipe',
    })).toThrow();
  }, 60_000);
});
