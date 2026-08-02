/**
 * The value the type editor (#1585) opens with — a blank type (New), an existing
 * type (Edit), or a note-derived draft ("Save Note as Object Type"). Kept in a
 * plain module so both the dialog and its hosts can import it as a type.
 */
import type { PropertyDef } from '../../../shared/objects/type-def';

export interface TypeEditorInitial {
  /** Set when editing — the id stays fixed while the label may change. */
  id?: string;
  label: string;
  icon?: string;
  color?: string;
  cover?: string;
  card?: string[];
  properties: PropertyDef[];
  template?: string;
}
