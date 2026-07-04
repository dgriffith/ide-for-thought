/**
 * Security-boundary assertion tests (#1001).
 *
 * `security-helpers.ts` (the pure CSP string + routing decisions) is tested
 * separately. This covers the *wiring* in `security.ts` — that the CSP header
 * is actually installed, that the media-permission handlers grant only the
 * app's own origin, and that the navigation guards deny window.open / divert
 * foreign navigation — plus the renderer `webPreferences` hardening. Previously
 * this real security boundary was only exercised indirectly by the e2e smoke's
 * console-error check; here it fails a fast unit test if it regresses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type HeadersCb = (r: { responseHeaders: Record<string, string[] | string> }) => void;
const cap = vi.hoisted(() => ({
  onHeaders: null as null | ((details: { responseHeaders: Record<string, string[]> }, cb: HeadersCb) => void),
  permissionRequest: null as null | ((wc: { getURL(): string | undefined } | null, permission: string, cb: (granted: boolean) => void) => void),
  permissionCheck: null as null | ((wc: unknown, permission: string, origin: string) => boolean),
  openExternal: [] as string[],
}));

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: (fn: typeof cap.onHeaders) => { cap.onHeaders = fn; },
      },
      setPermissionRequestHandler: (fn: typeof cap.permissionRequest) => { cap.permissionRequest = fn; },
      setPermissionCheckHandler: (fn: typeof cap.permissionCheck) => { cap.permissionCheck = fn; },
    },
  },
  shell: { openExternal: (url: string) => { cap.openExternal.push(url); return Promise.resolve(); } },
}));

import { installCsp, installMediaPermissions, installNavigationGuards, HARDENED_WEB_PREFERENCES } from '../../src/main/security';

// The vite `define` globals don't exist under vitest; undefined selects the
// production (strict CSP, file:// own-origin) branch.
vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);

beforeEach(() => {
  cap.onHeaders = null;
  cap.permissionRequest = null;
  cap.permissionCheck = null;
  cap.openExternal = [];
});

describe('installCsp (#1001)', () => {
  it('adds a strict Content-Security-Policy header to every response', () => {
    installCsp();
    expect(cap.onHeaders).toBeTypeOf('function');

    let out: { responseHeaders: Record<string, string[] | string> } | undefined;
    cap.onHeaders!({ responseHeaders: { 'x-existing': ['1'] } }, (r) => { out = r; });

    const csp = out?.responseHeaders['Content-Security-Policy'];
    expect(Array.isArray(csp)).toBe(true);
    const value = (csp as string[])[0];
    expect(value).toContain("default-src 'self'");
    expect(value).toContain("object-src 'none'");
    // Existing headers are preserved, not clobbered.
    expect(out?.responseHeaders['x-existing']).toEqual(['1']);
  });
});

describe('installMediaPermissions (#1001)', () => {
  it('grants media only to the app\'s own origin, denies everything else', () => {
    installMediaPermissions();
    const req = cap.permissionRequest!;

    const grant = (url: string | undefined, permission: string) => {
      let granted: boolean | undefined;
      req({ getURL: () => url }, permission, (g) => { granted = g; });
      return granted;
    };

    expect(grant('file:///Users/x/app/index.html', 'media')).toBe(true);
    expect(grant('https://evil.example', 'media')).toBe(false);   // foreign origin
    expect(grant('file:///Users/x/app/index.html', 'geolocation')).toBe(false); // non-media
    expect(grant(undefined, 'media')).toBe(false);                // no URL
  });

  it('check handler mirrors the request handler', () => {
    installMediaPermissions();
    const check = cap.permissionCheck!;
    expect(check(null, 'media', 'file:///Users/x/app/index.html')).toBe(true);
    expect(check(null, 'media', 'https://evil.example')).toBe(false);
    expect(check(null, 'notifications', 'file:///Users/x/app/index.html')).toBe(false);
  });
});

describe('installNavigationGuards (#1001)', () => {
  /** A minimal WebContents stub that records the handlers security.ts installs. */
  function fakeWebContents() {
    let openHandler: (d: { url: string }) => { action: string } = () => ({ action: '' });
    const listeners = new Map<string, (...a: unknown[]) => void>();
    const wc = {
      setWindowOpenHandler: (fn: typeof openHandler) => { openHandler = fn; },
      on: (event: string, fn: (...a: unknown[]) => void) => { listeners.set(event, fn); },
    } as unknown as import('electron').WebContents;
    return {
      wc,
      windowOpen: (url: string) => openHandler({ url }),
      willNavigate: (event: { preventDefault(): void }, url: string) =>
        listeners.get('will-navigate')?.(event, url),
    };
  }

  it('denies every window.open and diverts http(s) targets to the OS browser', () => {
    const h = fakeWebContents();
    installNavigationGuards(h.wc);

    expect(h.windowOpen('https://example.com/doc')).toEqual({ action: 'deny' });
    expect(cap.openExternal).toEqual(['https://example.com/doc']);
  });

  it('blocks top-level navigation off the app origin and diverts it, allows own origin', () => {
    const h = fakeWebContents();
    installNavigationGuards(h.wc);

    // Foreign navigation: prevented + diverted.
    let prevented = false;
    h.willNavigate({ preventDefault: () => { prevented = true; } }, 'https://example.com');
    expect(prevented).toBe(true);
    expect(cap.openExternal).toEqual(['https://example.com']);

    // Own-origin navigation (file://): allowed, no divert.
    cap.openExternal = [];
    let preventedOwn = false;
    h.willNavigate({ preventDefault: () => { preventedOwn = true; } }, 'file:///Users/x/app/index.html');
    expect(preventedOwn).toBe(false);
    expect(cap.openExternal).toEqual([]);
  });
});

describe('HARDENED_WEB_PREFERENCES (#1001)', () => {
  it('keeps the renderer sandboxed and isolated', () => {
    expect(HARDENED_WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });
});
