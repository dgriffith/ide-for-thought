/**
 * DOMPurify sanitiser for note-preview HTML (#1327 / M2 + #1332 / L4).
 *
 * The note preview renders untrusted markdown with `html: true` and injects
 * the result with `{@html}` (Preview.svelte). Historically the ONLY defence
 * was CSP (no `unsafe-inline` in `script-src`). This adds an explicit
 * DOMPurify pass as defence-in-depth so a future CSP regression, a
 * Chromium CSP bypass, or a subtle markup trick can't turn stored note HTML
 * into renderer XSS — which in Electron borders on RCE via the IPC surface.
 *
 * FORBID-based config (mirrors `compute-output-sanitize.ts`): the default
 * allowlist (HTML + SVG + MathML, keeping `class` / `style` / `data-*`)
 * preserves the app's rich output untouched — KaTeX math (inline
 * `style`-positioned spans + MathML), mermaid / vega / query placeholders,
 * wiki / cite / quote links (`data-*`), callouts, footnotes, task-list
 * checkboxes, tables — while `<script>` / `<iframe>` / `<object>` /
 * `<embed>` / `<form>` and inline `on*` handlers are stripped. Using
 * `FORBID_*` over an `USE_PROFILES` allowlist is deliberate: enumerating
 * every tag/attr the rich pipeline emits (all of KaTeX's MathML, SVG, the
 * custom `data-*` vocabulary) is brittle; forbidding the small dangerous set
 * is not. (See the note in `compute-output-sanitize.ts` on why the two
 * options don't combine cleanly.)
 *
 * L4 (privacy beacons): a raw-HTML `<img src="https://tracker">` or CSS
 * `background:url(https://…)` embedded directly in note markup phones home
 * on open, leaking "note opened" + IP/User-Agent to a third party. The
 * `afterSanitizeAttributes` hook neutralises exactly those two remote-fetch
 * vectors WITHOUT breaking the app's own image feature: markdown `![](url)`
 * images are emitted by the preview's image rule with a recognisable marker
 * (`class="remote-image"` + `data-remote-src`, `local-image`, or a
 * `youtube-thumb`), so they're left intact — only *unmarked* raw `<img>`
 * (which never came through the image rule) has its remote `src`/`srcset`
 * dropped. The full opt-in "block ALL remote content" mode (including
 * markdown remote images) is a separate policy feature, tracked apart.
 */

import DOMPurify from 'dompurify';

const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'form'];

// KaTeX emits its accessibility MathML wrapped in `<semantics>` with the
// original TeX in `<annotation encoding="application/x-tex">`. DOMPurify's
// default MathML profile keeps `<math>/<mrow>/<msup>/…` but drops those two
// (and their `encoding` attr), which would leak the TeX source as stray text
// in the visually-hidden `.katex-mathml` node. Both are inert MathML markup —
// re-allow them so the math accessibility tree survives whole.
const ADD_TAGS = ['semantics', 'annotation'];
const ADD_ATTR = ['encoding'];

const FORBID_ATTR = [
  'onerror',
  'onload',
  'onclick',
  'onmouseover',
  'onmouseout',
  'onfocus',
  'onblur',
  'onkeydown',
  'onkeyup',
  'onkeypress',
  'onsubmit',
  'oninput',
  'onchange',
  'onanimationstart',
  'onanimationend',
  'onpointerover',
];

// App-generated `<img>` (from the preview image rule / youtube fence) carries
// one of these markers; a raw-HTML `<img>` beacon carries none, so the
// remote-content strip below keys on their absence.
const APP_IMAGE_CLASS = /\b(?:remote-image|local-image|youtube-thumb)\b/;
// Remote (http/https) or protocol-relative (`//host/…`). data:/blob:/local
// srcs are untouched.
const REMOTE_SRC = /^(?:https?:)?\/\//i;
// A CSS `url(…)` whose target is remote/protocol-relative — quoted or not.
// Leaves `url(data:…)`, `url(blob:…)`, `url(#localref)` alone.
const REMOTE_CSS_URL = /url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi;

/**
 * Post-attribute hook (runs per element). Strips the two L4 beacon vectors:
 * remote `url(…)` in inline styles (any element) and remote `src`/`srcset`
 * on unmarked raw `<img>`.
 */
function neutraliseBeacons(node: Element): void {
  const style = node.getAttribute?.('style');
  if (style && REMOTE_CSS_URL.test(style)) {
    // Global regex — reset lastIndex from the .test() above before replacing.
    REMOTE_CSS_URL.lastIndex = 0;
    const cleaned = style.replace(REMOTE_CSS_URL, '').trim();
    if (cleaned) node.setAttribute('style', cleaned);
    else node.removeAttribute('style');
  }
  REMOTE_CSS_URL.lastIndex = 0;

  if (node.nodeName !== 'IMG') return;
  const cls = node.getAttribute('class') ?? '';
  const isAppImage =
    node.hasAttribute('data-remote-src') ||
    node.hasAttribute('data-rel') ||
    APP_IMAGE_CLASS.test(cls);
  if (isAppImage) return;
  // Unmarked raw <img>: drop remote src + any srcset so it can't phone home.
  if (REMOTE_SRC.test(node.getAttribute('src') ?? '')) node.removeAttribute('src');
  if (node.hasAttribute('srcset')) node.removeAttribute('srcset');
}

/**
 * Sanitise note-preview HTML for injection via `{@html}`. Preserves the full
 * rich-markdown surface; strips scripting vectors + remote privacy beacons.
 * Empty/falsy input is returned unchanged.
 */
export function sanitizeNoteHtml(html: string): string {
  if (!html) return html;
  // Hooks are process-global on the shared DOMPurify instance, so add and
  // remove ours around the synchronous sanitise call (no `await` between —
  // the renderer is single-threaded, so no other sanitise can interleave).
  DOMPurify.addHook('afterSanitizeAttributes', neutraliseBeacons);
  try {
    return DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR, ADD_TAGS, ADD_ATTR });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}
