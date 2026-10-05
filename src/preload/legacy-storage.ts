/**
 * The file:// → app:// move (#2564): before any page script reads
 * localStorage, copy in what the old origin held. Main answers null on every
 * launch but the first after the upgrade; an existing key always wins.
 * Kept out of preload.ts so every branch is unit-testable.
 */
export function importLegacyOriginStorage(
  fetchLegacy: () => Record<string, string> | null,
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'>,
): number {
  let copied = 0;
  try {
    const legacy = fetchLegacy();
    if (!legacy) return 0;
    // Read inside the try: the localStorage getter itself can throw.
    const storage = getStorage();
    for (const [key, value] of Object.entries(legacy)) {
      if (storage.getItem(key) === null) {
        storage.setItem(key, value);
        copied++;
      }
    }
  } catch {
    // Storage unavailable (or main gone): start fresh rather than break the page.
  }
  return copied;
}
