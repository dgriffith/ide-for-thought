/**
 * The order a map's pins are stepped through (#2934): a fixed reading order —
 * ←/→ west → east, ↑/↓ north → south — not "the nearest pin that way".
 */
import { describe, it, expect } from 'vitest';
import { eastwardOrder, nextPin, southwardOrder } from '../../../src/renderer/lib/map/pin-order';

const PINS = [
  { path: 'nyc.md', lat: 40.71, lng: -74.0 },
  { path: 'sf.md', lat: 37.77, lng: -122.42 },
  { path: 'chicago.md', lat: 41.88, lng: -87.63 },
  { path: 'north.md', lat: 45.0, lng: -74.0 }, // same longitude as NYC, further north
];

describe('pin order (#2934)', () => {
  it('west → east, a tie going north first', () => {
    expect(eastwardOrder(PINS)).toEqual(['sf.md', 'chicago.md', 'north.md', 'nyc.md']);
  });

  it('north → south, a tie going west first', () => {
    expect(southwardOrder([...PINS, { path: 'west.md', lat: 45.0, lng: -100 }])).toEqual(['west.md', 'north.md', 'chicago.md', 'nyc.md', 'sf.md']);
  });

  it('a key steps along its order, Home/End to the ends, and stops at either end', () => {
    expect(nextPin(PINS, 'chicago.md', 'ArrowRight')).toBe('north.md');
    expect(nextPin(PINS, 'chicago.md', 'ArrowLeft')).toBe('sf.md');
    expect(nextPin(PINS, 'chicago.md', 'ArrowDown')).toBe('nyc.md');
    expect(nextPin(PINS, 'chicago.md', 'ArrowUp')).toBe('north.md');
    expect(nextPin(PINS, 'chicago.md', 'Home')).toBe('sf.md');
    expect(nextPin(PINS, 'chicago.md', 'End')).toBe('nyc.md');
    expect(nextPin(PINS, 'sf.md', 'ArrowLeft')).toBeNull();
    expect(nextPin(PINS, 'chicago.md', 'Enter')).toBeNull();
    expect(nextPin(PINS, 'gone.md', 'ArrowRight')).toBeNull();
  });
});
