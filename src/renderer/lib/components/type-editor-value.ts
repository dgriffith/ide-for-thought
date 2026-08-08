/**
 * The value the type editor (#1585) opens with — a blank type (New), an existing
 * type (Edit), or a note-derived draft ("Save Note as Object Type"). Kept in a
 * plain module so both the dialog and its hosts can import it as a type.
 */
import type { PropertyDef, TypeInfo } from '../../../shared/objects/type-def';

export interface TypeEditorInitial {
  /** Set when editing — the id stays fixed while the label may change. */
  id?: string;
  label: string;
  icon?: string;
  color?: string;
  cover?: string;
  card?: string[];
  /** Parent type id (#1587) — the type this one specializes. */
  parent?: string;
  properties: PropertyDef[];
  template?: string;
  /** Editing a STOCK type that has no local copy yet. Saving will create one
   *  in `.minerva/types/`, shadowing the bundled definition — the dialog says
   *  so, since "Edit" otherwise reads as editing the bundle itself. */
  forksStock?: boolean;
}

/** A type's optional carry-over fields (icon / color / cover / card / parent /
 *  template), spread only when set. Shared by the Type Manager's Edit and
 *  Duplicate paths so a newly-added optional type field can't be threaded into
 *  one and missed by the other — the exact gap `parent` nearly fell into in
 *  #1587 (#1603). */
export function optionalTypeFields(
  t: TypeInfo,
): { icon?: string; color?: string; cover?: string; card?: string[]; parent?: string; template?: string } {
  return {
    ...(t.icon ? { icon: t.icon } : {}),
    ...(t.color ? { color: t.color } : {}),
    ...(t.cover ? { cover: t.cover } : {}),
    ...(t.card ? { card: t.card } : {}),
    ...(t.parent ? { parent: t.parent } : {}),
    ...(t.template ? { template: t.template } : {}),
  };
}
