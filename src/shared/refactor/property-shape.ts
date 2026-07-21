/**
 * Scalar frontmatter-property types shared by the Properties panel and the
 * "Add Property" dialog (#471 follow-up). Both surfaces present the same
 * type-aware value editors, so the type list + the text↔typed-value coercion
 * live here rather than being duplicated per surface.
 *
 * Scope is deliberately the four *scalars* — richer shapes (string lists,
 * wiki-links, arbitrary YAML) stay panel-only for now. A value's JS type is
 * what the YAML serializer keys off, so a real boolean `false` (not the string
 * `"false"`) round-trips as `key: false`.
 */

export type ScalarType = 'string' | 'number' | 'boolean' | 'date';

export const SCALAR_TYPES: readonly ScalarType[] = ['string', 'number', 'boolean', 'date'];

export function isScalarType(kind: string): kind is ScalarType {
  return (SCALAR_TYPES as readonly string[]).includes(kind);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce a raw text representation into the JS value for `type`. Used both
 * when the "Add Property" dialog confirms and when a Properties-panel row is
 * switched from one type to another (the current value is stringified, then
 * re-coerced to the new type).
 *
 *   - string  → the text unchanged
 *   - number  → the parsed number, or 0 when the text isn't a finite number
 *   - boolean → true only for true/yes/on/1 (case-insensitive); else false
 *   - date    → the text if it's already `YYYY-MM-DD`, else '' (empty date)
 */
export function coerceScalar(type: ScalarType, raw: string): string | number | boolean {
  const text = raw.trim();
  switch (type) {
    case 'string':
      return raw;
    case 'number': {
      const n = Number(text);
      return text !== '' && Number.isFinite(n) ? n : 0;
    }
    case 'boolean':
      return /^(true|yes|on|1)$/i.test(text);
    case 'date':
      return DATE_RE.test(text) ? text : '';
  }
}

/** Render a JS scalar value as the seed text for a type-switch or an editor. */
export function scalarToText(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return '';
}

/**
 * Whether `raw` is an acceptable value for `type` in the Add-Property dialog.
 * Only `number` is gated — an empty or non-numeric entry can't become a
 * number, so the dialog blocks confirmation rather than silently writing 0.
 * The other types always have a sensible reading of any text.
 */
export function isValidScalar(type: ScalarType, raw: string): boolean {
  if (type !== 'number') return true;
  const text = raw.trim();
  return text !== '' && Number.isFinite(Number(text));
}
