/**
 * Pure helpers for security.ts — kept in their own module so tests can
 * exercise them without pulling in `electron`'s `session`/`shell`/`app`.
 */

export interface CspOptions {
  /** When set, dev-mode loosenings (Vite origin + ws) are added. */
  devServerOrigin?: string;
}

/** Hosts the renderer is permitted to fetch directly. Main-process API
 *  adapters (Crossref, arXiv, PubMed, Anthropic) talk to their endpoints
 *  in main, so renderer connect-src stays narrow. */
export const RENDERER_FETCH_HOSTS = [
  // tesseract.js core/wasm + worker glue. Keep both so a tesseract
  // upgrade that switches CDN doesn't break OCR silently.
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
];

export function buildCsp(opts: CspOptions = {}): string {
  const { devServerOrigin } = opts;
  const dev = Boolean(devServerOrigin);
  const devWs = devServerOrigin ? devServerOrigin.replace(/^https?:/, 'ws:') : '';

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'wasm-unsafe-eval' for tesseract.js's bundled wasm. In dev,
    // allow the Vite origin so the bootstrap script + HMR client load.
    'script-src': ["'self'", "'wasm-unsafe-eval'", ...(dev ? [devServerOrigin!] : [])],
    // Svelte component styles compile to inline-style attributes; KaTeX
    // also writes inline styles. 'unsafe-inline' for style-src is the
    // accepted compromise — it doesn't apply to script-src.
    'style-src': ["'self'", "'unsafe-inline'"],
    // KaTeX bundles fonts as data URIs.
    'font-src': ["'self'", 'data:'],
    // User notes can embed arbitrary <img src> over https/data; allow
    // those so quoted screenshots / reference images keep rendering.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    // Renderer-direct fetches: tesseract.js core, plus Vite HMR ws in dev.
    'connect-src': [
      "'self'",
      ...RENDERER_FETCH_HOSTS,
      ...(dev ? [devServerOrigin!, devWs] : []),
    ],
    // pdf.js + tesseract spawn workers from blob URLs.
    'worker-src': ["'self'", 'blob:'],
    // No <object>/<embed>; no <iframe> embed targets either.
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    // Defense in depth: prevent the renderer from being framed.
    'frame-ancestors': ["'none'"],
    // Anchor `<base href="…">` tag injection can't repoint relative URLs.
    'base-uri': ["'self'"],
    // Form posts to anywhere are nonsensical inside a desktop app.
    'form-action': ["'none'"],
  };

  return Object.entries(directives)
    .map(([k, vs]) => `${k} ${vs.join(' ')}`)
    .join('; ');
}

/** True when `url` is the app's own origin (file:// in prod, the Vite
 *  dev server in dev). */
export function isOwnOrigin(url: string, devServerOrigin?: string): boolean {
  if (url.startsWith('file://')) return true;
  if (devServerOrigin && url.startsWith(devServerOrigin)) return true;
  return false;
}

/** Whether a URL routed through setWindowOpenHandler / will-navigate
 *  should be deflected to the OS browser. Internal nav stays in the
 *  app; http(s) externals get shell.openExternal; everything else
 *  (file:, javascript:, data:, custom schemes) is dropped on the floor. */
export function externalNavTarget(url: string): { kind: 'external'; url: string } | { kind: 'drop' } {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { kind: 'external', url };
  }
  return { kind: 'drop' };
}
