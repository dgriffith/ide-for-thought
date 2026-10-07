/**
 * @vitest-environment happy-dom
 *
 * Compositing a map's pins into its export image (#2511, #2711). happy-dom has
 * no 2D canvas, so the canvas and `Image` are fakes that record what is drawn:
 * which pin SVG went where, and which icon was written with `fillText`. What a
 * glyph looks like on the canvas is scripted per test — drawn, a missing-glyph
 * box, or nothing — to drive `iconDrawable`'s detection both ways.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _clearIconDrawableCacheForTests, compositeMap, iconDrawable, type PinToDraw } from '../../../src/renderer/lib/map/map-export';
import { EMOJI_PIN_HEIGHT, EMOJI_PIN_OFFSET, EMOJI_PIN_SCALE, EMOJI_PIN_WIDTH, PIN_TIP_Y, PIN_VIEW_H, createEmojiPinElement } from '../../../src/renderer/lib/map/emoji-pin';

type Rendering = 'glyph' | 'tofu' | 'blank';
/** How the "machine" draws each text; anything unlisted draws as the missing box. */
let renders: Record<string, Rendering> = {};
const MISSING = '\u{10FFFD}';

interface Call { op: string; args: unknown[] }
const outputCalls: Call[] = [];

function pixelsFor(text: string | null, size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const kind: Rendering = text === null ? 'blank' : (text === MISSING ? 'tofu' : (renders[text] ?? 'tofu'));
  if (kind === 'tofu') for (let i = 3; i < 40; i += 4) data[i] = 255; // the same box, whatever the codepoint
  if (kind === 'glyph') for (let i = 0; i < 400; i += 4) { data[i] = 220; data[i + 3] = 255; }
  return data;
}

class FakeCtx {
  font = '';
  textAlign = '';
  textBaseline = '';
  fillStyle = '';
  drawn: string | null = null;
  constructor(private canvas: HTMLCanvasElement) {}
  drawImage(...args: unknown[]): void { outputCalls.push({ op: 'drawImage', args }); }
  fillText(text: string, ...rest: unknown[]): void {
    this.drawn = text;
    outputCalls.push({ op: 'fillText', args: [text, ...rest] });
  }
  getImageData(_x: number, _y: number, w: number) { return { data: pixelsFor(this.drawn, w) }; }
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() { return this._src; }
  set src(v: string) { this._src = v; queueMicrotask(() => this.onload?.()); }
}

beforeEach(() => {
  renders = {};
  outputCalls.length = 0;
  _clearIconDrawableCacheForTests();
  const ctxs = new WeakMap<HTMLCanvasElement, FakeCtx>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let c = ctxs.get(this);
    if (!c) { c = new FakeCtx(this); ctxs.set(this, c); }
    return c as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,OUT');
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mapCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1520; // 760 CSS px at 2×
  c.height = 720;
  return c;
}

/** The SVG an `Image` was given, decoded. */
const svgOf = (img: unknown): string => decodeURIComponent((img as FakeImage).src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
/** Pin drawImage calls — the first drawImage is the map canvas itself. */
const pinDraws = () => outputCalls.filter((c) => c.op === 'drawImage').slice(1);

function stockPin(): HTMLElement {
  // The shape MapLibre gives a default marker: a wrapper div around a 27×41 SVG.
  const el = document.createElement('div');
  el.innerHTML = '<svg width="27px" height="41px" viewBox="0 0 27 41"><g fill="#89b4fa"><path d="M0 0"/></g></svg>';
  return el;
}

describe('compositeMap pins (#2711)', () => {
  it('draws an icon pin: the teardrop in its colour with the light disc, then the emoji in the disc', async () => {
    renders = { '🍕': 'glyph' };
    const pin: PinToDraw = { element: createEmojiPinElement('🍕', '#f38ba8', 'Pizza'), point: { x: 100, y: 200 } };
    await expect(compositeMap(mapCanvas(), [pin], 760, 360)).resolves.toBe('data:image/png;base64,OUT');

    const [draw] = pinDraws();
    const svg = svgOf(draw!.args[0]);
    expect(svg).toContain('fill="#f38ba8"');
    expect(svg).toContain('r="9.75"'); // the disc, not the stock dot
    expect(svg).not.toContain('<text'); // the emoji is drawn by the canvas, not inside the SVG image
    // Tip on the point, at 2×: centred on x, PIN_TIP_Y/41 of the pin above y.
    const [, x, y, w, h] = draw!.args as number[];
    expect(x).toBeCloseTo((100 - EMOJI_PIN_WIDTH / 2) * 2);
    expect(y).toBeCloseTo((200 - EMOJI_PIN_HEIGHT * (PIN_TIP_Y / PIN_VIEW_H)) * 2);
    expect([w, h]).toEqual([EMOJI_PIN_WIDTH * 2, EMOJI_PIN_HEIGHT * 2]);

    const texts = outputCalls.filter((c) => c.op === 'fillText');
    // Probes ran on their own canvases; the output got exactly one fillText.
    expect(texts.filter((c) => c.args[0] === '🍕').length).toBeGreaterThanOrEqual(1);
    const last = texts.at(-1)!;
    expect(last.args[0]).toBe('🍕');
    expect(last.args[1]).toBeCloseTo(200); // x = 100 CSS px at 2×
  });

  it('falls back to the plain coloured pin when the emoji renders as a missing-glyph box', async () => {
    renders = {}; // 🦖 draws exactly like the missing glyph here
    const pin: PinToDraw = { element: createEmojiPinElement('🦖', '#a6e3a1', 'Dino'), point: { x: 50, y: 60 } };
    await compositeMap(mapCanvas(), [pin], 760, 360);
    const svg = svgOf(pinDraws()[0]!.args[0]);
    expect(svg).toContain('fill="#a6e3a1"');
    expect(svg).toContain('translate(8.0, 8.0)'); // the stock pin's white dot
    expect(svg).not.toContain('r="9.75"'); // no empty disc
    expect(outputCalls.some((c) => c.op === 'fillText' && c.args[0] === '🦖' && c.args[1] === 100)).toBe(false);
  });

  it('falls back when the emoji draws nothing at all', () => {
    renders = { '🫥': 'blank' };
    expect(iconDrawable('🫥', 30)).toBe(false);
    renders = { '🍕': 'glyph' };
    expect(iconDrawable('🍕', 30)).toBe(true);
  });

  it('falls back when probing the glyph throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('no canvas'); });
    expect(iconDrawable('🍕', 30)).toBe(false);
  });

  it('draws a stock pin from its own SVG, tip on the point', async () => {
    await compositeMap(mapCanvas(), [{ element: stockPin(), point: { x: 300, y: 100 } }], 760, 360);
    const [draw] = pinDraws();
    expect(svgOf(draw!.args[0])).toContain('fill="#89b4fa"');
    const [, x, y, w, h] = draw!.args as number[];
    expect(x).toBeCloseTo((300 - 13.5) * 2);
    // The stock tip is 34.5 down its 41-unit box, not the box's bottom edge.
    expect(y).toBeCloseTo((100 - 34.5) * 2);
    expect([w, h]).toEqual([54, 82]);
    expect(outputCalls.some((c) => c.op === 'fillText')).toBe(false);
  });

  it('the live pin and the export agree on where the tip is', () => {
    // Bottom-anchored with EMOJI_PIN_OFFSET: the coordinate sits OFFSET above
    // the element's bottom, i.e. PIN_TIP_Y down it — the export's tip.
    expect(EMOJI_PIN_HEIGHT - EMOJI_PIN_OFFSET[1]).toBeCloseTo(PIN_TIP_Y * EMOJI_PIN_SCALE);
  });
});
