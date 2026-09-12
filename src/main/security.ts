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
 *    allowed only to the app's own origin (file:// in prod, the Vite
 *    dev server in dev); http(s) requests get diverted to the OS browser.
 *
 * Pure logic lives in security-helpers.ts so tests can exercise the
 * CSP string and routing decisions without pulling in `electron`.
 */

import { session, shell, type WebContents } from 'electron';
import { buildCsp, externalNavTarget, isOwnOrigin } from './security-helpers';

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
} as const;

/** Install the CSP for every response served to the default session. */
export function installCsp(): void {
  const csp = buildCsp({ devServerOrigin: MAIN_WINDOW_VITE_DEV_SERVER_URL });
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
}

/**
 * Install the per-WebContents navigation guards. Called once per window
 * from window-manager.createWindow, after the BrowserWindow is built.
 */
export function installNavigationGuards(webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url }) => {
    const route = externalNavTarget(url);
    if (route.kind === 'external') {
      // Fire-and-forget; we don't await on a click handler.
      void shell.openExternal(route.url);
    }
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (isOwnOrigin(url, MAIN_WINDOW_VITE_DEV_SERVER_URL)) return;
    event.preventDefault();
    const route = externalNavTarget(url);
    if (route.kind === 'external') {
      void shell.openExternal(route.url);
    }
  });
}
