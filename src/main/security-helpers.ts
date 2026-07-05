/**
 * Pure helpers for security.ts — kept in their own module so tests can
 * exercise them without pulling in `electron`'s `session`/`shell`/`app`.
 */

export interface CspOptions {
  /** When set, dev-mode loosenings (Vite origin + ws) are added. */
  devServerOrigin?: string | undefined;
}

/** Hosts the renderer is permitted to fetch directly. Main-process API
 *  adapters (Crossref, arXiv, PubMed, Anthropic) talk to their endpoints
 *  in main, so renderer connect-src stays narrow. */
export const RENDERER_FETCH_HOSTS = [
  // tesseract.js core/wasm + worker glue, and transformers.js's
  // onnxruntime-web WASM. Keep both so a CDN switch in either doesn't
  // break OCR / voice silently.
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  // Local Whisper model weights for dictation (#voice) are fetched once
  // from the HF hub and then cached by the browser. The hub redirects the
  // actual file bytes to its LFS / Xet CDN, whose hostnames are regional and
  // drift (cdn-lfs.huggingface.co, us.aws.cdn.hf.co, cas-bridge.xethub.hf.co,
  // …) — so we allow the hub plus wildcard subdomains of its two CDN apexes
  // rather than chase individual hosts. CSP `*.hf.co` matches multi-level
  // subdomains like `us.aws.cdn.hf.co`. Only model weights traverse the
  // network — captured audio never leaves the renderer.
  'https://huggingface.co',
  'https://*.huggingface.co',
  'https://*.hf.co',
];

export function buildCsp(opts: CspOptions = {}): string {
  const { devServerOrigin } = opts;
  const dev = Boolean(devServerOrigin);
  const devWs = devServerOrigin ? devServerOrigin.replace(/^https?:/, 'ws:') : '';

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'wasm-unsafe-eval' for tesseract.js's bundled wasm. In dev,
    // allow the Vite origin so the bootstrap script + HMR client load.
    // 'blob:' so onnxruntime-web (the Whisper voice backend, #voice) can
    // load its WASM proxy glue, which it dynamically imports from a blob URL.
    'script-src': ["'self'", "'wasm-unsafe-eval'", 'blob:', ...(dev ? [devServerOrigin!] : [])],
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
    // Local audio/video (#908) is hydrated to `blob:` URLs from vault bytes —
    // local-only; no external media origins (no phone-home).
    'media-src': ["'self'", 'blob:'],
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
