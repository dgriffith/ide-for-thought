/**
 * Pure-helper tests for #339. The Electron-bound install* functions are
 * exercised by smoke testing in dev / packaged builds; here we just lock
 * down the CSP string and the URL routing decisions.
 */

import { describe, it, expect } from 'vitest';
import { buildCsp, isOwnOrigin, isRendererEntry, externalNavTarget } from '../../src/main/security-helpers';

describe('buildCsp (#339)', () => {
  it('production CSP: strict default-src self, no external script-src, no inline script', () => {
    const csp = buildCsp();
    expect(csp).toMatch(/default-src 'self'/);
    // 'self' + 'wasm-unsafe-eval' for tesseract; 'blob:' for onnxruntime-web's
    // WASM proxy glue (#voice); nothing else for scripts.
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' blob:/);
    // Crucially, no 'unsafe-inline' for script-src.
    const scriptSrc = csp.match(/script-src ([^;]+)/)![1];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    // No external host in script-src in prod (blob: is a local scheme, not a host).
    expect(scriptSrc).not.toMatch(/https?:/);
  });

  it('connect-src allows the renderer-direct hosts but is otherwise tight', () => {
    const csp = buildCsp();
    // No package CDNs (#2564): tesseract and onnxruntime-web assets are bundled.
    expect(csp).not.toMatch(/jsdelivr|unpkg/);
    // Whisper model weights for voice dictation (#voice) come from the HF hub,
    // whose file bytes redirect to regional LFS/Xet CDN subdomains.
    const connectSrc = csp.match(/connect-src ([^;]+)/)![1];
    expect(connectSrc).toContain('https://huggingface.co');
    expect(connectSrc).toContain('https://*.huggingface.co');
    expect(connectSrc).toContain('https://*.hf.co');
    // OpenFreeMap vector tile + style JSON fetches for the Objects Map view (#2066).
    expect(connectSrc).toContain('https://tiles.openfreemap.org');
    // No leakage to the main-process API hosts (those are server-side calls).
    expect(csp).not.toContain('api.crossref.org');
    expect(csp).not.toContain('api.anthropic.com');
  });

  it('img-src is permissive (https: + data: + blob:) so user-embedded images render', () => {
    const csp = buildCsp();
    const imgSrc = csp.match(/img-src ([^;]+)/)![1];
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('blob:');
    expect(imgSrc).toContain('https:');
  });

  it("style-src 'unsafe-inline' is the documented compromise for Svelte + KaTeX", () => {
    const csp = buildCsp();
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/);
  });

  it('worker-src allows blob: for pdf.js + tesseract.js workers', () => {
    const csp = buildCsp();
    expect(csp).toMatch(/worker-src 'self' blob:/);
  });

  it('frame-ancestors / object-src / form-action are locked down', () => {
    const csp = buildCsp();
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/form-action 'none'/);
  });

  it("frame-src is 'self' only (#1535) — same-document srcdoc iframes, no external frame targets", () => {
    const csp = buildCsp();
    const frameSrc = csp.match(/frame-src ([^;]+)/)![1];
    expect(frameSrc).toBe("'self'");
  });

  it('dev mode adds the Vite origin to script-src and connect-src + ws to connect-src', () => {
    const csp = buildCsp({ devServerOrigin: 'http://localhost:5173' });
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' blob: http:\/\/localhost:5173/);
    const connectSrc = csp.match(/connect-src ([^;]+)/)![1];
    expect(connectSrc).toContain('http://localhost:5173');
    expect(connectSrc).toContain('ws://localhost:5173');
  });

  it('dev mode does NOT relax style-src or object-src', () => {
    const csp = buildCsp({ devServerOrigin: 'http://localhost:5173' });
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/); // already permissive in prod, unchanged
  });
});

describe('isOwnOrigin (#339)', () => {
  it('treats app://minerva as own origin, and file:// as NOT (#2564)', () => {
    expect(isOwnOrigin('app://minerva')).toBe(true);
    expect(isOwnOrigin('app://minerva/index.html')).toBe(true);
    expect(isOwnOrigin('app://minerva.evil/x')).toBe(false);
    expect(isOwnOrigin('app://other/index.html')).toBe(false);
    expect(isOwnOrigin('file:///Applications/Minerva.app/Contents/Resources/index.html')).toBe(false);
  });

  it('treats the Vite dev server as own origin in dev', () => {
    expect(isOwnOrigin('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isOwnOrigin('http://localhost:5173/foo', 'http://localhost:5173')).toBe(true);
  });

  it('rejects external https as own origin', () => {
    expect(isOwnOrigin('https://example.com/')).toBe(false);
    expect(isOwnOrigin('https://example.com/', 'http://localhost:5173')).toBe(false);
  });

  it('file:// is never own origin, dev server or not (#2564)', () => {
    expect(isOwnOrigin('file:///x/y.html', 'http://localhost:5173')).toBe(false);
  });
});

describe('isOwnOrigin dev-server match is by origin, not prefix (#2552)', () => {
  it('rejects a host that merely starts with the dev server origin', () => {
    expect(isOwnOrigin('http://localhost:5173.evil.example/', 'http://localhost:5173')).toBe(false);
    expect(isOwnOrigin('http://localhost:51730/', 'http://localhost:5173')).toBe(false);
  });
});

describe('isRendererEntry (#2552)', () => {
  const ENTRY = 'file:///Applications/Minerva.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html';

  it('allows the exact entry, ignoring query and hash', () => {
    expect(isRendererEntry(ENTRY, ENTRY)).toBe(true);
    expect(isRendererEntry(`${ENTRY}#/notes/a.md`, ENTRY)).toBe(true);
    expect(isRendererEntry(`${ENTRY}?x=1#y`, ENTRY)).toBe(true);
  });

  it('refuses any other file:// URL', () => {
    expect(isRendererEntry('file:///tmp/x.html', ENTRY)).toBe(false);
    expect(isRendererEntry('file:///Volumes/share/tb/evil.html', ENTRY)).toBe(false);
    expect(isRendererEntry(ENTRY.replace('index.html', 'evil.html'), ENTRY)).toBe(false);
    expect(isRendererEntry('file://evilhost/Applications/Minerva.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html', ENTRY)).toBe(false);
  });

  it('normalises dot segments and percent-encoding before comparing', () => {
    // `..` that resolves back onto the entry is the entry; one that leaves it is not.
    expect(isRendererEntry(ENTRY.replace('main_window/', 'main_window/x/../'), ENTRY)).toBe(true);
    expect(isRendererEntry(`${ENTRY}/../../../../../../../tmp/x.html`, ENTRY)).toBe(false);
    const spaced = 'file:///Users/a%20b/Minerva/index.html';
    expect(isRendererEntry('file:///Users/a b/Minerva/index.html', spaced)).toBe(true);
  });

  it('refuses non-file schemes and garbage', () => {
    expect(isRendererEntry('https://example.com/index.html', ENTRY)).toBe(false);
    expect(isRendererEntry('javascript:alert(1)', ENTRY)).toBe(false);
    expect(isRendererEntry('not a url', ENTRY)).toBe(false);
  });

  it('allows the dev server origin in dev, by exact origin', () => {
    const dev = 'http://localhost:5173';
    expect(isRendererEntry('http://localhost:5173/', dev, dev)).toBe(true);
    expect(isRendererEntry('http://localhost:5173/#/x', dev, dev)).toBe(true);
    expect(isRendererEntry('http://localhost:5173.evil.example/', dev, dev)).toBe(false);
    // Without a dev server, the dev origin is just a foreign URL.
    expect(isRendererEntry('http://localhost:5173/', ENTRY)).toBe(false);
  });
});

describe('externalNavTarget (#339)', () => {
  it('routes http(s) URLs to shell.openExternal', () => {
    expect(externalNavTarget('https://example.com/')).toEqual({
      kind: 'external',
      url: 'https://example.com/',
    });
    expect(externalNavTarget('http://example.com/')).toEqual({
      kind: 'external',
      url: 'http://example.com/',
    });
  });

  it('drops file: URLs (no shell.openExternal — could open arbitrary files)', () => {
    expect(externalNavTarget('file:///etc/passwd')).toEqual({ kind: 'drop' });
  });

  it('drops javascript: / data: / custom schemes', () => {
    expect(externalNavTarget('javascript:alert(1)')).toEqual({ kind: 'drop' });
    expect(externalNavTarget('data:text/html,<script>')).toEqual({ kind: 'drop' });
    expect(externalNavTarget('mailto:x@y.z')).toEqual({ kind: 'drop' });
    expect(externalNavTarget('chrome://settings')).toEqual({ kind: 'drop' });
  });
});

describe('isRendererEntry with the app:// entry (#2564)', () => {
  const ENTRY = 'app://minerva/index.html';
  it('allows the entry with hash/query, refuses other paths, hosts and schemes', () => {
    expect(isRendererEntry(ENTRY, ENTRY)).toBe(true);
    expect(isRendererEntry(`${ENTRY}#/x`, ENTRY)).toBe(true);
    expect(isRendererEntry('app://minerva/other.html', ENTRY)).toBe(false);
    expect(isRendererEntry('app://evil/index.html', ENTRY)).toBe(false);
    expect(isRendererEntry('file:///tmp/index.html', ENTRY)).toBe(false);
    expect(isRendererEntry('https://minerva/index.html', ENTRY)).toBe(false);
  });
});
