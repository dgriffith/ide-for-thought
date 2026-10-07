/**
 * A map pin that shows its object type's icon (#2711): MapLibre's own
 * teardrop, in the type's colour, with the icon (an emoji or glyph string —
 * what `TypeIcon.svelte` renders as text) in a light disc in its head. A type
 * with no icon keeps MapLibre's stock pin; this is only for the ones that have
 * one.
 *
 * The geometry is the stock marker's, path for path (MapLibre's
 * `src/ui/marker.ts`), scaled up by `EMOJI_PIN_SCALE` so an emoji in the head
 * is legible. Keeping the same 27×41 viewBox means the live map and the
 * export (`map-export.ts`) treat both kinds of pin alike: the tip sits at
 * `PIN_TIP_Y` of 41 in either.
 */

/** MapLibre's stock marker: viewBox size, default colour, and where its tip
 *  lands. The stock marker is centre-anchored and nudged up 14px, so the
 *  coordinate sits at 41/2 + 14 = 34.5 down the 41-unit viewBox. */
export const PIN_VIEW_W = 27;
export const PIN_VIEW_H = 41;
export const PIN_TIP_Y = 34.5;
export const STOCK_PIN_COLOR = '#3FB1CE';

/** How much bigger than the stock pin an icon pin is drawn — enough for a
 *  ~15px emoji in a ~24px disc, still pin-sized at every zoom. */
export const EMOJI_PIN_SCALE = 1.25;
export const EMOJI_PIN_WIDTH = PIN_VIEW_W * EMOJI_PIN_SCALE;
export const EMOJI_PIN_HEIGHT = PIN_VIEW_H * EMOJI_PIN_SCALE;

/** The light disc in the head, and the icon in it, in viewBox units. */
export const PIN_DISC_CX = 13.5;
export const PIN_DISC_CY = 13.5;
const DISC_R = 9.75;
export const PIN_ICON_SIZE = 13;
/** A colour emoji font first, wherever the platform keeps one. */
export const PIN_ICON_FONT_FAMILY = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
/** Monochrome glyphs (◆, ★) take this; colour emoji ignore it. */
export const GLYPH_FILL = '#2b2b2b';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHADOW_RADII: Array<[string, string]> = [
  ['10.5', '5.25002273'], ['10.5', '5.25002273'], ['9.5', '4.77275007'], ['8.5', '4.29549936'],
  ['7.5', '3.81822308'], ['6.5', '3.34094679'], ['5.5', '2.86367051'], ['4.5', '2.38636864'],
];
const FILL_PATH = 'M27,13.5 C27,19.074644 20.250001,27.000002 14.75,34.500002 C14.016665,35.500004 12.983335,35.500004 12.25,34.500002 C6.7499993,27.000002 0,19.222562 0,13.5 C0,6.0441559 6.0441559,0 13.5,0 C20.955844,0 27,6.0441559 27,13.5 Z';
const BORDER_PATH = 'M13.5,0 C6.0441559,0 0,6.0441559 0,13.5 C0,19.222562 6.7499993,27 12.25,34.5 C13,35.522727 14.016664,35.500004 14.75,34.5 C20.250001,27 27,19.074644 27,13.5 C27,6.0441559 20.955844,0 13.5,0 Z M13.5,1 C20.415404,1 26,6.584596 26,13.5 C26,15.898657 24.495584,19.181431 22.220703,22.738281 C19.945823,26.295132 16.705119,30.142167 13.943359,33.908203 C13.743445,34.180814 13.612715,34.322738 13.5,34.441406 C13.387285,34.322738 13.256555,34.180814 13.056641,33.908203 C10.284481,30.127985 7.4148684,26.314159 5.015625,22.773438 C2.6163816,19.232715 1,15.953538 1,13.5 C1,6.584596 6.584596,1 13.5,1 Z';

const escXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The pin as SVG markup, without its icon. `head`:
 * - `disc` — the light disc an icon sits in (the live pin adds the icon as
 *   SVG `<text>`; the export draws it onto the canvas itself);
 * - `plain` — the stock pin's small white dot: what an export draws when the
 *   icon can't be rendered, so a pin is never left blank.
 */
export function pinSvgMarkup(color: string, head: 'plain' | 'disc'): string {
  const shadow = `<g transform="translate(3.0, 29.0)" fill="#000000">${SHADOW_RADII.map(([rx, ry]) => `<ellipse opacity="0.04" cx="10.5" cy="5.80029008" rx="${rx}" ry="${ry}"/>`).join('')}</g>`;
  const body = `<g fill="${escXml(color)}"><path d="${FILL_PATH}"/></g><g opacity="0.25" fill="#000000"><path d="${BORDER_PATH}"/></g>`;
  const dot = head === 'plain'
    ? '<g transform="translate(8.0, 8.0)"><circle fill="#000000" opacity="0.25" cx="5.5" cy="5.5" r="5.4999962"/><circle fill="#FFFFFF" cx="5.5" cy="5.5" r="5.4999962"/></g>'
    : `<circle fill="#000000" opacity="0.25" cx="${PIN_DISC_CX}" cy="${PIN_DISC_CY}" r="${DISC_R + 0.5}"/><circle fill="#FFFFFF" cx="${PIN_DISC_CX}" cy="${PIN_DISC_CY}" r="${DISC_R}"/>`;
  return `<svg xmlns="${SVG_NS}" display="block" width="${EMOJI_PIN_WIDTH}px" height="${EMOJI_PIN_HEIGHT}px" viewBox="0 0 ${PIN_VIEW_W} ${PIN_VIEW_H}"><g fill-rule="nonzero">${shadow}${body}${dot}</g></svg>`;
}

/**
 * The live marker element for an instance whose type has an icon. Placed with
 * `anchor: 'bottom'` and `EMOJI_PIN_OFFSET`, which puts its tip exactly where
 * the stock pin's lands. The accessible name is the instance's title; the
 * icon is decoration (`aria-hidden`). `data-pin-icon` / `data-pin-color` let
 * the export redraw it. The icon comes from a type definition, which can
 * travel with a shared thoughtbase, so it goes in as a text node, never markup.
 */
export function createEmojiPinElement(icon: string, color: string | undefined, label: string): HTMLElement {
  const fill = color || STOCK_PIN_COLOR;
  const el = document.createElement('div');
  el.className = 'minerva-emoji-pin';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.dataset.pinIcon = icon;
  el.dataset.pinColor = fill;
  el.style.width = `${EMOJI_PIN_WIDTH}px`;
  el.style.height = `${EMOJI_PIN_HEIGHT}px`;
  el.innerHTML = pinSvgMarkup(fill, 'disc');
  const text = document.createElementNS(SVG_NS, 'text');
  const attrs: Record<string, string> = {
    'aria-hidden': 'true', class: 'minerva-pin-icon', x: String(PIN_DISC_CX), y: String(PIN_DISC_CY),
    'font-size': String(PIN_ICON_SIZE), 'text-anchor': 'middle', 'dominant-baseline': 'central',
    fill: GLYPH_FILL, 'font-family': PIN_ICON_FONT_FAMILY,
  };
  for (const [k, v] of Object.entries(attrs)) text.setAttribute(k, v);
  text.textContent = icon;
  el.querySelector('svg')!.appendChild(text);
  return el;
}

/** Bottom-anchored, the element's bottom edge would be the coordinate; the
 *  tip is `PIN_VIEW_H - PIN_TIP_Y` units above it, so shift the pin down by
 *  that much. */
export const EMOJI_PIN_OFFSET: [number, number] = [0, (PIN_VIEW_H - PIN_TIP_Y) * EMOJI_PIN_SCALE];
