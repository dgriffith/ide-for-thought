/**
 * Per-source preferred view (#100). When a source has both an
 * extracted `body.md` and an `original.pdf`, the user's last choice
 * decides which one opens by default the next time they click that
 * source. Persisted in localStorage so it follows the install, not
 * the project file — reading habits are personal.
 */

export type SourceView = 'pdf' | 'markdown';

const KEY_PREFIX = 'minerva.sourcePreferredView.';

export function getPreferredSourceView(sourceId: string): SourceView | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sourceId);
    if (raw === 'pdf' || raw === 'markdown') return raw;
  } catch { /* localStorage disabled — accept fall-through */ }
  return null;
}

export function setPreferredSourceView(sourceId: string, view: SourceView): void {
  try {
    localStorage.setItem(KEY_PREFIX + sourceId, view);
  } catch { /* ok */ }
}
