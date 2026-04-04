export interface NoteNavPosition {
  type: 'note';
  relativePath: string;
  offset: number;
}

export interface QueryNavPosition {
  type: 'query';
  tabId: string;
}

export type NavPosition = NoteNavPosition | QueryNavPosition;

const MAX_HISTORY = 100;

let backStack = $state<NavPosition[]>([]);
let forwardStack = $state<NavPosition[]>([]);
let current = $state<NavPosition | null>(null);

/** True if we're in the middle of a back/forward navigation — suppresses recording */
let navigating = false;

export function getNavigationStore() {
  /** Record a new position. Called on file open, goto, search nav, tab switch, etc. */
  function record(pos: NavPosition) {
    if (navigating) return;

    // Dedup: don't record if same position
    if (current && isSamePosition(current, pos)) return;

    if (current) {
      backStack.push(current);
      if (backStack.length > MAX_HISTORY) backStack.shift();
    }
    current = pos;
    // New navigation clears forward stack
    forwardStack.length = 0;
  }

  function isSamePosition(a: NavPosition, b: NavPosition): boolean {
    if (a.type !== b.type) return false;
    if (a.type === 'query' && b.type === 'query') return a.tabId === b.tabId;
    if (a.type === 'note' && b.type === 'note') {
      return a.relativePath === b.relativePath && Math.abs(a.offset - b.offset) < 20;
    }
    return false;
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
