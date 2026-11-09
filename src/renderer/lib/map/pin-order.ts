/**
 * The order a map's pins are stepped through from the keyboard (#2934): a
 * fixed reading order rather than "the nearest pin that way" — predictable,
 * the same every time, and easy to say. ←/→ walk west → east (ties north
 * first), ↑/↓ north → south (ties west first); Home/End go to either end.
 */
export interface PinPoint {
  path: string;
  lat: number;
  lng: number;
}

const byPath = (a: PinPoint, b: PinPoint) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** ←/→: west → east, then north → south, then by path. */
export function eastwardOrder(pins: readonly PinPoint[]): string[] {
  return [...pins].sort((a, b) => a.lng - b.lng || b.lat - a.lat || byPath(a, b)).map((p) => p.path);
}

/** ↑/↓: north → south, then west → east, then by path. */
export function southwardOrder(pins: readonly PinPoint[]): string[] {
  return [...pins].sort((a, b) => b.lat - a.lat || a.lng - b.lng || byPath(a, b)).map((p) => p.path);
}

/** Where a key moves from `path`, or null when it isn't one or there's nowhere to go. */
export function nextPin(pins: readonly PinPoint[], path: string, key: string): string | null {
  const order = key === 'ArrowUp' || key === 'ArrowDown' ? southwardOrder(pins) : eastwardOrder(pins);
  const i = order.indexOf(path);
  if (i === -1) return null;
  if (key === 'Home') return order[0] ?? null;
  if (key === 'End') return order[order.length - 1] ?? null;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return null;
  return order[i + step] ?? null;
}
