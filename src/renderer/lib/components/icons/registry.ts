/**
 * Minerva icon set — monoline, 1.4 stroke, 16px native.
 *
 * Source of truth is the design-review JSX reference at
 * docs/design/2026-05-design-review/project/components/icons.jsx — keep
 * this file in sync. Each entry is the inner SVG markup for a 16×16
 * viewBox, dropped into <Icon> with {@html ...}.
 *
 * Style notes from the spec: each icon's grid is built around (8, 8).
 * Classical, slightly editorial; owl-coded where it suits. Avoid fills
 * unless the symbol absolutely requires it (the brand mark, dots, and
 * the query play-triangle do).
 */
export const ICONS = {
  // ── Navigation ────────────────────────────────────────────────────
  back: '<path d="M10 3 4.5 8 10 13"/><path d="M4.5 8H13"/>',
  forward: '<path d="M6 3 11.5 8 6 13"/><path d="M11.5 8H3"/>',

  // Local history — clock face + hand (#1158).
  history: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5"/>',

  // ── Left sidebar panels ───────────────────────────────────────────
  notes:
    '<path d="M3.5 2.5h6L12.5 5.5v8H3.5z"/>' +
    '<path d="M9.5 2.5v3h3"/>' +
    '<path d="M5.5 8h5M5.5 10.5h3.5"/>',
  sites:
    '<path d="M3 3h10v10H3z"/><path d="M3 5h10"/><path d="M5.5 3v10"/>',
  tags:
    '<path d="M2.5 7.5V3h4.5l6.5 6.5-4.5 4.5L2.5 7.5z"/>' +
    '<circle cx="5.25" cy="5.75" r=".75"/>',
  tables:
    '<rect x="2.5" y="3" width="11" height="10" rx=".5"/>' +
    '<path d="M2.5 6h11M2.5 9.5h11M6.5 6v7M10 6v7"/>',

  // Typed objects (#1068) — an isometric cube.
  objects:
    '<path d="M8 2.5 3 5v6l5 2.5 5-2.5V5Z"/>' +
    '<path d="M3 5l5 2.5 5-2.5M8 7.5V13.5"/>',

  // ── Right sidebar panels ──────────────────────────────────────────
  outline: '<path d="M3 4h2M3 8h2M3 12h2"/><path d="M7 4h6M7 8h5M7 12h4"/>',
  footnotes:
    '<circle cx="4.5" cy="4.5" r="1.2"/>' +
    '<circle cx="4.5" cy="11.5" r="1.2"/>' +
    '<path d="M7.5 4.5h6M7.5 11.5h6"/>' +
    '<path d="M4.5 7v2"/>',
  properties:
    '<circle cx="4" cy="5" r=".75"/>' +
    '<circle cx="4" cy="11" r=".75"/>' +
    '<path d="M6.5 5h6.5M6.5 11h4.5"/>',
  outgoing:
    '<circle cx="5.5" cy="8" r="2.5"/>' +
    '<path d="M8.5 8H14"/>' +
    '<path d="M11.5 5.5 14 8l-2.5 2.5"/>',
  backlinks:
    '<circle cx="10.5" cy="8" r="2.5"/>' +
    '<path d="M8 8H2"/>' +
    '<path d="M4.5 5.5 2 8l2.5 2.5"/>',
  citations:
    '<path d="M3 5.5c0-1 .5-1.5 1.5-1.5M5.5 4c-1 .5-1.5 1-1.5 2.5v3H6V6.5H4.5"/>' +
    '<path d="M9.5 5.5c0-1 .5-1.5 1.5-1.5M12 4c-1 .5-1.5 1-1.5 2.5v3h2V6.5H11"/>',
  bookmark: '<path d="M4 2.5h8v11l-4-2.5-4 2.5z"/>',
  inspections:
    '<circle cx="8" cy="8" r="5"/>' +
    '<circle cx="8" cy="8" r="2"/>' +
    '<circle cx="8" cy="8" r=".6" fill="currentColor"/>',
  proposals:
    '<circle cx="8" cy="8" r="5.5"/>' +
    '<path d="m5.5 8.25 1.75 1.75L10.5 6.5"/>',

  // ── Tab icons ─────────────────────────────────────────────────────
  query:
    '<path d="M3 4h2M3 12h2M11 4h2M11 12h2M3 4v8M13 4v8"/>' +
    '<path d="m6.5 6 3.5 2-3.5 2z" fill="currentColor" stroke="none"/>',
  source:
    '<path d="M3.5 3.5h6.5a2.5 2.5 0 0 1 2.5 2.5v7h-7a2 2 0 0 0-2 2v-9a2 2 0 0 1 2-2z"/>' +
    '<path d="M3.5 11.5h9"/>' +
    '<path d="M6 6.5h3.5"/>',

  // ── Tree / disclosure ─────────────────────────────────────────────
  chevronRight: '<path d="m6 4 4 4-4 4"/>',
  chevronDown: '<path d="m4 6 4 4 4-4"/>',
  expandAll: '<path d="m4 6 4-3 4 3"/><path d="m4 10 4 3 4-3"/>',
  collapseAll: '<path d="m4 3 4 3 4-3"/><path d="m4 13 4-3 4 3"/>',
  reveal:
    '<circle cx="8" cy="8" r="2"/>' +
    '<path d="M2 8c1.5-3 3.5-4.5 6-4.5s4.5 1.5 6 4.5c-1.5 3-3.5 4.5-6 4.5S3.5 11 2 8z"/>',

  // ── Actions / status ──────────────────────────────────────────────
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  search: '<circle cx="7" cy="7" r="3.5"/><path d="m9.5 9.5 3.5 3.5"/>',
  settings:
    '<circle cx="8" cy="8" r="2"/>' +
    '<path d="M8 2v1.5M8 12.5V14M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M2 8h1.5M12.5 8H14M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/>',
  warn:
    '<path d="M8 3 14 13H2z"/>' +
    '<path d="M8 6.5v3.5"/>' +
    '<circle cx="8" cy="11.6" r=".5" fill="currentColor" stroke="none"/>',
  check: '<path d="m3.5 8.25 3 3L12.5 5.5"/>',
  dot: '<circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>',

  // ── Editor / formatting ───────────────────────────────────────────
  link:
    '<path d="M6.5 9.5 9.5 6.5"/>' +
    '<path d="M7 4.5h2.5a2.5 2.5 0 0 1 0 5H8.5"/>' +
    '<path d="M9 11.5H6.5a2.5 2.5 0 0 1 0-5H7.5"/>',
  folder:
    '<path d="M2.5 4.5a1 1 0 0 1 1-1H6l1.5 1.5h5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>',
  folderOpen:
    '<path d="M2.5 12V5a1 1 0 0 1 1-1H6l1.5 1.5h5a1 1 0 0 1 1 1v.5"/>' +
    '<path d="m2.5 12 1.4-4.5h10L12.5 12z"/>',

  // ── Conversations / LLM ───────────────────────────────────────────
  conversation:
    '<path d="M2.5 4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.5L4 13v-2.5H3.5a1 1 0 0 1-1-1z"/>',
  sparkle:
    '<path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3"/>' +
    '<path d="m4.5 4.5 1.5 1.5M10 10l1.5 1.5M11.5 4.5 10 6M6 10l-1.5 1.5"/>',
  send: '<path d="M2.5 8 13.5 3 11 13.5 7.5 9.5z"/>',
  // Dictation (#voice): a capsule mic over a curved stand.
  mic:
    '<rect x="6" y="2.5" width="4" height="7" rx="2"/>' +
    '<path d="M4 7.5a4 4 0 0 0 8 0"/>' +
    '<path d="M8 11.5V13.5M6 13.5h4"/>',

  // ── Note types (sidebar + New Note picker) ───────────────────────
  // `notes` (page-with-fold) is the markdown default; `tables` (grid)
  // already covers CSV. These add the missing two so the FileTree can
  // disambiguate at a glance.
  graph:
    '<circle cx="4" cy="4.5" r="1.4"/>' +
    '<circle cx="12" cy="4.5" r="1.4"/>' +
    '<circle cx="8" cy="12" r="1.4"/>' +
    '<path d="M5.4 4.5h5.2M5 5.8 7.3 10.7M11 5.8 8.7 10.7"/>',
  code:
    '<path d="M5.5 5.5 3 8l2.5 2.5"/>' +
    '<path d="M10.5 5.5 13 8l-2.5 2.5"/>' +
    '<path d="M9.5 4.5 6.5 11.5"/>',

  // ── Editor split (#813) ───────────────────────────────────────────
  // A framed pane divided by the axis the split adds along: split-h adds a
  // pane to the right (vertical divider); split-v adds one below (horizontal
  // divider).
  'split-h':
    '<rect x="2.5" y="3" width="11" height="10" rx="1"/>' +
    '<path d="M8 3v10"/>',
  'split-v':
    '<rect x="2.5" y="3" width="11" height="10" rx="1"/>' +
    '<path d="M2.5 8h11"/>',

  // ── Compute (#238) ────────────────────────────────────────────────
  // "Recompute all": a fast-forward double-triangle — run every runnable
  // fence top to bottom. Echoes the gutter's ▶ single-cell run marker.
  'run-all':
    '<path d="M3 4 7.5 8 3 12z" fill="currentColor" stroke="none"/>' +
    '<path d="M8.5 4 13 8 8.5 12z" fill="currentColor" stroke="none"/>',

  // ── Brand ─────────────────────────────────────────────────────────
  // A crop of the app owl's eye looking back (#1121): honey (accent) socket
  // ring, translucent honey iris, solid honey pupil, white catchlight. Colors
  // are `var(--accent)` directly, NOT `currentColor` (#1121 follow-up): <Icon>
  // maps its `color` prop to the SVG `stroke`, so `fill="currentColor"` would
  // resolve to the inherited (muted) text color and the iris/pupil would render
  // grey instead of honey.
  minervaMark:
    '<circle cx="8" cy="8" r="7" stroke="var(--accent)" stroke-width="1.4"/>' +
    '<circle cx="8" cy="8" r="4.2" fill="var(--accent)" fill-opacity="0.28" stroke="var(--accent)" stroke-width="1.2"/>' +
    '<circle cx="8" cy="8" r="1.7" fill="var(--accent)" stroke="none"/>' +
    '<circle cx="7.2" cy="7.2" r="0.6" fill="#fff" fill-opacity="0.7" stroke="none"/>',
} as const;

export type IconName = keyof typeof ICONS;
