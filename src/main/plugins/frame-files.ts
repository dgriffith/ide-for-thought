/**
 * What the `minerva-plugin:` protocol serves (#2824): the file a request
 * names inside the plugin's own folder, and the CSP it is served under.
 * Kept free of `electron` so it is tested directly; `plugin-protocol.ts`
 * does the registration.
 *
 * Only a plugin that is enabled AND declares the `ui` capability has a frame
 * root; every other id is a 404. Installed plugins can't declare `code` yet
 * (#2823, until #2833), and no built-in plugin ships view files yet, so in
 * the running app this serves nothing until kanban (#2828) brings the first.
 * Where a built-in plugin's files live inside the bundle is #2828's call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { hasIgnoredSegment } from '../../shared/ignored-dirs';
import { PLUGIN_FRAME_SANDBOX, pluginIdOfUrl } from '../../shared/plugins/frame';
import { getPluginScan } from './registry';

/** The folder plugin `id`'s frame is served from, or null if it has none. */
export type PluginFrameRootLookup = (id: string) => Promise<string | null>;

// The e2e harness serves a hostile fixture plugin through here (`e2e-hooks.ts`,
// MINERVA_E2E only): no installed plugin can declare `ui` yet, so there is no
// other way to get a real plugin frame in front of the real guards.
const e2eRoots = new Map<string, string>();

/** Serve `root` as plugin `id`'s frame — e2e only (`e2e-hooks.ts`). */
export function _servePluginFrameForE2E(id: string, root: string): void {
  e2eRoots.set(id, root);
}

/** The production lookup: an enabled plugin that declares `ui`. */
export const pluginFrameRoot: PluginFrameRootLookup = async (id) => {
  const e2e = e2eRoots.get(id);
  if (e2e) return e2e;
  const scan = await getPluginScan();
  const plugin = scan.plugins.find((p) => p.manifest.id === id);
  if (!plugin?.manifest.code?.capabilities.includes('ui')) return null;
  return plugin.root;
};

/**
 * The plugin and in-folder path a request names, or null: not our scheme, a
 * path that resolves outside the folder (`..`, encoded `%2e%2e`, a
 * backslash, NUL), a malformed escape, or a segment the walkers skip
 * (`.git/`, any dot-file, `node_modules/`). `/` serves `index.html`.
 */
export function parsePluginFrameRequest(requestUrl: string): { id: string; rel: string } | null {
  const id = pluginIdOfUrl(requestUrl);
  if (!id) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(new URL(requestUrl).pathname);
  } catch (e) {
    if (e instanceof URIError) return null;
    throw e;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  if (rel === '/' || rel === '') rel = '/index.html';
  const normal = path.posix.normalize(rel);
  if (!normal.startsWith('/') || normal.split('/').includes('..')) return null;
  const inFolder = normal.slice(1);
  if (inFolder === '' || hasIgnoredSegment(inFolder)) return null;
  return { id, rel: inFolder };
}

/**
 * The file to serve for `requestUrl`, or null for a 404. The containment
 * check is on REAL paths, so a link inside the folder that points out of it
 * is refused, the same rule the plugin check applies at install (#2632).
 */
export async function resolvePluginFrameFile(requestUrl: string, rootFor: PluginFrameRootLookup): Promise<string | null> {
  const req = parsePluginFrameRequest(requestUrl);
  if (!req) return null;
  const root = await rootFor(req.id);
  if (!root) return null;
  let realRoot: string;
  let real: string;
  try {
    realRoot = await fs.promises.realpath(root);
    real = await fs.promises.realpath(path.join(realRoot, ...req.rel.split('/')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code) return null; // missing, a loop, unreadable
    throw e;
  }
  if (!real.startsWith(realRoot + path.sep)) return null;
  const stat = await fs.promises.stat(real);
  return stat.isFile() ? real : null;
}

/**
 * The CSP every plugin frame response carries. Its own origin for scripts,
 * styles, images, fonts and workers; no network (`connect-src 'none'`), no
 * frames of its own, no plugins, forms or `<base>`. `frame-ancestors` names
 * the app, so nothing but Minerva's renderer can embed it.
 *
 * `sandbox` is the iframe attribute's flags, imposed by the response, so the
 * document is sandboxed however it was framed. That is what holds popups:
 * the main window's open handler sends http(s) popups to the OS browser
 * (ordinary `target="_blank"` links need it) and Electron tells it neither
 * the opening frame nor, reliably, a referrer — measured, an unsandboxed
 * plugin frame's `window.open` reached `shell.openExternal`.
 */
export function pluginFrameCsp(embedderOrigins: readonly string[]): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    // Frameworks and UI kits set inline styles; it doesn't apply to scripts.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'blob:'],
    'worker-src': ["'self'"],
    'connect-src': ["'none'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': [...embedderOrigins],
    sandbox: PLUGIN_FRAME_SANDBOX.split(' '),
  };
  return Object.entries(directives).map(([k, vs]) => `${k} ${vs.join(' ')}`).join('; ');
}
