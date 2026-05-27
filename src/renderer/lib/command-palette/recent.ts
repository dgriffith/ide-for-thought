/**
 * Recently-used command tracking for the palette (#463). Persisted
 * to localStorage so "recent" survives reloads; bounded to 10
 * entries so the palette stays predictable.
 */

const STORAGE_KEY = 'minerva.commandPalette.recent';
const MAX_RECENT = 10;

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/**
 * Push `id` to the front of the recent list, dedupe, persist.
 * Returns the updated list so callers don't have to round-trip
 * through `loadRecent` again.
 */
export function recordRecent(id: string): string[] {
  const current = loadRecent();
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_RECENT);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ok */ }
  return next;
}
