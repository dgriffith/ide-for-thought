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
  appListeners: new Map<string, (...a: unknown[]) => void>(),
  partitions: new Map<string, { id: string }>(),
  displayMedia: null as null | ((request: unknown, cb: (streams: unknown) => void) => void),
  screenSources: [{ id: 'screen:1:0', name: 'Entire Screen' }] as Array<{ id: string; name: string }>,
}));

vi.mock('electron', () => ({
  app: { on: (event: string, fn: (...a: unknown[]) => void) => { cap.appListeners.set(event, fn); } },
  session: {
    fromPartition: (p: string) => {
      if (!cap.partitions.has(p)) cap.partitions.set(p, { id: p });
      return cap.partitions.get(p);
    },
    defaultSession: {
      webRequest: {
        onHeadersReceived: (fn: typeof cap.onHeaders) => { cap.onHeaders = fn; },
      },
      setPermissionRequestHandler: (fn: typeof cap.permissionRequest) => { cap.permissionRequest = fn; },
      setPermissionCheckHandler: (fn: typeof cap.permissionCheck) => { cap.permissionCheck = fn; },
      setDisplayMediaRequestHandler: (fn: typeof cap.displayMedia) => { cap.displayMedia = fn; },
    },
  },
  desktopCapturer: { getSources: () => Promise.resolve(cap.screenSources) },
  shell: { openExternal: (url: string) => { cap.openExternal.push(url); return Promise.resolve(); } },
}));

import {
  installCsp,
  installPermissions,
  installNavigationGuards,
  installGlobalWebContentsGuards,
  allowHttpsBrowsing,
  denyAllPermissions,
  HARDENED_WEB_PREFERENCES,
} from '../../src/main/security';

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

describe('installPermissions (#1001, clipboard grant #2068)', () => {
  it('grants media and clipboard-write only to the app\'s own origin, denies everything else', () => {
    installPermissions();
    const req = cap.permissionRequest!;

    const grant = (url: string | undefined, permission: string) => {
      let granted: boolean | undefined;
      req({ getURL: () => url }, permission, (g) => { granted = g; });
      return granted;
    };

    expect(grant('app://minerva/index.html', 'media')).toBe(true);
    expect(grant('https://evil.example', 'media')).toBe(false);   // foreign origin
    expect(grant('app://minerva/index.html', 'clipboard-sanitized-write')).toBe(true);
    expect(grant('https://evil.example', 'clipboard-sanitized-write')).toBe(false); // foreign origin
    expect(grant('app://minerva/index.html', 'geolocation')).toBe(false); // neither media nor clipboard
    expect(grant(undefined, 'media')).toBe(false);                // no URL
    expect(grant('file:///tmp/x.html', 'media')).toBe(false);     // any local file: not us (#2564)
  });

  it('check handler mirrors the request handler', () => {
    installPermissions();
    const check = cap.permissionCheck!;
    expect(check(null, 'media', 'app://minerva')).toBe(true);
    expect(check(null, 'media', 'https://evil.example')).toBe(false);
    expect(check(null, 'clipboard-sanitized-write', 'app://minerva')).toBe(true);
    expect(check(null, 'notifications', 'app://minerva')).toBe(false);
  });
});

describe('display media for meeting recordings (#2731)', () => {
  const ENTRY = 'app://minerva/index.html';
  const frame = (url: string, top = true) => ({ url, parent: top ? null : { url: ENTRY } });

  async function answer(request: Record<string, unknown>): Promise<unknown> {
    installPermissions();
    return new Promise((resolve) => cap.displayMedia!(request, resolve));
  }

  it('grants the renderer page system audio as loopback, with a screen as the required video', async () => {
    expect(await answer({ frame: frame(ENTRY), audioRequested: true, videoRequested: true }))
      .toEqual({ video: cap.screenSources[0], audio: 'loopback' });
  });

  it('denies a subframe, a foreign or local page, no frame, or a video-only request', async () => {
    const denied = [
      { frame: frame(ENTRY, false), audioRequested: true },
      { frame: frame('https://evil.example/'), audioRequested: true },
      { frame: frame('file:///tmp/x.html'), audioRequested: true },
      { frame: null, audioRequested: true },
      { frame: frame(ENTRY), audioRequested: false, videoRequested: true },
    ];
    for (const request of denied) expect(await answer(request), JSON.stringify(request)).toBeNull();
  });

  it('denies when there is no screen to pair the audio with', async () => {
    const saved = cap.screenSources;
    cap.screenSources = [];
    try {
      expect(await answer({ frame: frame(ENTRY), audioRequested: true })).toBeNull();
    } finally {
      cap.screenSources = saved;
    }
  });
});

describe('installNavigationGuards (#1001)', () => {
  const ENTRY = 'file:///Users/x/app/renderer/main_window/index.html';

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
    installNavigationGuards(h.wc, ENTRY);

    expect(h.windowOpen('https://example.com/doc')).toEqual({ action: 'deny' });
    expect(cap.openExternal).toEqual(['https://example.com/doc']);
  });

  it('blocks top-level navigation off the app origin and diverts it, allows own origin', () => {
    const h = fakeWebContents();
    installNavigationGuards(h.wc, ENTRY);

    // Foreign navigation: prevented + diverted.
    let prevented = false;
    h.willNavigate({ preventDefault: () => { prevented = true; } }, 'https://example.com');
    expect(prevented).toBe(true);
    expect(cap.openExternal).toEqual(['https://example.com']);

    // Own-origin navigation (file://): allowed, no divert.
    cap.openExternal = [];
    let preventedOwn = false;
    h.willNavigate({ preventDefault: () => { preventedOwn = true; } }, `${ENTRY}#/note`);
    expect(preventedOwn).toBe(false);
    expect(cap.openExternal).toEqual([]);
  });

  it('refuses every file:// page but the renderer entry, and never hands one to the OS (#2552)', () => {
    const h = fakeWebContents();
    installNavigationGuards(h.wc, ENTRY);

    for (const url of [
      'file:///tmp/x.html',
      'file:///Volumes/shared/thoughtbase/evil.html',
      'file:///Users/x/app/renderer/main_window/other.html',
      'file:///Users/x/app/renderer/main_window/index.html/../../../../tmp/x.html',
    ]) {
      let prevented = false;
      h.willNavigate({ preventDefault: () => { prevented = true; } }, url);
      expect(prevented, url).toBe(true);
    }
    expect(cap.openExternal).toEqual([]);
  });
});

describe('HARDENED_WEB_PREFERENCES (#1001)', () => {
  it('keeps the renderer sandboxed and isolated', () => {
    expect(HARDENED_WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      navigateOnDragDrop: false,
    });
  });
});

describe('deny-by-default guards on every webContents and session (#2559)', () => {
  type Listener = (...a: unknown[]) => void;
  /** A WebContents stub with real multi-listener semantics (the global guard
   *  and a window's own guard both listen to will-navigate). */
  function fakeWc(sess: unknown = { id: 'default-ish' }) {
    let openHandler: (d: { url: string }) => unknown = () => undefined;
    const listeners = new Map<string, Listener[]>();
    const wc = {
      session: sess,
      setWindowOpenHandler: (fn: typeof openHandler) => { openHandler = fn; },
      on: (event: string, fn: Listener) => { listeners.set(event, [...(listeners.get(event) ?? []), fn]); },
    } as unknown as import('electron').WebContents;
    const fire = (event: string, url?: string) => {
      let prevented = false;
      for (const fn of listeners.get(event) ?? []) fn({ preventDefault: () => { prevented = true; } }, url);
      return prevented;
    };
    return { wc, windowOpen: (url: string) => openHandler({ url }), fire };
  }

  beforeEach(() => {
    cap.appListeners.clear();
    cap.partitions.clear();
    installGlobalWebContentsGuards();
  });
  const created = (wc: import('electron').WebContents) => cap.appListeners.get('web-contents-created')!({}, wc);

  it('hooks web-contents-created and session-created', () => {
    expect(cap.appListeners.has('web-contents-created')).toBe(true);
    expect(cap.appListeners.has('session-created')).toBe(true);
  });

  it('a webContents with no opt-in can neither open a window, navigate, nor attach a webview', () => {
    const h = fakeWc();
    created(h.wc);
    expect(h.windowOpen('https://example.com/')).toEqual({ action: 'deny' });
    expect(h.fire('will-navigate', 'https://example.com/')).toBe(true);
    expect(h.fire('will-navigate', 'file:///tmp/x.html')).toBe(true);
    expect(h.fire('will-attach-webview')).toBe(true);
  });

  it('the main window opts in: its own guard decides, the default stands down', () => {
    const h = fakeWc();
    created(h.wc); // fires during `new BrowserWindow`, before installNavigationGuards
    const entry = 'file:///app/renderer/main_window/index.html';
    installNavigationGuards(h.wc, entry);
    expect(h.fire('will-navigate', `${entry}#/x`)).toBe(false);
    expect(h.fire('will-navigate', 'file:///tmp/x.html')).toBe(true); // its own guard refuses
    expect(h.fire('will-attach-webview')).toBe(true); // still never
  });

  describe('the privileged-site login partition', () => {
    const PARTITION = 'persist:privileged-abc';

    it('browses https only, and opens https popups pinned to the same hardened partition', () => {
      const sess = allowHttpsBrowsing(PARTITION);
      const h = fakeWc(sess);
      created(h.wc);
      expect(h.fire('will-navigate', 'https://accounts.example.com/oauth')).toBe(false);
      for (const url of ['http://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'minerva://x']) {
        expect(h.fire('will-navigate', url), url).toBe(true);
      }
      expect(h.windowOpen('https://accounts.example.com/popup')).toEqual({
        action: 'allow',
        overrideBrowserWindowOptions: { webPreferences: { ...HARDENED_WEB_PREFERENCES, partition: PARTITION } },
      });
      expect(h.windowOpen('http://example.com/')).toEqual({ action: 'deny' });
      expect(h.windowOpen('file:///tmp/x.html')).toEqual({ action: 'deny' });
      expect(h.fire('will-attach-webview')).toBe(true);
    });

    it('an OAuth popup in that partition gets the same policy at creation, whatever the event order', () => {
      const sess = allowHttpsBrowsing(PARTITION);
      const popup = fakeWc(sess);
      created(popup.wc);
      expect(popup.fire('will-navigate', 'https://idp.example.com/callback')).toBe(false);
      expect(popup.fire('will-navigate', 'file:///tmp/x.html')).toBe(true);
    });

    it('a page there is denied every permission (mic, camera, location, notifications)', () => {
      const sess = {
        request: null as null | ((wc: unknown, p: string, cb: (g: boolean) => void) => void),
        check: null as null | ((...a: unknown[]) => boolean),
        setPermissionRequestHandler(fn: never) { this.request = fn; },
        setPermissionCheckHandler(fn: never) { this.check = fn; },
        displayMedia: null as null | ((r: unknown, cb: (s: unknown) => void) => void),
        setDisplayMediaRequestHandler(fn: never) { this.displayMedia = fn; },
      };
      cap.appListeners.get('session-created')!(sess);
      for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-sanitized-write', 'midi']) {
        let granted: boolean | undefined;
        sess.request!({}, permission, (g) => { granted = g; });
        expect(granted, permission).toBe(false);
        expect(sess.check!({}, permission, 'https://site.example'), permission).toBe(false);
      }
    });
  });

  it('denyAllPermissions is what session-created installs', () => {
    const calls: string[] = [];
    const sess = {
      setPermissionRequestHandler: () => calls.push('request'),
      setPermissionCheckHandler: () => calls.push('check'),
      setDisplayMediaRequestHandler: (fn: (r: unknown, cb: (s: unknown) => void) => void) => {
        calls.push('displayMedia');
        let streams: unknown = 'unset';
        fn({ audioRequested: true }, (s) => { streams = s; });
        expect(streams).toBeNull(); // every other session denies getDisplayMedia (#2731)
      },
    } as unknown as import('electron').Session;
    denyAllPermissions(sess);
    expect(calls).toEqual(['request', 'check', 'displayMedia']);
  });
});
