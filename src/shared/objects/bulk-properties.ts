/**
 * Type-aware bulk property editing (#2431) — the pure half.
 *
 * Two jobs, both renderer-safe and IPC-free so they're unit-testable:
 *
 *  1. `buildBulkFieldModel` reads N notes (content + resolved type) and decides
 *     what the "Edit properties…" panel shows: a shared type's declared schema,
 *     or for mixed types the intersection of their properties — plus title,
 *     aliases and tags either way — each with its current value, or `mixed`
 *     when the notes disagree.
 *  2. `applyBulkEdits` writes ONLY the fields the user touched into one note's
 *     frontmatter, through the same YAML-document round-trip the Properties
 *     panel uses (`applyFrontmatterMutation`), so comments, key order and every
 *     untouched key survive. An edit that changes nothing returns the content
 *     byte-identical — no frontmatter churn on a note that already had the
 *     value.
 */
import YAML from 'yaml';
import { detectShape, parseFrontmatter, type ValueShape } from '../refactor/frontmatter-rows';
import { editNote } from '../frontmatter-block';
import { spliceFrontmatter } from '../refactor/frontmatter-splice';
import type { PropertyDef, TypeInfo } from './type-def';

/** One selected note, as the model builder needs it. */
export interface BulkNoteInput {
  path: string;
  content: string;
  /** The note's resolved type, or null when it has none / an unknown one. */
  type: TypeInfo | null;
}

/** A value present on some of the selection, with how many notes carry it. */
export interface BulkListItem {
  value: string;
  count: number;
}

export interface BulkField {
  /** Frontmatter key. */
  name: string;
  label: string;
  /** Drives the widget: a declared property, or a synthetic one for title. */
  def: PropertyDef;
  /** `scalar` → one value per note; `list` → add/remove ops (tags, aliases,
   *  link-to-type). */
  kind: 'scalar' | 'list';
  /** `schema` → declared by the type(s); `common` → title / aliases / tags. */
  section: 'schema' | 'common';
  /** scalar: the value every note shares, '' when none sets it. */
  value: string;
  /** scalar: the notes disagree (or one holds a shape the widget can't show). */
  mixed: boolean;
  /** list: every value present anywhere in the selection. */
  items: BulkListItem[];
}

export interface BulkFieldModel {
  total: number;
  /** Set when every note has the same type. */
  sharedType: TypeInfo | null;
  /** Distinct type labels in the selection, untyped notes excluded. */
  typeLabels: string[];
  /** True when at least one note has no type (so there is no schema intersection). */
  hasUntyped: boolean;
  fields: BulkField[];
  /** Every other frontmatter key present on the selection, for removal. */
  otherKeys: BulkListItem[];
  /** Notes whose frontmatter didn't parse: shown, never written. */
  unparseable: string[];
}

/** Keys the panel handles itself (or that must never be bulk-edited). */
const COMMON_KEYS = ['title', 'aliases', 'tags'] as const;
const RESERVED_KEYS = new Set<string>([...COMMON_KEYS, 'type']);

const TITLE_DEF: PropertyDef = { name: 'title', type: 'text', label: 'Title' };
const ALIASES_DEF: PropertyDef = { name: 'aliases', type: 'text', label: 'Aliases' };
const TAGS_DEF: PropertyDef = { name: 'tags', type: 'text', label: 'Tags' };

function labelOf(def: PropertyDef): string {
  return def.label ?? def.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Text a scalar widget can show for `shape`, or undefined when it can't. */
export function scalarTextOf(shape: ValueShape): string | undefined {
  switch (shape.kind) {
    case 'string': return shape.value;
    case 'number': return String(shape.value);
    case 'boolean': return String(shape.value);
    case 'date': return shape.value;
    case 'wiki-link': return shape.raw;
    default: return undefined;
  }
}

/** The values a list field reads from `shape` — a scalar counts as a list of one. */
export function listValuesOf(shape: ValueShape | undefined): string[] {
  if (!shape) return [];
  if (shape.kind === 'string-list') return shape.value;
  if (shape.kind === 'wiki-link') return [shape.raw];
  if (shape.kind === 'string') return shape.value.trim() === '' ? [] : [shape.value];
  return [];
}

/** Whether a declared property is edited as a list (add/remove), not a value. */
function isListDef(def: PropertyDef): boolean {
  return def.type === 'link-to-type';
}

/**
 * Decide the fields for a selection. `defsFor` returns a type's effective
 * (own + inherited) declared properties — the caller owns the catalog.
 */
export function buildBulkFieldModel(
  notes: readonly BulkNoteInput[],
  defsFor: (type: TypeInfo) => PropertyDef[],
): BulkFieldModel {
  const unparseable: string[] = [];
  const shapesByNote: Map<string, ValueShape>[] = [];
  for (const n of notes) {
    const parsed = parseFrontmatter(n.content);
    const shapes = new Map<string, ValueShape>();
    if (!parsed.ok) unparseable.push(n.path);
    else for (const row of parsed.rows) shapes.set(row.key, row.shape);
    shapesByNote.push(shapes);
  }

  const typed = notes.filter((n) => n.type !== null);
  const hasUntyped = typed.length < notes.length;
  const typeIds = [...new Set(typed.map((n) => n.type!.id))];
  const typeLabels = [...new Set(typed.map((n) => n.type!.label))];
  const sharedType = !hasUntyped && typeIds.length === 1 ? notes[0]!.type : null;

  // Schema: the shared type's properties, or the intersection of every note's
  // type's properties — by name AND property type, since one widget has to
  // write a value both schemas accept.
  let schemaDefs: PropertyDef[] = [];
  if (notes.length > 0 && !hasUntyped) {
    const perType = typeIds.map((id) => defsFor(typed.find((n) => n.type!.id === id)!.type!));
    schemaDefs = perType[0]!.filter((d) =>
      perType.every((defs) => defs.some((o) => o.name === d.name && o.type === d.type)));
  }
  schemaDefs = schemaDefs.filter((d) => !RESERVED_KEYS.has(d.name));

  const fieldFor = (def: PropertyDef, section: BulkField['section'], list: boolean): BulkField => {
    if (list) {
      const counts = new Map<string, number>();
      for (const shapes of shapesByNote) {
        for (const v of new Set(listValuesOf(shapes.get(def.name)))) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return {
        name: def.name, label: labelOf(def), def, kind: 'list', section,
        value: '', mixed: false, items: [...counts].map(([value, count]) => ({ value, count })),
      };
    }
    const texts = shapesByNote.map((shapes) => {
      const shape = shapes.get(def.name);
      return shape ? scalarTextOf(shape) : '';
    });
    const first = texts[0];
    const mixed = texts.some((t) => t === undefined || t !== first);
    return {
      name: def.name, label: labelOf(def), def, kind: 'scalar', section,
      value: mixed ? '' : (first ?? ''), mixed, items: [],
    };
  };

  const fields: BulkField[] = [
    ...schemaDefs.map((d) => fieldFor(d, 'schema', isListDef(d))),
    fieldFor(TITLE_DEF, 'common', false),
    fieldFor(ALIASES_DEF, 'common', true),
    fieldFor(TAGS_DEF, 'common', true),
  ];

  const shown = new Set([...fields.map((f) => f.name), 'type']);
  const otherCounts = new Map<string, number>();
  for (const shapes of shapesByNote) {
    for (const key of shapes.keys()) if (!shown.has(key)) otherCounts.set(key, (otherCounts.get(key) ?? 0) + 1);
  }
  const otherKeys = [...otherCounts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));

  return { total: notes.length, sharedType, typeLabels, hasUntyped, fields, otherKeys, unparseable };
}

// ── Edits ─────────────────────────────────────────────────────────────

export type BulkScalar = string | number | boolean;

/** One touched field. Only these reach a note — untouched fields aren't edits. */
export type BulkEdit =
  | { op: 'set'; key: string; value: BulkScalar }
  | { op: 'clear'; key: string }
  | {
      op: 'list';
      key: string;
      add: string[];
      remove: string[];
      /** `tags`: lower-cased, matched case-insensitively. `link`: `[[…]]`
       *  values, one link stays a scalar. `plain`: everything else (aliases). */
      style: 'tags' | 'link' | 'plain';
    };

/**
 * The edit a scalar widget's raw text means for `def`. Empty → clear the key
 * (the field still renders: the type declares it). `null` → the text can't be
 * that type (a non-numeric number), so nothing is written.
 */
export function scalarEditFor(def: PropertyDef, raw: string): BulkEdit | null {
  const text = raw.trim();
  if (text === '') return { op: 'clear', key: def.name };
  switch (def.type) {
    case 'number': {
      const n = Number(text);
      return Number.isFinite(n) ? { op: 'set', key: def.name, value: n } : null;
    }
    case 'boolean':
      return { op: 'set', key: def.name, value: /^(true|yes|on|1)$/i.test(text) };
    case 'date':
    case 'datetime': // as written: a partial `1969` stays `1969` (#2613)
      return { op: 'set', key: def.name, value: text };
    default:
      return { op: 'set', key: def.name, value: raw };
  }
}

/** `[[Target|shown]]` → `target`, for matching links regardless of display text / case. */
function linkKey(v: string): string {
  const m = /^\[\[([^|\]]*)(?:\|[^\]]*)?\]\]$/.exec(v.trim());
  return (m ? m[1]! : v).trim().toLowerCase();
}

export function normalizeListValue(style: 'tags' | 'link' | 'plain', raw: string): string {
  const v = raw.trim();
  if (style === 'tags') return v.replace(/^#/, '').toLowerCase();
  if (style === 'link') return /^\[\[.*\]\]$/.test(v) ? v : `[[${v}]]`;
  return v;
}

function matchKey(style: 'tags' | 'link' | 'plain', v: string): string {
  if (style === 'tags') return v.toLowerCase();
  if (style === 'link') return linkKey(v);
  return v;
}

/** The key's current values as a list (a scalar is a list of one). */
function currentList(doc: YAML.Document, key: string): string[] {
  const node = doc.get(key, true);
  if (node === undefined || node === null) return [];
  return listValuesOf(detectShape(node));
}

function applyOne(doc: YAML.Document, edit: BulkEdit): boolean {
  if (!YAML.isMap(doc.contents)) return false;
  const map = doc.contents;
  if (edit.op === 'clear') {
    if (!map.has(edit.key)) return false;
    map.delete(edit.key);
    return true;
  }
  if (edit.op === 'set') {
    const node = map.get(edit.key, true);
    if (YAML.isScalar(node) && node.value === edit.value) return false;
    // Reuse an existing scalar node, so a comment on it survives the edit.
    if (YAML.isScalar(node)) {
      node.value = edit.value;
      // Drop a quote style a typed value mustn't keep (`"false"` → `false`);
      // a string keeps its style, and the stringifier still quotes one that
      // would otherwise read back as another type.
      if (typeof edit.value !== 'string') delete node.type;
      return true;
    }
    map.set(edit.key, edit.value);
    return true;
  }
  const { key, style } = edit;
  const before = currentList(doc, key);
  const removing = new Set(edit.remove.map((v) => matchKey(style, normalizeListValue(style, v))));
  const kept = before.filter((v) => !removing.has(matchKey(style, v)));
  const seen = new Set(kept.map((v) => matchKey(style, v)));
  const added: string[] = [];
  for (const raw of edit.add) {
    const v = normalizeListValue(style, raw);
    if (v === '' || v === '[[]]' || seen.has(matchKey(style, v))) continue;
    seen.add(matchKey(style, v));
    added.push(v);
  }
  if (added.length === 0 && kept.length === before.length) return false;
  const next = [...kept, ...added];
  if (next.length === 0) { map.delete(key); return true; }
  if (style === 'link' && next.length === 1) { map.set(key, next[0]!); return true; }
  const node = map.get(key, true);
  if (YAML.isSeq(node)) {
    // Edit the existing sequence in place: kept items keep their node (and
    // style — a flow `[a, b]` stays flow), new ones are appended.
    node.items = node.items.filter((it) => !(YAML.isScalar(it) && typeof it.value === 'string' && removing.has(matchKey(style, it.value))));
    for (const v of added) node.add(doc.createNode(v));
    return true;
  }
  map.set(key, doc.createNode(next));
  return true;
}

export interface ApplyBulkResult {
  content: string;
  changed: boolean;
}

/**
 * Apply `edits` to one note. `null` when its frontmatter doesn't parse — the
 * caller reports it rather than overwriting the user's YAML.
 *
 * Only the touched keys' lines are rewritten (`spliceFrontmatter`, which grew
 * out of this function and now serves every frontmatter writer, #2737), so
 * every untouched key, comment and spacing quirk is byte-identical afterwards.
 * An edit set that changes nothing returns the input unchanged
 * (`changed: false`), so a note that already had every value is never
 * rewritten.
 *
 * `editNote` hands the splice LF text with no byte-order mark and maps the
 * result back, so a CRLF note stays CRLF (#2690).
 */
export function applyBulkEdits(content: string, edits: readonly BulkEdit[]): ApplyBulkResult | null {
  return editNote(content, (text) => applyBulkEditsToText(text, edits));
}

function applyBulkEditsToText(content: string, edits: readonly BulkEdit[]): ApplyBulkResult | null {
  const result = spliceFrontmatter(content, (doc) => {
    for (const e of edits) applyOne(doc, e);
  });
  if (!result) return null;
  return result.changedKeys.length > 0 ? { content: result.content, changed: true } : { content, changed: false };
}
