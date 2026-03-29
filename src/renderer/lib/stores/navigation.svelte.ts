export interface NavPosition {
  relativePath: string;
  /** Character offset in the document */
  offset: number;
}

const MAX_HISTORY = 100;

let backStack = $state<NavPosition[]>([]);
let forwardStack = $state<NavPosition[]>([]);
let current = $state<NavPosition | null>(null);

/** True if we're in the middle of a back/forward navigation — suppresses recording */
let navigating = false;

export function getNavigationStore() {
  /** Record a new position. Called on file open, goto, search nav, etc. */
  function record(pos: NavPosition) {
    if (navigating) return;
    // Don't record if it's the same position
    if (current && current.relativePath === pos.relativePath && current.offset === pos.offset) return;
    // Don't record if same file and close offset (within 20 chars)
    if (current && current.relativePath === pos.relativePath && Math.abs(current.offset - pos.offset) < 20) return;

    if (current) {
      backStack.push(current);
      if (backStack.length > MAX_HISTORY) backStack.shift();
    }
    current = pos;
    // New navigation clears forward stack
    forwardStack.length = 0;
  }

  function goBack(): NavPosition | null {
    if (backStack.length === 0) return null;
    const prev = backStack.pop()!;
    if (current) forwardStack.push(current);
    current = prev;
    navigating = true;
    return prev;
  }

  function goForward(): NavPosition | null {
    if (forwardStack.length === 0) return null;
    const next = forwardStack.pop()!;
    if (current) backStack.push(current);
    current = next;
    navigating = true;
    return next;
  }

  /** Call after a back/forward navigation has been applied to re-enable recording */
  function doneNavigating() {
    navigating = false;
  }

  function clear() {
    backStack.length = 0;
    forwardStack.length = 0;
    current = null;
  }

  return {
    get canGoBack() { return backStack.length > 0; },
    get canGoForward() { return forwardStack.length > 0; },
    record,
    goBack,
    goForward,
    doneNavigating,
    clear,
  };
}
