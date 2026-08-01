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
  properties: PropertyDef[];
  icon?: string | undefined;
  color?: string | undefined;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Serialize to a type-definition markdown file (frontmatter only; the body —
 *  a template — is left for the user to add, so instances aren't seeded with one
 *  note's prose). Pure; exposed for tests. */
export function serializeTypeFile(id: string, input: SaveTypeInput): string {
  const fm: Record<string, unknown> = { label: input.label, id };
  if (input.icon) fm.icon = input.icon;
  if (input.color) fm.color = input.color;
  fm.properties = input.properties.map((p) => {
    const o: Record<string, unknown> = { name: p.name, type: p.type };
    if (p.label) o.label = p.label;
    if (p.options && p.options.length > 0) o.options = p.options;
    if (p.targetType) o.targetType = p.targetType;
    return o;
  });
  return `---\n${YAML.stringify(fm)}---\n`;
}

/**
 * Write `.minerva/types/<id>.md` from a derived type. Overwrites an existing
 * user type of the same id (idempotent re-save). Returns the id + path. The
 * caller reloads the graph's type catalog so the new type is usable at once.
 */
export async function saveType(rootPath: string, input: SaveTypeInput): Promise<{ id: string; filePath: string }> {
  const id = slugify(input.label);
  if (!id) throw new Error('Type name is empty');
  const filePath = `.minerva/types/${id}.md`;
  await notebaseFs.writeFile(rootPath, filePath, serializeTypeFile(id, input));
  return { id, filePath };
}
