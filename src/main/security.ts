/**
 * Process-wide web-security hardening (#339).
 *
 *  - **CSP** via the session's onHeadersReceived hook so it covers every
 *    document loaded into a Minerva BrowserWindow. We set it as a header
 *    rather than a `<meta>` tag because (a) headers apply to all
 *    subresources including the bootstrap script and (b) a header can't
 *    be removed by injected HTML. Dev mode loosens the policy enough for
 *    Vite's HMR + websocket; prod is strict.
 *
 *  - **setWindowOpenHandler** wired per-window in window-manager.ts so
 *    `target="_blank"` and `window.open(...)` can't replace or spawn a
 *    privileged renderer. http(s) URLs route through `shell.openExternal`;
 *    every other scheme is denied.
 *
 *  - **will-navigate** wired per-window in window-manager.ts so a stray
 *    `<a href="https://…">` click that escapes the app's click handler
 *    can't navigate the renderer wholesale. Top-level navigation is
 *    allowed only to the renderer's own entry: the exact `index.html` the
 *    window was loaded from in prod (any other file:// is refused, #2552),
 *    or the Vite dev server's origin in dev; http(s) requests get diverted
 *    to the OS browser.
 *
 *  - **Deny by default, everywhere** (#2559). `installGlobalWebContentsGuards`
 *    hooks `web-contents-created` and `session-created`, so EVERY webContents
 *    starts unable to open a window, navigate, or attach a `<webview>`, and
 *    every session but the default one denies every permission. A window
 *    that needs more opts in: the main window through
 *    `installNavigationGuards`, the privileged-site login partition through
 *    `allowHttpsBrowsing`. A window someone adds later is guarded before its
 *    author thinks about it — the PDF-render and login windows were not.
 *
 * Pure logic lives in security-helpers.ts so tests can exercise the
 * CSP string and routing decisions without pulling in `electron`.
 */

import { app, desktopCapturer, session, shell, type Session, type WebContents } from 'electron';
import { buildCsp, externalNavTarget, isOwnOrigin, isRendererEntry } from './security-helpers';
import { rendererEntryUrl } from './renderer-entry';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

/**
 * Renderer hardening spread into every BrowserWindow's `webPreferences`. The
 * renderer is treated as untrusted: `contextIsolation` + `sandbox` on,
 * `nodeIntegration` off — all privileged work goes through the preload's
 * contextBridge + IPC (#339, #684). Kept here (not inline at the window
 * construction site) so the security boundary is asserted in one place and
 * can't silently drift.
 */
export const HARDENED_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // A file dropped where nothing accepts it must not become the top-level
  // page — the preload would run on it (#2554). Electron's default, pinned
  // here so it can't change underneath us; the renderer also refuses
  // unaccepted file drops (`lib/app/navigation-guard.ts`).
  navigateOnDragDrop: false,
} as const;

/** The CSP the renderer runs under (dev loosenings when the dev server is up). */
export function rendererCsp(): string {
  return buildCsp({ devServerOrigin: MAIN_WINDOW_VITE_DEV_SERVER_URL });
}

/** Install the CSP for every response served to the default session. (The
 *  `app://` handler also sets it on its own responses, which don't pass
 *  through webRequest — see app-protocol.ts.) */
export function installCsp(): void {
  const csp = rendererCsp();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

/** Permissions granted to the app's own origin; everything else is denied. */
const OWN_ORIGIN_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write']);

/**
 * Grant the app's own renderer a narrow allowlist of Chromium permissions,
 * and deny everything else. Chromium gates each of these behind both an
 * async request handler and a sync check handler; we approve them only when
 * the request originates from our own origin (file:// in prod, the Vite dev
 * server in dev). No other permission (geolocation, notifications, …) is
 * ever auto-granted.
 *
 * - `media`: microphone access for dictation (#voice). The OS-level mic
 *   prompt still applies on macOS — this only governs the in-app Chromium
 *   permission layer.
 * - `clipboard-sanitized-write`: `navigator.clipboard.writeText()`, used
 *   throughout the renderer (copy-as-markdown, copy path, copy citation,
 *   pairing code, …). Without this grant Chromium denies it outright —
 *   `writeText()` rejects with `NotAllowedError: Write permission denied`
 *   on every call, indistinguishable from the button doing nothing at all
 *   (found via #2068 report investigation: "Copy as Markdown doesn't
 *   appear to do anything" — verified empirically against a packaged
 *   build, not caught by any test because vitest/jsdom's clipboard mock
 *   always "succeeds").
 */
export function installPermissions(): void {
  const ownOrigin = (url: string | undefined): boolean =>
    !!url && isOwnOrigin(url, MAIN_WINDOW_VITE_DEV_SERVER_URL);

  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (OWN_ORIGIN_PERMISSIONS.has(permission) && ownOrigin(wc?.getURL())) {
      callback(true);
      return;
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return OWN_ORIGIN_PERMISSIONS.has(permission) && ownOrigin(requestingOrigin);
  });

  installDisplayMediaHandler(session.defaultSession);
}

/**
 * `getDisplayMedia` for meeting recordings (#2731): system audio, as loopback.
 *
 * The renderer asks for audio plus a token 4×4 video track (a 0×0 one comes
 * back silent on Electron 40+), stops the video at once, and mixes the audio
 * with the mic. On macOS 14.2+ Chromium captures the audio through Apple's
 * CoreAudio process tap, gated by the "System Audio Recording" permission
 * and the `NSAudioCaptureUsageDescription` Info.plist string.
 *
 * Granted only to a top frame showing the renderer's own page — the same
 * test the navigation guard (#2552) and IPC sender guard (#2553) apply — and
 * only when audio was asked for. Anything else gets `null`, which rejects
 * `getDisplayMedia` with an AbortError. Every other session denies it
 * outright (`denyAllPermissions`).
 */
export function installDisplayMediaHandler(sess: Session): void {
  sess.setDisplayMediaRequestHandler((request, callback) => {
    const frame = request.frame;
    const trusted = !!frame && frame.parent === null
      && isRendererEntry(frame.url, rendererEntryUrl(), MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (!trusted || !request.audioRequested) {
      callback(null as unknown as Electron.Streams);
      return;
    }
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(
      (sources) => {
        const screen = sources[0];
        if (!screen) callback(null as unknown as Electron.Streams);
        else callback({ video: screen, audio: 'loopback' });
      },
      () => callback(null as unknown as Electron.Streams),
    );
  });
}

// ── Deny by default (#2559) ────────────────────────────────────────────────

/** webContents whose top-level navigation is decided by their own guard. */
const navigationOptIn = new WeakSet<WebContents>();

/** What the webContents of an opted-in session may do. */
interface SessionBrowsingPolicy {
  /** The partition string, so a popup is pinned to the same session. */
  partition: string;
}

/** Sessions whose pages may browse https (the privileged-site login partition). */
const httpsBrowsingSessions = new WeakMap<Session, SessionBrowsingPolicy>();

function isHttps(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === 'https:';
}

/** Deny every permission request and check — the default for every session
 *  but the app's own (`installPermissions` narrows that one). */
export function denyAllPermissions(sess: Session): void {
  sess.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  sess.setPermissionCheckHandler(() => false);
  // getDisplayMedia goes through its own handler, not the permission ones (#2731).
  sess.setDisplayMediaRequestHandler((_request, callback) => callback(null as unknown as Electron.Streams));
}

/**
 * The guards every webContents gets at creation. With no opt-in it can't open
 * a window, navigate, or attach a `<webview>`. A webContents in a session
 * `allowHttpsBrowsing` registered may navigate to https and open https popups
 * in the same partition (OAuth sign-in flows need both); nothing else.
 */
export function applyDefaultWebContentsGuards(wc: WebContents): void {
  const browsing = httpsBrowsingSessions.get(wc.session);

  wc.setWindowOpenHandler(({ url }) => {
    if (browsing && isHttps(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: { ...HARDENED_WEB_PREFERENCES, partition: browsing.partition },
        },
      };
    }
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    if (navigationOptIn.has(wc)) return; // its own guard decides
    if (browsing && isHttps(url)) return;
    event.preventDefault();
  });

  wc.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

/**
 * Let pages in `partition`'s session browse https — top-level navigation and
 * same-partition popups — and nothing else. Its permissions stay denied. Call
 * before creating a window in that partition.
 */
export function allowHttpsBrowsing(partition: string): Session {
  const sess = session.fromPartition(partition);
  httpsBrowsingSessions.set(sess, { partition });
  return sess;
}

/**
 * Hook every webContents and session Electron creates. Call once, at startup,
 * before any window exists. The default session's `session-created` (if it
 * fires after this) gets deny-all too; `installPermissions` replaces that with
 * the app's narrow allowlist once the app is ready.
 */
export function installGlobalWebContentsGuards(): void {
  app.on('web-contents-created', (_event, wc) => applyDefaultWebContentsGuards(wc));
  app.on('session-created', (sess) => denyAllPermissions(sess));
}

/**
 * Install the per-WebContents navigation guards. Called once per window
 * from window-manager.createWindow, after the BrowserWindow is built.
 * `entryUrl` is the URL the window loads its renderer from — the only
 * file:// page it may ever navigate to (#2552).
 */
export function installNavigationGuards(webContents: WebContents, entryUrl: string): void {
  // Replaces the default-deny window-open handler, and tells the default
  // will-navigate guard to stand down: the listener below decides.
  navigationOptIn.add(webContents);
  webContents.setWindowOpenHandler(({ url }) => {
    const route = externalNavTarget(url);
    if (route.kind === 'external') {
      // Fire-and-forget; we don't await on a click handler.
      void shell.openExternal(route.url);
    }
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (isRendererEntry(url, entryUrl, MAIN_WINDOW_VITE_DEV_SERVER_URL)) return;
    event.preventDefault();
    const route = externalNavTarget(url);
    if (route.kind === 'external') {
      void shell.openExternal(route.url);
    }
  });
}
