/**
 * A typed note a `NoteHoverPreview` shows a properties strip for (#2710): the
 * type's `card:` fields, chosen by `selectInstanceCardFields`.
 */
import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../../shared/objects/type-def';

export interface HoverInstance {
  type: TypeInfo;
  properties: readonly PropertyDef[];
  inst: TypeInstanceRow;
  /** The note's own type, for the title's icon (a subtype instance's). */
  rowType?: TypeInfo | null;
  /** How a value reads; `displayPropertyValue` when absent. */
  display?: (prop: PropertyDef, value: string | null) => string;
  /** As `selectInstanceCardFields`: the view's visible properties, and ones the context already shows. */
  visible?: readonly string[] | null;
  omit?: readonly string[];
}
