/**
 * The origin a plugin's UI runs on (#2824, design `docs/plugin-code.md` →
 * *Views: a cross-origin frame*).
 *
 * Each plugin gets its own origin, `minerva-plugin://<id>/`, so Chromium's
 * site isolation puts its frame in its own process, apart from the app's
 * `app://minerva` and from every other plugin. A plugin id is already a valid
 * host (`PLUGIN_ID` in `main/plugins/manifest.ts`: lowercase letters, digits
 * and single hyphens), so the URL needs no escaping.
 *
 * Pure: main's protocol handler and guards, and the renderer's frame host,
 * both read it.
 */

import { THEME_TOKENS } from '../theme-tokens';

/** The scheme every plugin frame is served on. */
export const PLUGIN_SCHEME = 'minerva-plugin';

/** The origin plugin `id`'s frame runs on. */
export function pluginFrameOrigin(id: string): string {
  return `${PLUGIN_SCHEME}://${id}`;
}

/** The plugin id a `minerva-plugin:` URL or origin names, or null for anything else. */
export function pluginIdOfUrl(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const u = new URL(url);
  if (u.protocol !== `${PLUGIN_SCHEME}:` || !u.host) return null;
  return u.host;
}

/** Whether `url` (or an origin) is on a plugin frame's scheme. */
export function isPluginFrameUrl(url: string): boolean {
  return pluginIdOfUrl(url) !== null;
}

/**
 * The `sandbox` attribute every plugin `<iframe>` carries. Scripts run, and
 * `allow-same-origin` keeps the frame on the plugin's own origin rather than an
 * opaque one (its origin is never the app's, so this grants nothing of
 * Minerva's). Everything left out is refused by Chromium before main hears of
 * it: popups, top-level navigation, forms, modals, downloads, pointer lock.
 * Main imposes the same flags again, as the `sandbox` directive of every
 * plugin response's CSP (`main/plugins/frame-files.ts`), so a host that
 * forgot the attribute would still be held.
 */
export const PLUGIN_FRAME_SANDBOX = 'allow-scripts allow-same-origin';

/**
 * The custom properties a plugin frame is given (#2827): every colour token a
 * theme sets, plus the font families. The families name the app's bundled web
 * fonts first; those live on `app://`, which a plugin frame's `font-src 'self'`
 * can't load, so a frame falls through the same list to the system fonts.
 */
export const PLUGIN_THEME_TOKENS: readonly string[] = [...THEME_TOKENS, '--font-sans', '--font-display', '--font-mono'];

/** The channel main posts a worker host its session port on (#2830), and the window message its preload forwards it as. */
export const WORKER_HOST_PORT_CHANNEL = 'minerva.worker-host-port';
export const WORKER_HOST_PORT_MESSAGE = 'minerva.worker-host-port';
