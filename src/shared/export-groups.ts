/**
 * The Export menu's format families (#: export-menu-redesign; #2630). Scope
 * (note/folder/tree/project/source) and format (markdown/html/pdf/…) are
 * orthogonal, so the menu organizes by *format family* — one item per group —
 * and the export dialog picks scope. Several exporters can share a group
 * (note-html and tree-html are both `html`, differing only in scope).
 *
 * The ONE list: `ExportGroupId` is derived from it, and both processes import
 * it — the renderer used to re-declare the union. Every `Exporter` names its
 * group with this type, so an exporter can't name a group that isn't here.
 */

/** Menu section a group sits in — drives the separators between families. */
export type ExportGroupCategory = 'document' | 'publication' | 'citation';

export const EXPORT_GROUPS = {
  markdown:  { id: 'markdown',  label: 'Markdown',         category: 'document',    order: 1 },
  html:      { id: 'html',      label: 'HTML',             category: 'document',    order: 2 },
  pdf:       { id: 'pdf',       label: 'PDF',              category: 'document',    order: 3 },
  site:      { id: 'site',      label: 'Static Site',      category: 'publication', order: 4 },
  annotated: { id: 'annotated', label: 'Annotated Source', category: 'publication', order: 5 },
  anki:      { id: 'anki',      label: 'Anki Deck',        category: 'publication', order: 6 },
  bibtex:    { id: 'bibtex',    label: 'BibTeX',           category: 'citation',    order: 7 },
  pandoc:    { id: 'pandoc',    label: 'Pandoc',           category: 'citation',    order: 8 },
} as const satisfies Record<string, { id: string; label: string; category: ExportGroupCategory; order: number }>;

export type ExportGroupId = keyof typeof EXPORT_GROUPS;

export interface ExportGroupMeta {
  id: ExportGroupId;
  /** Menu item + dialog title ("Export as <label>"). */
  label: string;
  category: ExportGroupCategory;
  /** Sort order within the Export menu. */
  order: number;
}
