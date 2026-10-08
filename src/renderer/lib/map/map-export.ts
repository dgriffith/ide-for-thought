/**
 * A Typed-Objects map captured for an export (#2511, epic #2508): the
 * preview's own map (`TypeViewMap` — same markers, same `fitBounds` framing)
 * rendered once at a fixed size in the light style, flattened into one PNG
 * with its pins baked in, so an exported page needs no MapLibre, no network
 * and no script to show it. If the map can't be drawn, the export gets the
 * places as a table instead — never a blank box.
 */

import { EMOJI_PIN_HEIGHT, GLYPH_FILL, EMOJI_PIN_SCALE, EMOJI_PIN_WIDTH, PIN_DISC_CY, PIN_ICON_FONT_FAMILY, PIN_ICON_SIZE, PIN_TIP_Y, PIN_VIEW_H, PIN_VIEW_W, STOCK_PIN_COLOR, pinSvgMarkup } from './emoji-pin';

/** A located instance: what a marker shows, and what the fallback lists. */
export interface MapPlace {
  path: string;
  title: string;
  lat: number;
  lng: number;
}

export type MapCapture =
  | { ok: true; image: string; width: number; height: number; attribution: string; places: MapPlace[] }
  | { ok: false; reason: string; places: MapPlace[] };

/** Passed to `TypeViewMap` to render it for export instead of interactively. */
export interface MapExportHooks {
  onCaptured: (capture: MapCapture) => void;
}

/** The export frame's width, in CSS pixels — the export block's. Its height is
 *  the embed's own (`height` in the spec, #2666). Rendered at 2× for a sharp
 *  image on screen and in PDF. */
export const MAP_EXPORT_WIDTH = 760;
export const MAP_EXPORT_PIXEL_RATIO = 2;
/** Style + every tile must be in by now, or the export lists the places. */
export const MAP_EXPORT_TIMEOUT_MS = 20_000;
/** After a tile/style error, how long to let the map settle before falling
 *  back — so an export made offline lists its places in seconds, not after
 *  the full timeout (MapLibre may never go idle once a tile has failed). */
export const MAP_EXPORT_ERROR_GRACE_MS = 3_000;
/** Shown in place of the map; the raw network error means nothing to a reader. */
export const MAP_TILES_FAILED = 'the map tiles could not be loaded — check your connection';

/** Parse a "<lat>,<lng>" geo value; null for missing/malformed (omitted, not
 *  errored — #2066). Shared by the live map and the export fallback. */
export function parseLatLng(value: string | null | undefined): [number, number] | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 2) return null;
  const [lat, lng] = parts;
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

/** The tile/data providers' attribution, as plain text — required wherever
 *  their tiles appear, an export included. Deduplicated, in source order. */
export function attributionText(style: { sources?: Record<string, unknown> } | null | undefined): string {
  const seen: string[] = [];
  for (const src of Object.values(style?.sources ?? {})) {
    const raw = (src as { attribution?: unknown }).attribution;
    if (typeof raw !== 'string') continue;
    const text = decodeEntities(raw.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (text && !seen.includes(text)) seen.push(text);
  }
  return seen.join(' · ');
}

function decodeEntities(s: string): string {
  return s.replace(/&copy;/g, '©').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

/** What compositing needs from a marker: its element (an SVG pin) and where
 *  its coordinate sits on the map, in CSS pixels. */
export interface PinToDraw {
  element: HTMLElement;
  point: { x: number; y: number };
}

/**
 * Flatten the map canvas plus its pins into one PNG data URL, each pin with
 * its tip on the projected coordinate. A stock pin is the marker's own SVG
 * (so its colour matches the preview). An icon pin (#2711) is redrawn from
 * its `data-pin-*`: the teardrop and disc as SVG, then the icon with canvas
 * `fillText` — Chromium draws colour emoji there, at the output's own scale,
 * and a glyph that didn't draw can be detected (`iconDrawable`). When the icon
 * can't be drawn, the pin is the plain coloured one — never a blank head.
 */
export async function compositeMap(canvas: HTMLCanvasElement, pins: PinToDraw[], cssWidth: number, cssHeight: number): Promise<string> {
  const scale = canvas.width / cssWidth;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = Math.round(cssHeight * scale);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas available to compose the map');
  ctx.drawImage(canvas, 0, 0);
  for (const pin of pins) {
    const icon = pin.element.dataset.pinIcon;
    if (icon) {
      const w = EMOJI_PIN_WIDTH;
      const h = EMOJI_PIN_HEIGHT;
      const left = pin.point.x - w / 2;
      const top = pin.point.y - h * (PIN_TIP_Y / PIN_VIEW_H);
      const fontPx = PIN_ICON_SIZE * EMOJI_PIN_SCALE * scale;
      const drawable = iconDrawable(icon, fontPx);
      const img = await loadSvgMarkup(pinSvgMarkup(pin.element.dataset.pinColor || STOCK_PIN_COLOR, drawable ? 'disc' : 'plain'));
      ctx.drawImage(img, left * scale, top * scale, w * scale, h * scale);
      if (drawable) {
        ctx.font = `${fontPx}px ${PIN_ICON_FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = GLYPH_FILL;
        ctx.fillText(icon, pin.point.x * scale, (top + h * (PIN_DISC_CY / PIN_VIEW_H)) * scale);
      }
      continue;
    }
    const svg = pin.element.querySelector('svg');
    if (!svg) continue;
    const w = parseFloat(svg.getAttribute('width') ?? '') || PIN_VIEW_W;
    const h = parseFloat(svg.getAttribute('height') ?? '') || PIN_VIEW_H;
    const img = await loadSvg(svg);
    // The stock marker's tip is PIN_TIP_Y down its viewBox, not its bottom
    // edge (the shadow hangs below it).
    ctx.drawImage(img, (pin.point.x - w / 2) * scale, (pin.point.y - h * (PIN_TIP_Y / PIN_VIEW_H)) * scale, w * scale, h * scale);
  }
  return out.toDataURL('image/png');
}

/** A codepoint no font has — what the platform draws for a missing glyph. */
const MISSING_GLYPH = '\u{10FFFD}';
const drawableCache = new Map<string, boolean>();

/**
 * Whether `icon` really draws on a canvas here: some ink, and not the same
 * pixels as a glyph no font has (the platform's "missing" box). A colour emoji
 * font is the system's on Windows/Linux (#2197/#2200), so this is a question
 * about the machine, asked once per icon and size.
 */
export function iconDrawable(icon: string, fontPx: number): boolean {
  const key = `${fontPx}\u0000${icon}`;
  const known = drawableCache.get(key);
  if (known !== undefined) return known;
  let result: boolean;
  try {
    const a = glyphPixels(icon, fontPx);
    const missing = glyphPixels(MISSING_GLYPH, fontPx);
    result = a !== null && a.some((v, i) => i % 4 === 3 && v > 0) && !samePixels(a, missing);
  } catch {
    result = false;
  }
  drawableCache.set(key, result);
  return result;
}

/** Test-only: forget what `iconDrawable` learned. */
export function _clearIconDrawableCacheForTests(): void {
  drawableCache.clear();
}

function glyphPixels(text: string, fontPx: number): Uint8ClampedArray | null {
  const size = Math.ceil(fontPx * 2);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.font = `${fontPx}px ${PIN_ICON_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = GLYPH_FILL;
  ctx.fillText(text, size / 2, size / 2);
  return ctx.getImageData(0, 0, size, size).data;
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function loadSvg(svg: SVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGElement;
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return loadSvgMarkup(new XMLSerializer().serializeToString(clone));
}

function loadSvgMarkup(markup: string): Promise<HTMLImageElement> {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('a map pin could not be drawn'));
    img.src = src;
  });
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The exported block for a map capture: the image with the providers'
 * attribution under it, or — when the map couldn't be drawn — a note saying
 * so and every place with its coordinates, each linked like a view row
 * (`data-note-link`, resolved by the export's link policy).
 */
export function mapCaptureHtml(capture: MapCapture, wrapperClass: string, noteLinkAttr: string): string {
  const style = `<style>.${wrapperClass}{margin:1em 0}`
    + `.${wrapperClass} .minerva-live-map{margin:0;border:1px solid #d8d4cc;border-radius:6px;overflow:hidden;background:#f6f4ef}`
    // margin:0 — export pages give every img `margin: 1em auto`, which would
    // letterbox the map inside its frame.
    + `.${wrapperClass} .minerva-live-map img{display:block;width:100%;height:auto;margin:0;max-width:none}`
    + `.${wrapperClass} .minerva-live-map figcaption{padding:4px 8px;font-size:11px;color:#666;text-align:right}`
    + `.${wrapperClass} table{border-collapse:collapse;width:100%;font-size:0.95em}`
    + `.${wrapperClass} th,.${wrapperClass} td{border-bottom:1px solid #e2ded6;padding:4px 8px;text-align:left}`
    + `.${wrapperClass} td.num{font-variant-numeric:tabular-nums}`
    + `.${wrapperClass} a{color:inherit;text-decoration:none}.${wrapperClass} a[href]:hover{text-decoration:underline}`
    + `</style>`;
  if (capture.ok) {
    const names = capture.places.map((p) => p.title);
    const alt = names.length === 0
      ? 'Map'
      : `Map of ${names.length} place${names.length === 1 ? '' : 's'}: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}`;
    const caption = capture.attribution ? `<figcaption>${esc(capture.attribution)}</figcaption>` : '';
    return `<div class="${wrapperClass}">${style}<figure class="minerva-live-map">`
      + `<img src="${capture.image}" width="${Math.round(capture.width)}" height="${Math.round(capture.height)}" alt="${esc(alt)}">`
      + `${caption}</figure></div>`;
  }
  const rows = capture.places.map((p) =>
    `<tr><td><a ${noteLinkAttr}="${esc(p.path)}">${esc(p.title)}</a></td><td class="num">${p.lat.toFixed(5)}</td><td class="num">${p.lng.toFixed(5)}</td></tr>`).join('');
  const note = `<p><em>${esc(`The map couldn't be drawn for this export (${capture.reason}).${capture.places.length > 0 ? ' Its places are listed instead.' : ''}`)}</em></p>`;
  const table = capture.places.length > 0
    ? `<table><thead><tr><th>Place</th><th>Latitude</th><th>Longitude</th></tr></thead><tbody>${rows}</tbody></table>`
    : '';
  return `<div class="${wrapperClass}">${style}${note}${table}</div>`;
}
