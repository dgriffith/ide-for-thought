/**
 * Property placeholders in an object type's default body (#2490, epic #2489).
 *
 * A type's template can name its properties — `Address: {{address}}` — and a
 * placeholder whose property has a value is replaced by it. One without a value
 * stays literally `{{address}}` (unknown placeholders already survive
 * `substituteTemplate`), so it can be filled later, when the property is set
 * (#2491) or by the LLM path (#2492). This module is the ONE rule all three
 * use, so creation, editing and the model can't disagree about what fills.
 *
 * Syntax:
 *   {{name}}        — a declared property, unless `name` is a built-in
 *                     placeholder (title, date, time, cursor, selection), which wins
 *   {{prop:name}}   — always the property; the escape hatch for a type that
 *                     declares, say, a `date` property
 *
 * Fill once, don't bind: a filled placeholder becomes ordinary text, and later
 * property changes never rewrite it — only placeholders still present literally
 * are ever filled. `\{{` stays an escaped literal.
 *
 * Pure and Node-free (`src/shared` is lint-enforced pure).
 */

/** Placeholder names `substituteTemplate` owns. A bare `{{date}}` is the date,
 *  not a `date` property — use `{{prop:date}}` for that. */
export const BUILTIN_PLACEHOLDERS: ReadonlySet<string> = new Set(['title', 'date', 'time', 'cursor', 'selection']);

/**
 * The property a placeholder expression names, or `null` when it names none of
 * `propertyNames` (a built-in, a `date:FMT`/`prompt:` form, or an unknown word).
 */
export function propertyPlaceholderName(expr: string, propertyNames: ReadonlySet<string>): string | null {
  const e = expr.trim();
  if (e.startsWith('prop:')) {
    const name = e.slice(5).trim();
    return propertyNames.has(name) ? name : null;
  }
  if (BUILTIN_PLACEHOLDERS.has(e) || e.includes(':')) return null;
  return propertyNames.has(e) ? e : null;
}

/**
 * A frontmatter value as body text, or `null` when there's nothing to fill
 * (missing, empty, or a shape with no sensible inline form).
 */
export function renderPropertyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (Array.isArray(value)) {
    const parts = value.map(renderPropertyValue).filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return null; // a nested object has no inline form; leave the placeholder
}

/**
 * Replace every property placeholder in `body` whose property has a value.
 * Everything else — built-ins, unknown placeholders, `\{{` escapes, ordinary
 * text — is left exactly as it was. Returns the body unchanged (same string)
 * when nothing filled, so callers can cheaply tell whether to write.
 */
export function fillPropertyPlaceholders(
  body: string,
  values: Readonly<Record<string, unknown>>,
  propertyNames: Iterable<string>,
): string {
  const names = new Set(propertyNames);
  if (names.size === 0 || !body.includes('{{')) return body;
  let out = '';
  let i = 0;
  let changed = false;
  while (i < body.length) {
    if (body[i] === '\\' && body.startsWith('{{', i + 1)) {
      out += '\\{{';
      i += 3;
      continue;
    }
    if (body.startsWith('{{', i)) {
      const close = body.indexOf('}}', i + 2);
      if (close < 0) { out += body.slice(i); break; }
      const name = propertyPlaceholderName(body.slice(i + 2, close), names);
      const text = name === null ? null : renderPropertyValue(values[name]);
      if (text !== null) {
        out += text;
        changed = true;
      } else {
        out += body.slice(i, close + 2);
      }
      i = close + 2;
      continue;
    }
    out += body[i];
    i++;
  }
  return changed ? out : body;
}
