/**
 * Convention: a note tagged `entrypoint` is a designated starting
 * surface for the thoughtbase. The renderer auto-opens any entrypoint
 * notes when a project loads with no notes already in the editor; the
 * publishing pipeline will (eventually) use the same marker to decide
 * which note maps to `index.html`.
 *
 * Just a regular tag — users can hand-edit `tags:` in frontmatter or
 * use the sidebar "Mark as Entrypoint" toggle. Both write the same
 * lowercase tag, so the two paths are interchangeable.
 */
export const ENTRYPOINT_TAG = 'entrypoint';
