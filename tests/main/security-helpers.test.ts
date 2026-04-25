/**
 * Pure-helper tests for #339. The Electron-bound install* functions are
 * exercised by smoke testing in dev / packaged builds; here we just lock
 * down the CSP string and the URL routing decisions.
 */

import { describe, it, expect } from 'vitest';
import { buildCsp, isOwnOrigin, externalNavTarget } from '../../src/main/security-helpers';

describe('buildCsp (#339)', () => {
  it('production CSP: strict default-src self, no external script-src, no inline script', () => {
    const csp = buildCsp();
    expect(csp).toMatch(/default-src 'self'/);
    // 'self' + 'wasm-unsafe-eval' for tesseract; nothing else for scripts.
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'/);
    // Crucially, no 'unsafe-inline' for script-src.
    const scriptSrc = csp.match(/script-src ([^;]+)/)![1];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    // No external host in script-src in prod.
    expect(scriptSrc).not.toMatch(/https?:/);
  });

  it('connect-src allows the renderer-direct hosts but is otherwise tight', () => {
    const csp = buildCsp();
    expect(csp).toMatch(/connect-src 'self' https:\/\/cdn\.jsdelivr\.net https:\/\/unpkg\.com/);
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

  it('dev mode adds the Vite origin to script-src and connect-src + ws to connect-src', () => {
    const csp = buildCsp({ devServerOrigin: 'http://localhost:5173' });
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' http:\/\/localhost:5173/);
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
  it('treats file:// URLs as own origin (packaged build)', () => {
    expect(isOwnOrigin('file:///Applications/Minerva.app/Contents/Resources/index.html')).toBe(true);
  });

  it('treats the Vite dev server as own origin in dev', () => {
    expect(isOwnOrigin('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isOwnOrigin('http://localhost:5173/foo', 'http://localhost:5173')).toBe(true);
  });

  it('rejects external https as own origin', () => {
    expect(isOwnOrigin('https://example.com/')).toBe(false);
    expect(isOwnOrigin('https://example.com/', 'http://localhost:5173')).toBe(false);
  });

  it('rejects file:// when dev origin set, file:// stays own (prod-mode reload still works)', () => {
    expect(isOwnOrigin('file:///x/y.html', 'http://localhost:5173')).toBe(true);
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
