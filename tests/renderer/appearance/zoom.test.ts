/**
 * @vitest-environment jsdom
 *
 * Whole-window zoom persistence (#...). Mocks `api.view` (the webFrame bridge)
 * and uses jsdom's localStorage to verify clamping, stored-value parsing, and
 * that setZoom / applyStoredZoom both persist and push the factor to the frame.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ api: { view: { getZoomFactor: vi.fn(), setZoomFactor: vi.fn() } } }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import {
  clampZoom, getStoredZoom, setZoom, applyStoredZoom,
  MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM,
} from '../../../src/renderer/lib/appearance/zoom';

// Node's experimental Web Storage global shadows jsdom's localStorage but is
// non-functional here, so swap in a simple in-memory Storage (mirrors the
// RelatedPanel test's workaround).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', new MemStorage());
});

describe('clampZoom', () => {
  it('clamps to [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(5)).toBe(MAX_ZOOM);
    expect(clampZoom(1.25)).toBe(1.25);
  });
  it('falls back to DEFAULT_ZOOM for non-finite input', () => {
    expect(clampZoom(NaN)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(Infinity)).toBe(DEFAULT_ZOOM);
  });
});

describe('getStoredZoom', () => {
  it('returns DEFAULT_ZOOM when nothing is stored', () => {
    expect(getStoredZoom()).toBe(DEFAULT_ZOOM);
  });
  it('parses and clamps a stored value', () => {
    localStorage.setItem('zoomFactor', '1.4');
    expect(getStoredZoom()).toBe(1.4);
    localStorage.setItem('zoomFactor', '99');
    expect(getStoredZoom()).toBe(MAX_ZOOM);
    localStorage.setItem('zoomFactor', 'garbage');
    expect(getStoredZoom()).toBe(DEFAULT_ZOOM);
  });
});

describe('setZoom', () => {
  it('persists the clamped factor and pushes it to the frame', () => {
    const applied = setZoom(1.3);
    expect(applied).toBe(1.3);
    expect(localStorage.getItem('zoomFactor')).toBe('1.3');
    expect(h.api.view.setZoomFactor).toHaveBeenCalledWith(1.3);
  });
  it('clamps out-of-range input before persisting/applying', () => {
    const applied = setZoom(10);
    expect(applied).toBe(MAX_ZOOM);
    expect(localStorage.getItem('zoomFactor')).toBe(String(MAX_ZOOM));
    expect(h.api.view.setZoomFactor).toHaveBeenCalledWith(MAX_ZOOM);
  });
});

describe('applyStoredZoom', () => {
  it('pushes the stored factor to the frame without writing storage', () => {
    localStorage.setItem('zoomFactor', '0.75');
    applyStoredZoom();
    expect(h.api.view.setZoomFactor).toHaveBeenCalledWith(0.75);
  });
  it('applies DEFAULT_ZOOM when nothing is stored', () => {
    applyStoredZoom();
    expect(h.api.view.setZoomFactor).toHaveBeenCalledWith(DEFAULT_ZOOM);
  });
});
