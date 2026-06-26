/**
 * Shared graph-view settings (#849).
 *
 * The "auto-navigate on click" toggle — off by default. Off, a single click on a
 * graph node *selects* it and navigation needs an explicit gesture (double-click
 * / Enter); on, a single click *navigates* (View A scrolls to the heading, View
 * B opens the note / source). One persisted global setting both views obey, so
 * the click model is consistent — defined in the shared GraphCanvas interaction
 * layer (#844) and fed this flag.
 */

const STORAGE_KEY = 'minerva.graph.autoNavigate';

function readFromStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

let autoNavigate = $state<boolean>(readFromStorage());

export function getGraphSettings() {
  function setAutoNavigate(value: boolean): void {
    autoNavigate = value;
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* ignore */ }
  }
  return {
    /** When true, a single click navigates instead of selecting. */
    get autoNavigate() { return autoNavigate; },
    setAutoNavigate,
    toggleAutoNavigate() { setAutoNavigate(!autoNavigate); },
  };
}

/** Test-only: re-read from localStorage. */
export function __resetGraphSettingsForTests(): void {
  autoNavigate = readFromStorage();
}
