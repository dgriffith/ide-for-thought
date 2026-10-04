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
  // No package CDNs (#2564). jsdelivr / unpkg used to be here for tesseract.js
  // (worker + core) and transformers.js's onnxruntime-web WASM; all three ship
  // in the bundle now (run-ocr.ts, whisper.worker.ts). They were an exfil
  // channel for any renderer bug — anyone can publish to them — and code
  // loaded from them had no integrity check. Don't add one back: bundle it.
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
  // OpenFreeMap vector tile + style JSON fetches for the Objects Map view
  // (#2066). Free, no API key, commercial/bulk use explicitly permitted —
  // see docs/vision/objects-expansion.md's design-spike writeup (#2064).
  // The only CSP entry the map view needs: worker-src's existing 'blob:'
  // already covers MapLibre's internal workers, img-src's existing
  // wildcard 'https:' already covers any raster sprite a style references,
  // and style-src's existing 'unsafe-inline' already covers MapLibre's
  // inline-styled UI controls.
  'https://tiles.openfreemap.org',
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
    // No <object>/<embed>.
    'object-src': ["'none'"],
    // 'self' (not 'none') so the HTML-file preview (#1535) can embed its
    // sandboxed `srcdoc` iframe — same-document content, not a navigation to
    // an external origin. The iframe's OWN document is locked down
    // separately, by its `sandbox` attribute (no allow-same-origin) and a
    // `csp` attribute the embedder imposes on it (see HtmlPreview.svelte) —
    // this directive only gates whether the *frame itself* may exist here.
    'frame-src': ["'self'"],
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

/** Parse `url`, or null when it isn't one. */
function parseUrl(url: string): URL | null {
  return URL.canParse(url) ? new URL(url) : null;
}

/** True when `url` is on the Vite dev server's exact origin. An origin
 *  comparison, not a prefix match: `http://localhost:5173.evil.example`
 *  starts with `http://localhost:5173`. */
function isDevServerOrigin(url: string, devServerOrigin: string | undefined): boolean {
  if (!devServerOrigin) return false;
  const u = parseUrl(url);
  const dev = parseUrl(devServerOrigin);
  return !!u && !!dev && u.origin === dev.origin;
}

/** True when `url` is the app's own origin (file:// in prod, the Vite
 *  dev server in dev). Used for the Chromium permission grants, whose
 *  requesting origin for any file:// page is just `file:///`. It is NOT a
 *  navigation allowlist — see `isRendererEntry` (#2552). */
export function isOwnOrigin(url: string, devServerOrigin?: string): boolean {
  if (url.startsWith('file://')) return true;
  return isDevServerOrigin(url, devServerOrigin);
}

/**
 * True when a top-level navigation to `url` stays on the renderer itself:
 * the exact `index.html` the window was loaded from (`entryUrl`, ignoring
 * query and hash), or — under `pnpm dev` — the Vite dev server's origin.
 *
 * Every other file:// URL is refused (#2552). CSP `script-src 'self'` on a
 * file:// page admits any file:// script on disk and the preload runs on
 * whatever page the window lands on, so "any file://" as own origin meant a
 * clicked link to an attacker's `.html` (a shared thoughtbase on a mounted
 * volume) got the full `window.api`.
 */
export function isRendererEntry(url: string, entryUrl: string, devServerOrigin?: string): boolean {
  if (isDevServerOrigin(url, devServerOrigin)) return true;
  const u = parseUrl(url);
  const entry = parseUrl(entryUrl);
  if (!u || !entry || u.protocol !== 'file:' || entry.protocol !== 'file:') return false;
  return u.host === entry.host && u.pathname === entry.pathname;
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
