/**
 * Derive a type's declared properties from a note's frontmatter — the schema
 * half of "Save Note as Object Type" (the inverse of promotion). Pure so the
 * renderer can run it on the live editor buffer and unit tests need no IPC.
 *
 * Complements "Save as Template" (which captures a note's BODY structure): this
 * captures its PROPERTY shape. The body is intentionally NOT baked into the type
 * so new instances start from a clean scaffold, not one note's prose.
 */
import type { PropertyDef, PropertyType } from './type-def';

/** Reserved frontmatter keys that are never modeled as type properties. */
const RESERVED = new Set(['title', 'tags', 'type', 'aliases', 'publish']);

/** Best-effort property type from a frontmatter value's shape (#save-as-type).
 *  Conservative — falls back to `text`, which is always safe to widen later. */
export function inferPropertyType(value: string): PropertyType {
  const v = value.trim();
  if (/^\[\[.*\]\]$/.test(v)) return 'link-to-type';
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(v)) return 'date';
  return 'text';
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Turn a note's frontmatter (key → display-string, from `getFrontmatterValues`)
 * into declared properties, skipping the reserved keys. Order is preserved so
 * the generated type reads like the note that seeded it.
 */
export function deriveTypeProperties(frontmatter: Record<string, string>): PropertyDef[] {
  const out: PropertyDef[] = [];
  for (const [name, value] of Object.entries(frontmatter)) {
    if (RESERVED.has(name)) continue;
    out.push({ name, type: inferPropertyType(value), label: titleCase(name) });
  }
  return out;
}
