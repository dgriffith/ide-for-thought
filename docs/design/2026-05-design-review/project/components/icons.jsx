// Minerva icon set — monoline, 1.5 stroke, 16px native, considered.
// Each icon's 16x16 grid is built around a center pinned to (8, 8).
// Style: classical, slightly editorial, owl-coded where it suits.

const _baseIconProps = (size, color) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: color || "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  style: { display: "block", flexShrink: 0 },
});

const Icon = ({ name, size = 16, color, ...rest }) => {
  const path = ICONS[name];
  if (!path) return <span style={{ width: size, height: size }} />;
  return (
    <svg {..._baseIconProps(size, color)} {...rest}>
      {path}
    </svg>
  );
};

// Each entry is the inner JSX for the 16×16 viewBox. Use <path>, <circle>, etc.
// Keep them spare. Avoid filling unless the symbol absolutely requires it.
const ICONS = {
  // ── Navigation ────────────────────────────────────────────────────────
  back: <><path d="M10 3 4.5 8 10 13"/><path d="M4.5 8H13"/></>,
  forward: <><path d="M6 3 11.5 8 6 13"/><path d="M11.5 8H3"/></>,

  // ── Left sidebar panels ───────────────────────────────────────────────
  // Notes — folded-corner page (the canonical knowledge-base mark)
  notes: <><path d="M3.5 2.5h6L12.5 5.5v8H3.5z"/><path d="M9.5 2.5v3h3"/><path d="M5.5 8h5M5.5 10.5h3.5"/></>,
  // Sites/Sources — a stack of three lines with a serif top (book spine)
  sites: <><path d="M3 3h10v10H3z"/><path d="M3 5h10"/><path d="M5.5 3v10"/></>,
  // Tags — a tag fob, not a hash mark
  tags: <><path d="M2.5 7.5V3h4.5l6.5 6.5-4.5 4.5L2.5 7.5z"/><circle cx="5.25" cy="5.75" r=".75"/></>,
  // Tables — grid with a slightly accentuated first row
  tables: <><rect x="2.5" y="3" width="11" height="10" rx=".5"/><path d="M2.5 6h11M2.5 9.5h11M6.5 6v7M10 6v7"/></>,

  // ── Right sidebar panels ──────────────────────────────────────────────
  outline: <><path d="M3 4h2M3 8h2M3 12h2"/><path d="M7 4h6M7 8h5M7 12h4"/></>,
  footnotes: <><circle cx="4.5" cy="4.5" r="1.2"/><circle cx="4.5" cy="11.5" r="1.2"/><path d="M7.5 4.5h6M7.5 11.5h6"/><path d="M4.5 7v2"/></>,
  // Properties — key-value rows
  properties: <><circle cx="4" cy="5" r=".75"/><circle cx="4" cy="11" r=".75"/><path d="M6.5 5h6.5M6.5 11h4.5"/></>,
  // Outgoing — arrow leaving a circle
  outgoing: <><circle cx="5.5" cy="8" r="2.5"/><path d="M8.5 8H14"/><path d="M11.5 5.5 14 8l-2.5 2.5"/></>,
  // Backlinks — arrow entering a circle
  backlinks: <><circle cx="10.5" cy="8" r="2.5"/><path d="M8 8H2"/><path d="M4.5 5.5 2 8l2.5 2.5"/></>,
  // Citations — opening + closing quote marks
  citations: <><path d="M3 5.5c0-1 .5-1.5 1.5-1.5M5.5 4c-1 .5-1.5 1-1.5 2.5v3H6V6.5H4.5"/><path d="M9.5 5.5c0-1 .5-1.5 1.5-1.5M12 4c-1 .5-1.5 1-1.5 2.5v3h2V6.5H11"/></>,
  // Bookmark — ribbon
  bookmark: <><path d="M4 2.5h8v11l-4-2.5-4 2.5z"/></>,
  // Inspections — owl eye / observation circle
  inspections: <><circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2"/><circle cx="8" cy="8" r=".6" fill="currentColor"/></>,
  // Proposals — check in circle (approval)
  proposals: <><circle cx="8" cy="8" r="5.5"/><path d="m5.5 8.25 1.75 1.75L10.5 6.5"/></>,

  // ── Tab icons ─────────────────────────────────────────────────────────
  // Query — a play-triangle inside brackets (operational, not media)
  query: <><path d="M3 4h2M3 12h2M11 4h2M11 12h2M3 4v8M13 4v8"/><path d="m6.5 6 3.5 2-3.5 2z" fill="currentColor" stroke="none"/></>,
  // Source — bound book
  source: <><path d="M3.5 3.5h6.5a2.5 2.5 0 0 1 2.5 2.5v7h-7a2 2 0 0 0-2 2v-9a2 2 0 0 1 2-2z" /><path d="M3.5 11.5h9"/><path d="M6 6.5h3.5"/></>,

  // ── Tree / disclosure ─────────────────────────────────────────────────
  chevronRight: <path d="m6 4 4 4-4 4"/>,
  chevronDown: <path d="m4 6 4 4 4-4"/>,
  expandAll: <><path d="m4 6 4-3 4 3"/><path d="m4 10 4 3 4-3"/></>,
  collapseAll: <><path d="m4 3 4 3 4-3"/><path d="m4 13 4-3 4 3"/></>,
  reveal: <><circle cx="8" cy="8" r="2"/><path d="M2 8c1.5-3 3.5-4.5 6-4.5s4.5 1.5 6 4.5c-1.5 3-3.5 4.5-6 4.5S3.5 11 2 8z"/></>,

  // ── Actions / status ──────────────────────────────────────────────────
  close: <><path d="m4 4 8 8M12 4l-8 8"/></>,
  plus: <><path d="M8 3v10M3 8h10"/></>,
  search: <><circle cx="7" cy="7" r="3.5"/><path d="m9.5 9.5 3.5 3.5"/></>,
  settings: <><circle cx="8" cy="8" r="2"/><path d="M8 2v1.5M8 12.5V14M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M2 8h1.5M12.5 8H14M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/></>,
  warn: <><path d="M8 3 14 13H2z"/><path d="M8 6.5v3.5"/><circle cx="8" cy="11.6" r=".5" fill="currentColor" stroke="none"/></>,
  check: <path d="m3.5 8.25 3 3L12.5 5.5"/>,
  dot: <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>,

  // ── Editor / formatting ───────────────────────────────────────────────
  link: <><path d="M6.5 9.5 9.5 6.5"/><path d="M7 4.5h2.5a2.5 2.5 0 0 1 0 5H8.5"/><path d="M9 11.5H6.5a2.5 2.5 0 0 1 0-5H7.5"/></>,
  // Folder
  folder: <><path d="M2.5 4.5a1 1 0 0 1 1-1H6l1.5 1.5h5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/></>,
  folderOpen: <><path d="M2.5 12V5a1 1 0 0 1 1-1H6l1.5 1.5h5a1 1 0 0 1 1 1v.5"/><path d="m2.5 12 1.4-4.5h10L12.5 12z"/></>,

  // ── Conversations / LLM ───────────────────────────────────────────────
  conversation: <><path d="M2.5 4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.5L4 13v-2.5H3.5a1 1 0 0 1-1-1z"/></>,
  sparkle: <><path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3"/><path d="m4.5 4.5 1.5 1.5M10 10l1.5 1.5M11.5 4.5 10 6M6 10l-1.5 1.5"/></>,
  send: <><path d="M2.5 8 13.5 3 11 13.5 7.5 9.5z"/></>,

  // ── Misc ──────────────────────────────────────────────────────────────
  // The brand mark — owl-eye spiral. Used at small sizes for the title bar.
  minervaMark: (
    <>
      <circle cx="8" cy="8" r="6"/>
      <circle cx="8" cy="8" r="2.5"/>
      <circle cx="8" cy="8" r=".8" fill="currentColor" stroke="none"/>
    </>
  ),
};

window.MinervaIcon = Icon;
window.MinervaIcons = ICONS;
