/**
 * Typed-objects registry shapes (#1062, epic #1060 — Typed Objects).
 *
 * A "type" (Book, Person, Meeting, …) is declared once — a label, a set of
 * expected properties, an optional template body, an optional icon/color — and
 * compiles into the graph as an ontology class. Renderer-safe: no main-process
 * imports, so pickers/forms can consume `TypeInfo` over IPC.
 *
 * See docs/vision/objects.md for the resolved design decisions this encodes:
 * a typed object is a Note with an extra `rdf:type`; user types live in-tree at
 * `.minerva/types/*.md`; stock types are bundled.
 */

/** The MVP five property types (decision 4). Deferred: computed, multi-value, units. */
export const PROPERTY_TYPES = ['text', 'date', 'number', 'enum', 'link-to-type'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface PropertyDef {
  /** Frontmatter key this property is stored under (e.g. `author`). */
  name: string;
  type: PropertyType;
  /** Human label for the form; defaults to a title-cased `name`. */
  label?: string | undefined;
  /** enum only — the allowed values (validated-but-not-enforced). */
  options?: string[] | undefined;
  /** link-to-type only — the target type id (e.g. `person`). Seed for #1073. */
  targetType?: string | undefined;
}

export type TypeSource = 'stock' | 'user';

/** A fully-loaded type definition (main process). */
export interface TypeDef {
  /** Slug matched against a note's `type:` frontmatter (e.g. `book`). */
  id: string;
  label: string;
  /** PascalCase local name for the ontology class IRI (`types:Book`). */
  classLocalName: string;
  properties: PropertyDef[];
  /** Optional template body inserted on instantiation (#1064). */
  template?: string | undefined;
  icon?: string | undefined;
  color?: string | undefined;
  /** Property name whose value is the gallery card's cover image (#1070). */
  cover?: string | undefined;
  /** Ordered property names shown on the type-keyed render card (link cards,
   *  hovers, preview) — the card "template" (#1071). Empty/absent → a default
   *  derived from the first few declared properties. */
  card?: string[] | undefined;
  /** Parent type id — materialized as `rdfs:subClassOf` so instances of this
   *  type also count as the parent (#1586). Single inheritance for v1. */
  parent?: string | undefined;
  source: TypeSource;
  /** Absolute path for user types; the glob key for stock types. */
  filePath: string;
}

/** Serializable metadata sent to the renderer over IPC. Carries the template
 *  body (a plain note scaffold, unlike a skill's LLM-prompt body) so the type
 *  picker (#1064) / inline creation (#1065) can instantiate without a round-trip. */
export interface TypeInfo {
  id: string;
  label: string;
  classLocalName: string;
  properties: PropertyDef[];
  template?: string | undefined;
  icon?: string | undefined;
  color?: string | undefined;
  /** Property name whose value is the gallery card's cover image (#1070). */
  cover?: string | undefined;
  /** Ordered property names shown on the type-keyed render card (link cards,
   *  hovers, preview) — the card "template" (#1071). Empty/absent → a default
   *  derived from the first few declared properties. */
  card?: string[] | undefined;
  /** Parent type id — materialized as `rdfs:subClassOf` so instances of this
   *  type also count as the parent (#1586). Single inheritance for v1. */
  parent?: string | undefined;
  source: TypeSource;
}

export interface TypeLoadError {
  source: TypeSource;
  /** File path or glob key the error came from. */
  filePath: string;
  /** Best-effort type label/id if it parsed far enough; else the filename. */
  label: string;
  message: string;
}

export interface TypeCatalog {
  types: TypeDef[];
  errors: TypeLoadError[];
}

export interface TypeCatalogInfo {
  types: TypeInfo[];
  errors: TypeLoadError[];
}

export function toTypeInfo(t: TypeDef): TypeInfo {
  return {
    id: t.id,
    label: t.label,
    classLocalName: t.classLocalName,
    properties: t.properties,
    template: t.template,
    icon: t.icon,
    color: t.color,
    cover: t.cover,
    card: t.card,
    parent: t.parent,
    source: t.source,
  };
}

export const EMPTY_TYPE_CATALOG: TypeCatalog = { types: [], errors: [] };

/** One declared property of a typed note, with its current value (#1063). Used
 *  by the property form (#1066) and type-keyed renderers (#1071). */
export interface NoteTypedPropertyValue {
  name: string;
  type: PropertyType;
  label?: string | undefined;
  options?: string[] | undefined;
  targetType?: string | undefined;
  /** Lexical value from the graph (e.g. `"5"`, `"2020-01-01"`, a target IRI),
   *  or null when the note doesn't set this declared property. */
  value: string | null;
}

/** A note's typed properties, keyed to its type's declared schema (#1063). */
export interface NoteTypedProperties {
  /** The note's type, or null when it has none / an unknown one. */
  type: TypeInfo | null;
  /** Every property the type declares, including ones the note leaves empty. */
  properties: NoteTypedPropertyValue[];
}

/** One instance of a type — a typed note, with its declared property values
 *  projected as columns for the multi-view (#1070). Values are the same lexical
 *  strings the property read-back (#1063) returns; null when the note leaves a
 *  declared property empty. */
export interface TypeInstanceRow {
  /** The note's project-relative path (the row's identity + deep-link target). */
  path: string;
  title: string;
  /** Declared-property values keyed by property `name` (every declared property
   *  present; null where the note doesn't set it). */
  values: Record<string, string | null>;
  /** The designated cover property's value, or null — for the gallery (#1070). */
  cover: string | null;
}

/** A type plus all its instances, for the list/table/gallery multi-view (#1070). */
export interface TypeInstancesResult {
  /** The resolved type (its declared properties are the table columns), or null
   *  when the id doesn't match a loaded type. */
  type: TypeInfo | null;
  instances: TypeInstanceRow[];
}

/** `article-source` → `ArticleSource`; used for the ontology class local name. */
export function pascalCase(id: string): string {
  return id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** `first_name` → `First Name`. The default human label for a property whose
 *  definition omits an explicit `label:` — shared so the parser's default and
 *  the type editor's "is this label a real custom value?" check can't diverge. */
export function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
