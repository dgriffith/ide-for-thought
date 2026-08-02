/**
 * Write a user object-type definition ("Save Note as Object Type") — the only
 * type WRITE path (loader.ts is read-only). Serializes a `TypeDef` to the same
 * `.minerva/types/<id>.md` format `parse.ts` reads, so it travels with the
 * thoughtbase and the loader picks it up. Mirrors notebase/templates.saveTemplate.
 */
import YAML from 'yaml';
import * as notebaseFs from '../notebase/fs';
import type { PropertyDef } from '../../shared/objects/type-def';

export interface SaveTypeInput {
  label: string;
  /** Stable id when EDITING an existing type — keeps the file/class id fixed
   *  while the display label changes (#1585). Omit for a new type (id is
   *  derived from the label). */
  id?: string | undefined;
  properties: PropertyDef[];
  icon?: string | undefined;
  color?: string | undefined;
  cover?: string | undefined;
  card?: string[] | undefined;
  /** Parent type id — materialized as `rdfs:subClassOf` (#1586). */
  parent?: string | undefined;
  /** Template body (markdown after the frontmatter) — carried for a faithful
   *  duplicate; "Save Note as Object Type" leaves it empty. */
  template?: string | undefined;
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Serialize to a type-definition markdown file (frontmatter only; the body —
 *  a template — is left for the user to add, so instances aren't seeded with one
 *  note's prose). Pure; exposed for tests. */
export function serializeTypeFile(id: string, input: SaveTypeInput): string {
  const fm: Record<string, unknown> = { label: input.label, id };
  if (input.icon) fm.icon = input.icon;
  if (input.color) fm.color = input.color;
  if (input.cover) fm.cover = input.cover;
  if (input.card && input.card.length > 0) fm.card = input.card;
  if (input.parent) fm.parent = input.parent;
  fm.properties = input.properties.map((p) => {
    const o: Record<string, unknown> = { name: p.name, type: p.type };
    if (p.label) o.label = p.label;
    if (p.options && p.options.length > 0) o.options = p.options;
    if (p.targetType) o.targetType = p.targetType;
    return o;
  });
  const body = input.template?.trim();
  return `---\n${YAML.stringify(fm)}---\n${body ? `\n${body}\n` : ''}`;
}

/**
 * Write `.minerva/types/<id>.md` from a derived type. Overwrites an existing
 * user type of the same id (idempotent re-save). Returns the id + path. The
 * caller reloads the graph's type catalog so the new type is usable at once.
 */
export async function saveType(rootPath: string, input: SaveTypeInput): Promise<{ id: string; filePath: string }> {
  // Editing keeps the original id (label is free to change); a new type derives
  // its id from the label.
  const id = (input.id && slugify(input.id)) || slugify(input.label);
  if (!id) throw new Error('Type name is empty');
  const filePath = `.minerva/types/${id}.md`;
  await notebaseFs.writeFile(rootPath, filePath, serializeTypeFile(id, input));
  return { id, filePath };
}

/** Delete a USER type by id (removes `.minerva/types/<id>.md`). A no-op for a
 *  stock-only id (stock types live in the bundle, not the thoughtbase). */
export async function deleteType(rootPath: string, id: string): Promise<void> {
  const cleaned = slugify(id);
  if (!cleaned) return;
  await notebaseFs.deleteFile(rootPath, `.minerva/types/${cleaned}.md`).catch(() => { /* already gone / stock-only */ });
}
