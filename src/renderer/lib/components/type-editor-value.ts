/**
 * The value the type editor (#1585) opens with — a blank type (New), an existing
 * type (Edit), or a note-derived draft ("Save Note as Object Type"). Kept in a
 * plain module so both the dialog and its hosts can import it as a type.
 */
import { fillPropertyPlaceholders } from '../../../shared/objects/property-placeholders';
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
  /** External class CURIE (#2036, e.g. `foaf:Person`) — advanced/optional. */
  externalClass?: string;
  properties: PropertyDef[];
  template?: string;
  /**
   * Set when editing a stock-derived type — `'stock'` for one with no local
   * copy yet, `'customized'` for one already overridden in this thoughtbase.
   * Absent for a wholly user-authored type.
   *
   * Two effects: `'stock'` warns that saving forks a local copy (otherwise
   * "Edit" reads as editing the bundle itself), and BOTH lock the Name. A
   * stock type's name is fixed the same way its id is — the Type Manager
   * refuses to rename one, so letting the dialog change its label anyway just
   * contradicted itself.
   */
  stockOrigin?: 'stock' | 'customized';
}

/** A type's optional carry-over fields (icon / color / cover / card / parent /
 *  template / externalClass), spread only when set. Shared by the Type
 *  Manager's Edit and Duplicate paths so a newly-added optional type field
 *  can't be threaded into one and missed by the other — the exact gap
 *  `parent` nearly fell into in #1587 (#1603), and `externalClass` nearly
 *  fell into when #2036 added it without updating this list. */
export function optionalTypeFields(
  t: TypeInfo,
): {
  icon?: string; color?: string; cover?: string; card?: string[]; parent?: string;
  template?: string; externalClass?: string;
} {
  return {
    ...(t.icon ? { icon: t.icon } : {}),
    ...(t.color ? { color: t.color } : {}),
    ...(t.cover ? { cover: t.cover } : {}),
    ...(t.card ? { card: t.card } : {}),
    ...(t.parent ? { parent: t.parent } : {}),
    ...(t.template ? { template: t.template } : {}),
    ...(t.externalClass ? { externalClass: t.externalClass } : {}),
  };
}

// ── Default body editing (#2493) ───────────────────────────────────────────

/** Built-in placeholders offered as chips beside the property ones. */
export const TEMPLATE_BUILTIN_CHIPS = ['title', 'date', 'cursor'] as const;

/**
 * The property names a type's default body may use as `{{name}}`: the parent's
 * effective properties (inherited, #2494) then this type's own, de-duplicated
 * in that order — the same set the fill uses.
 */
export function templatePropertyNames(ownNames: readonly string[], parentEffectiveNames: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const n of [...parentEffectiveNames, ...ownNames]) if (n && !out.includes(n)) out.push(n);
  return out;
}

/** Insert `{{name}}` at a textarea selection; returns the new text and caret. */
export function insertPlaceholder(text: string, start: number, end: number, name: string): { text: string; caret: number } {
  const token = '{' + '{' + name + '}' + '}';
  return { text: text.slice(0, start) + token + text.slice(end), caret: start + token.length };
}

/**
 * How a new note of this type would start — the first few non-empty lines, with
 * `{{title}}` shown as the type's name, built-in dates as today, and each
 * property placeholder as a visible `‹name›` sample (a real note fills these
 * from its values, or keeps the placeholder until it has one).
 */
export function templatePreview(body: string, typeLabel: string, propertyNames: readonly string[], now = new Date()): string[] {
  const samples: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const n of propertyNames) samples[n] = `‹${n}›`;
  const today = now.toISOString().slice(0, 10);
  const filled = fillPropertyPlaceholders(body, samples, propertyNames)
    .replace(/\{\{\s*title\s*\}\}/g, `New ${typeLabel || 'note'}`)
    .replace(/\{\{\s*date(?::[^}]*)?\s*\}\}/g, today)
    .replace(/\{\{\s*cursor\s*\}\}/g, '');
  return filled.split('\n').filter((l) => l.trim() !== '').slice(0, 4);
}
