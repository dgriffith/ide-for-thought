/**
 * The mark that tells the note sanitizer an `<img>` came from Minerva's own
 * markdown rules, not from raw HTML in the note (#2561).
 *
 * The sanitizer drops the remote `src` of an unmarked raw `<img>` (a tracking
 * beacon, #1332) but must leave the app's own remote images alone. It used to
 * recognise them by class (`remote-image`, `local-image`, `youtube-thumb`) or
 * a `data-rel` attribute — all of which a note can simply write. Now each
 * app-generated image carries `data-minerva-img` set to a random token made
 * once per page load. A note is static text written before the token existed,
 * so it can't carry the right value.
 */

export const APP_IMAGE_ATTR = 'data-minerva-img';

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const APP_IMAGE_TOKEN = randomToken();

/** The attribute to splice into an app-generated `<img …>` tag (leading space). */
export function appImageMark(): string {
  return ` ${APP_IMAGE_ATTR}="${APP_IMAGE_TOKEN}"`;
}

/** True when `node` carries this page load's app-image token. */
export function hasAppImageMark(node: Element): boolean {
  return node.getAttribute(APP_IMAGE_ATTR) === APP_IMAGE_TOKEN;
}
