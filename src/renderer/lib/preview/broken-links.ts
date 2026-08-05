/**
 * Mark unresolved wiki-links in the rendered preview so a broken `[[link]]`
 * reads the same in the Preview pane as in the editor squiggle (#1446).
 *
 * Scope mirrors the editor: plain (untyped) note links only. `cite::`/`quote::`
 * (`.typed-link`) resolve to sources/excerpts, not notes, so they'd false-flag
 * through the note resolver and are skipped. A `#heading` anchor is stripped
 * before resolving — a missing heading isn't a missing note (note-existence
 * only, matching the editor).
 */
export function markBrokenWikiLinks(
  previewEl: HTMLElement | null,
  resolvePath: (target: string) => string | null,
): void {
  if (!previewEl) return;
  for (const a of previewEl.querySelectorAll<HTMLElement>('.wiki-link:not(.typed-link)')) {
    const target = a.dataset.target;
    if (!target) continue;
    const notePart = (target.split('#')[0] ?? target).trim();
    // Empty target (a bare `[[#anchor]]`) isn't a broken note; leave it.
    const broken = notePart.length > 0 && resolvePath(notePart) === null;
    a.classList.toggle('wiki-link-broken', broken);
  }
}
