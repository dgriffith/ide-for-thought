/**
 * Drag-tab-to-split hit-testing (#817).
 */
import { describe, it, expect } from 'vitest';
import { dropZoneFromFraction, splitForZone } from '../../src/renderer/lib/editor/drop-zone';

describe('dropZoneFromFraction', () => {
  it('maps the four edge bands and the center', () => {
    expect(dropZoneFromFraction(0.1, 0.5)).toBe('left');
    expect(dropZoneFromFraction(0.9, 0.5)).toBe('right');
    expect(dropZoneFromFraction(0.5, 0.1)).toBe('top');
    expect(dropZoneFromFraction(0.5, 0.9)).toBe('bottom');
    expect(dropZoneFromFraction(0.5, 0.5)).toBe('center');
  });

  it('prioritises left/right over top/bottom at the corners', () => {
    expect(dropZoneFromFraction(0.05, 0.05)).toBe('left');
    expect(dropZoneFromFraction(0.95, 0.95)).toBe('right');
  });

  it('treats the 25% band edges as the boundary', () => {
    expect(dropZoneFromFraction(0.24, 0.5)).toBe('left');
    expect(dropZoneFromFraction(0.26, 0.5)).toBe('center');
    expect(dropZoneFromFraction(0.5, 0.76)).toBe('bottom');
  });
});

describe('splitForZone', () => {
  it('edge zones map to an axis + side; center is no split', () => {
    expect(splitForZone('left')).toEqual({ direction: 'horizontal', before: true });
    expect(splitForZone('right')).toEqual({ direction: 'horizontal', before: false });
    expect(splitForZone('top')).toEqual({ direction: 'vertical', before: true });
    expect(splitForZone('bottom')).toEqual({ direction: 'vertical', before: false });
    expect(splitForZone('center')).toBeNull();
  });
});
