const STORAGE_KEY = 'suppressedConfirms';

function readFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeToStorage(set: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

// Reactive singleton so the Behaviors tab re-renders automatically when the
// set changes from anywhere — the dialog code, a user confirmation, a clear-
// all action.
let suppressed = $state<Set<string>>(readFromStorage());

export function getConfirmSuppressionStore() {
  function isSuppressed(key: string): boolean {
    return suppressed.has(key);
  }

  function suppress(key: string): void {
    if (suppressed.has(key)) return;
    suppressed = new Set([...suppressed, key]);
    writeToStorage(suppressed);
  }

  function unsuppress(key: string): void {
    if (!suppressed.has(key)) return;
    const next = new Set(suppressed);
    next.delete(key);
    suppressed = next;
    writeToStorage(suppressed);
  }

  function clearAll(): void {
    if (suppressed.size === 0) return;
    suppressed = new Set();
    writeToStorage(suppressed);
  }

  return {
    get suppressed() { return suppressed; },
    isSuppressed,
    suppress,
    unsuppress,
    clearAll,
  };
}

// Test-only: reset in-memory state (for unit tests that manipulate localStorage).
export function __resetSuppressionForTests(): void {
  suppressed = readFromStorage();
}
