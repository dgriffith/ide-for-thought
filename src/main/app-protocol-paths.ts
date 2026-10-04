/**
 * Pure half of the `app://` renderer protocol (#2564): which file a request
 * maps to, and what type it is served as. Kept free of `electron` so it can
 * be tested directly; `app-protocol.ts` does the registration.
 */
import path from 'node:path';

/** The renderer's own origin. `'self'` in its CSP means exactly this. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'minerva';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/**
 * The absolute file an `app://` request names, or null if it names nothing
 * the renderer bundle holds: another host, a path that resolves outside
 * `rendererRoot` (`..`, encoded `%2e%2e`, a backslash), or a malformed URL.
 * `/` serves `index.html`. Query and hash are ignored.
 */
export function resolveAppRequest(requestUrl: string, rendererRoot: string): string | null {
  if (!URL.canParse(requestUrl)) return null;
  const url = new URL(requestUrl);
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch (e) {
    if (e instanceof URIError) return null; // malformed %-escape
    throw e;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  if (rel === '/' || rel === '') rel = '/index.html';
  const root = path.resolve(rendererRoot);
  const abs = path.resolve(root, `.${rel}`);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  // `application/wasm` is what lets WebAssembly.instantiateStreaming compile
  // while downloading; anything else makes ORT / tesseract fall back or fail.
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

/** The Content-Type to serve `file` with. Unknown types are opaque bytes. */
export function appMimeType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}
