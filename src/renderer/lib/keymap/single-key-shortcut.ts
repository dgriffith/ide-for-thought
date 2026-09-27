/**
 * Guard for single-character keyboard shortcuts (WCAG 2.1.4, #2377).
 *
 * A panel that binds bare letters (the Proposals panel's y / n / s) must not
 * fire them while the user is typing into a field inside that panel — the
 * keystroke bubbles up to the panel's handler — nor when a modifier is held,
 * where the same letter is an app shortcut (⌘N New Note, ⌘S Save).
 *
 * Returns true only for an unmodified key press whose target is not an
 * editable control.
 */
export function isBareKeyShortcut(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  if (!t) return true;
  if (t.isContentEditable) return false;
  return t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && t.tagName !== 'SELECT';
}
