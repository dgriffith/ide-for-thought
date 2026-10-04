/**
 * Which file an `app://` request names (#2564) — the protocol handler serves
 * exactly the renderer bundle and nothing else on disk.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { APP_ENTRY_URL, APP_ORIGIN, appMimeType, resolveAppRequest } from '../../src/main/app-protocol-paths';

const ROOT = path.resolve('/app/.vite/renderer/main_window');

describe('resolveAppRequest (#2564)', () => {
  it('maps paths under the bundle, and / to index.html', () => {
    expect(APP_ENTRY_URL).toBe(`${APP_ORIGIN}/index.html`);
    expect(resolveAppRequest(APP_ENTRY_URL, ROOT)).toBe(path.join(ROOT, 'index.html'));
    expect(resolveAppRequest(`${APP_ORIGIN}/`, ROOT)).toBe(path.join(ROOT, 'index.html'));
    expect(resolveAppRequest(`${APP_ORIGIN}/assets/a-1.js?v=2#x`, ROOT)).toBe(path.join(ROOT, 'assets', 'a-1.js'));
    expect(resolveAppRequest(`${APP_ORIGIN}/assets/with%20space.wasm`, ROOT)).toBe(path.join(ROOT, 'assets', 'with space.wasm'));
  });

  it('never resolves outside the bundle (normalised dot segments stay inside; escapes are refused)', () => {
    for (const u of [
      `${APP_ORIGIN}/../../etc/passwd`,
      `${APP_ORIGIN}/%2e%2e/%2e%2e/etc/passwd`,
      `${APP_ORIGIN}/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret`,
      `${APP_ORIGIN}/..%5c..%5csecret`,
      `${APP_ORIGIN}/a%00.js`,
      `${APP_ORIGIN}/%E0%A4%A`,
    ]) {
      const r = resolveAppRequest(u, ROOT);
      expect(r === null || r.startsWith(ROOT + path.sep), `${u} → ${r}`).toBe(true);
    }
    // The ones that decode to an escape or a bad byte are refused outright.
    expect(resolveAppRequest(`${APP_ORIGIN}/..%5c..%5csecret`, ROOT)).toBeNull();
    expect(resolveAppRequest(`${APP_ORIGIN}/a%00.js`, ROOT)).toBeNull();
    expect(resolveAppRequest(`${APP_ORIGIN}/%E0%A4%A`, ROOT)).toBeNull();
  });

  it('refuses other hosts and schemes', () => {
    expect(resolveAppRequest('app://evil/index.html', ROOT)).toBeNull();
    expect(resolveAppRequest('file:///app/.vite/renderer/main_window/index.html', ROOT)).toBeNull();
    expect(resolveAppRequest('https://minerva/index.html', ROOT)).toBeNull();
    expect(resolveAppRequest('not a url', ROOT)).toBeNull();
  });
});

describe('appMimeType (#2564)', () => {
  it('serves WASM as application/wasm (streaming compile) and scripts as JS', () => {
    expect(appMimeType('x.wasm')).toBe('application/wasm');
    expect(appMimeType('x.js')).toMatch(/^text\/javascript/);
    expect(appMimeType('x.mjs')).toMatch(/^text\/javascript/);
    expect(appMimeType('index.html')).toMatch(/^text\/html/);
    expect(appMimeType('eng-abc.traineddata')).toBe('application/octet-stream');
  });
});
