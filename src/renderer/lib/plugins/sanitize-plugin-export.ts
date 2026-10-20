/**
 * A plugin's export HTML, made safe to put in an export (#2828, decision D4).
 *
 * A plugin drawing a layout answers an export with its view as static HTML
 * (`view.provideExport`). That is plugin-authored markup, and it is mounted in
 * the app's own renderer — off-screen, while the export snapshots it — before
 * it lands in a published page. Stricter than `sanitizeNoteHtml`, which trusts
 * images carrying the app's own mark (a plugin could forge one):
 *
 * - **Static only.** No script, handler, form, control, frame or embed — and no
 *   `<style>`: the snapshot keeps the app's own stylesheet rules, and a plugin
 *   styles its export inline.
 * - **No URL at all.** No `src`, `srcset`, `href` (but a fragment), `action`,
 *   `poster`; no `url(…)` or `image-set(…)` in a style. Loading any of them
 *   while mounted would be a request from the app — the network a plugin's
 *   `connect-src 'none'` exists to refuse — and in a published page, a beacon.
 * - **Links to notes** stay possible the way the app's own views make them:
 *   `data-note-path`, which the snapshot turns into a link main resolves
 *   under the export's link policy. Every other `data-*` goes.
 */
import DOMPurify from 'dompurify';

const FORBID_TAGS = [
  'style', 'link', 'meta', 'base', 'script', 'noscript', 'template',
  'img', 'picture', 'source', 'video', 'audio', 'track', 'iframe', 'frame', 'object', 'embed',
  'form', 'input', 'button', 'select', 'option', 'textarea',
  'image', 'use', 'foreignObject', 'animate', 'set',
];
const FORBID_ATTR = ['src', 'srcset', 'action', 'formaction', 'poster', 'background', 'ping', 'xlink:href'];
const CSS_URL = /(?:url|image-set|image|cross-fade|element)\s*\(/i;

function clean(node: Element): void {
  const href = node.getAttribute?.('href');
  if (href !== null && href !== undefined && !href.startsWith('#')) node.removeAttribute('href');
  const style = node.getAttribute?.('style');
  if (style && (CSS_URL.test(style) || /expression\s*\(|@import|behavior\s*:/i.test(style))) {
    // Drop each declaration that loads something; keep the rest.
    const kept = style.split(';').filter((d) => d.trim() && !CSS_URL.test(d) && !/expression\s*\(|@import|behavior\s*:/i.test(d));
    if (kept.length > 0) node.setAttribute('style', kept.join(';'));
    else node.removeAttribute('style');
  }
  for (const attr of [...(node.attributes ?? [])]) {
    if (attr.name.startsWith('data-') && attr.name !== 'data-note-path') node.removeAttribute(attr.name);
  }
}

/** Sanitize a plugin's export HTML (see the header). */
export function sanitizePluginExportHtml(html: string): string {
  if (!html) return '';
  // Hooks are global on the shared instance: add ours around the one call.
  DOMPurify.addHook('afterSanitizeAttributes', clean);
  try {
    return DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR, ALLOW_DATA_ATTR: true });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}
