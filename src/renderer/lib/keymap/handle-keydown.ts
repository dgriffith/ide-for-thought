/**
 * Global keyboard shortcuts (#463 / extracted from App.svelte in #670).
 *
 * `handleKeydown(e, deps)` is the window-level keymap, moved out of App.svelte
 * as a pure function of an injected `KeymapDeps`. It runs at event time (not
 * reactively), so the predicates read current state when a key is pressed.
 * Keeping it dependency-injected makes the key→action dispatch unit-testable
 * without mounting the app — part of the App.svelte decomposition safety net.
 *
 * Behaviour preserved verbatim, including which combos guard on state before
 * calling `preventDefault()` (so an unhandled combo with no project open still
 * falls through to the browser / editor).
 */
export interface KeymapDeps {
  hasProject: () => boolean;
  hasActiveTab: () => boolean;
  hasActiveIndex: () => boolean;
  toggleCommandPalette: () => void;
  navBack: () => void;
  navForward: () => void;
  cyclePreview: () => void;
  toggleRightSidebar: () => void;
  cycleTheme: () => void;
  newNote: () => void;
  closeActiveTab: () => void;
  toggleQuickOpen: () => void;
  openGotoLine: () => void;
  newQuery: () => void;
  openConversation: () => void;
}

export function handleKeydown(e: KeyboardEvent, deps: KeymapDeps): void {
  const mod = e.metaKey || e.ctrlKey;
  // ⌘K (or Ctrl+K) opens the command palette (#463). ⌘⇧P is already bound to
  // cycle view mode, so we use the Linear / VS Code convention instead of
  // Obsidian's ⌘P (which is our quick-open).
  if (mod && !e.shiftKey && !e.altKey && e.key === 'k') {
    if (deps.hasProject()) {
      e.preventDefault();
      deps.toggleCommandPalette();
      return;
    }
  }
  if (mod && e.key === '[') {
    e.preventDefault();
    deps.navBack();
  }
  if (mod && e.key === ']') {
    e.preventDefault();
    deps.navForward();
  }
  if (mod && e.shiftKey && e.key === 'p') {
    e.preventDefault();
    deps.cyclePreview();
  }
  if (mod && e.shiftKey && e.key === 'b') {
    e.preventDefault();
    deps.toggleRightSidebar();
  }
  if (mod && e.shiftKey && e.key === 't') {
    e.preventDefault();
    deps.cycleTheme();
  }
  if (mod && e.key === 'n') {
    e.preventDefault();
    deps.newNote();
  }
  if (mod && !e.shiftKey && e.key === 'w') {
    if (deps.hasActiveIndex()) {
      e.preventDefault();
      deps.closeActiveTab();
    }
  }
  if (mod && !e.shiftKey && e.key === 'p') {
    if (deps.hasProject()) {
      e.preventDefault();
      deps.toggleQuickOpen();
    }
  }
  if (mod && !e.shiftKey && e.key === 'g') {
    if (deps.hasActiveTab()) {
      e.preventDefault();
      deps.openGotoLine();
    }
  }
  if (mod && e.shiftKey && e.key === 'q') {
    if (deps.hasProject()) {
      e.preventDefault();
      deps.newQuery();
    }
  }
  if (mod && e.shiftKey && e.key === 'i') {
    e.preventDefault();
    deps.openConversation();
  }
}
