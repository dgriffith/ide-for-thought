/**
 * A Typed-Objects map captured for an export (#2511, epic #2508): the
 * preview's own map (`TypeViewMap` — same markers, same `fitBounds` framing)
 * rendered once at a fixed size in the light style, flattened into one PNG
 * with its pins baked in, so an exported page needs no MapLibre, no network
 * and no script to show it. If the map can't be drawn, the export gets the
 * places as a table instead — never a blank box.
 */

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
 *  its anchor (the pin's tip) sits on the map, in CSS pixels. */
export interface PinToDraw {
  element: HTMLElement;
  point: { x: number; y: number };
}

/**
 * Flatten the map canvas plus its pins into one PNG data URL. Each pin is the
 * marker's own SVG (so its colour matches the preview), drawn with its tip on
 * the projected coordinate — MapLibre's default marker is bottom-anchored.
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
    const svg = pin.element.querySelector('svg');
    if (!svg) continue;
    const w = Number(svg.getAttribute('width')) || 27;
    const h = Number(svg.getAttribute('height')) || 41;
    const img = await loadSvg(svg);
    ctx.drawImage(img, (pin.point.x - w / 2) * scale, (pin.point.y - h) * scale, w * scale, h * scale);
  }
  return out.toDataURL('image/png');
}

function loadSvg(svg: SVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGElement;
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
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
