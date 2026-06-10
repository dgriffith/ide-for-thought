/**
 * Multi-path clipboard. Cut / Copy capture the current sidebar
 * selection at click time (the right-click menu has already promoted
 * single-clicks to single-selections, so the selection always
 * matches what the user expects). The (relativePath, isDirectory)
 * args from the menu callback are kept as a fallback for the rare
 * path where the menu fires without a populated selection.
 */
export interface ClipboardEntry {
  items: Array<{ relativePath: string; isDirectory: boolean }>;
  mode: 'cut' | 'copy';
}

let current = $state<ClipboardEntry | null>(null);

export function getClipboardStore() {
  return {
    get current() { return current; },
    set(entry: ClipboardEntry) { current = entry; },
    clear() { current = null; },
  };
}
