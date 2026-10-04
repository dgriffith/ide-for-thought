/**
 * Document-wide renderer guard against top-level navigation (#2554).
 *
 * The window must never leave the renderer's own `index.html`: the preload
 * bridge runs on whatever page the window shows. Main refuses the navigation
 * (#2552) and refuses IPC from any other page (#2553); this is the third,
 * renderer-side layer, and the only one that stops the attempt before it
 * reaches main.
 *
 *  - **Clicks.** A capturing `click` / `auxclick` listener cancels the default
 *    action of any link whose target isn't `http(s):`, `mailto:` or a
 *    same-document `#fragment`. Only the default is cancelled — the preview's
 *    wiki-link / cite / DOI routes, and every other handler, still run. http(s)
 *    keeps its default, which main diverts to the OS browser.
 *  - **File drops.** A browser navigates to a file dropped where nothing
 *    accepts it. Electron doesn't by default, and main pins that
 *    (`navigateOnDragDrop: false` in `HARDENED_WEB_PREFERENCES`); this is
 *    the second layer. Bubbling `dragover` / `drop` listeners cancel a file
 *    drag that no inner handler has already accepted, so the editor pane,
 *    file tree and sidebar keep their own drop behaviour and everywhere else
 *    refuses the drop.
 */

/** URL schemes a link may navigate to by default. */
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Strip the fragment, for "same document?" comparison. */
function withoutHash(u: URL): string {
  return u.href.slice(0, u.href.length - u.hash.length);
}

/**
 * Whether a link whose raw `href` is `href`, on a document at `docUrl`, may
 * take the browser's default action. `null` (no href) has no default to stop.
 */
export function isAllowedLinkTarget(href: string | null, docUrl: string): boolean {
  if (href === null) return true;
  if (!URL.canParse(href, docUrl)) return false;
  const target = new URL(href, docUrl);
  const doc = new URL(docUrl);
  // A fragment of this very document scrolls in place.
  if (target.hash !== '' && withoutHash(target) === withoutHash(doc)) return true;
  // Anything else on the renderer's own origin is a navigation away from it:
  // another file:// page in a packaged build, another dev-server path (or a
  // relative href, which resolves there) under `pnpm dev`.
  if (target.protocol === doc.protocol && target.host === doc.host) return false;
  return ALLOWED_LINK_PROTOCOLS.has(target.protocol);
}

/** The nearest link (HTML `<a>`/`<area>` or SVG `<a>`) at or above the event target. */
function linkFor(e: Event): Element | null {
  const target = e.target;
  if (!(target instanceof Element)) return null;
  return target.closest('a, area');
}

function hrefOf(link: Element): string | null {
  return link.getAttribute('href') ?? link.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
}

function guardLinkClick(e: MouseEvent): void {
  const link = linkFor(e);
  if (!link) return;
  if (!isAllowedLinkTarget(hrefOf(link), document.URL)) e.preventDefault();
}

function carriesFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types?.includes('Files') ?? false;
}

function refuseUnhandledDragOver(e: DragEvent): void {
  if (e.defaultPrevented || !carriesFiles(e)) return;
  // Cancelling dragover with dropEffect 'none' shows the no-drop cursor and
  // means no `drop` fires here at all.
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
}

function refuseUnhandledDrop(e: DragEvent): void {
  if (!e.defaultPrevented) e.preventDefault();
}

/** Install the guards on `doc`. Returns an uninstaller (for tests). */
export function installNavigationGuard(doc: Document = document): () => void {
  doc.addEventListener('click', guardLinkClick, true);
  doc.addEventListener('auxclick', guardLinkClick, true);
  doc.addEventListener('dragover', refuseUnhandledDragOver);
  doc.addEventListener('drop', refuseUnhandledDrop);
  return () => {
    doc.removeEventListener('click', guardLinkClick, true);
    doc.removeEventListener('auxclick', guardLinkClick, true);
    doc.removeEventListener('dragover', refuseUnhandledDragOver);
    doc.removeEventListener('drop', refuseUnhandledDrop);
  };
}
