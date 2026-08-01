/**
 * Patch a single frontmatter key in a note's content, and read current values,
 * for the typed-property form (#1066). Edits round-trip through the YAML parser
 * so the body, other keys, and comments survive — the form is a view over
 * frontmatter, never a separate store (the vision's central hazard: YAML is the
 * storage, never the interface).
 */
import YAML from 'yaml';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Display string for a scalar YAML value (Date → `YYYY-MM-DD`); non-scalars → ''. */
function toDisplay(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return ''; // null, objects, arrays — no editable scalar
}

/** Current frontmatter values as a `key → display string` map. Empty if there's
 *  no (or malformed) frontmatter. Non-scalar values become ''. */
export function getFrontmatterValues(content: string): Record<string, string> {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return {};
  let parsed: unknown;
  try {
    parsed = YAML.parse(m[1]!);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[k] = toDisplay(v);
  }
  return out;
}

/**
 * Set (or clear) one frontmatter key, returning the new content. An empty-string
 * / null value keeps the key present but empty (`key:`) — matching the scaffold,
 * so a form field the user clears doesn't drop out of the schema. Refuses to
 * touch malformed frontmatter (returns content unchanged) so a WIP isn't lost.
 */
export function setFrontmatterProperty(content: string, key: string, value: string | number | null): string {
  const clear = value === '' || value === null;
  const m = content.match(FRONTMATTER_RE);
  if (!m) {
    if (clear) return content; // nothing to clear
    const doc = new YAML.Document({});
    doc.set(key, value);
    return `---\n${doc.toString().trimEnd()}\n---\n${content}`;
  }
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(m[1]!);
    if (doc.errors.length > 0) return content;
  } catch {
    return content;
  }
  if (clear) doc.delete(key);
  else doc.set(key, value);

  const body = content.slice(m[0].length);
  // A cleared last key would leave an empty `---\n\n---` block — drop it instead.
  if (YAML.isMap(doc.contents) && doc.contents.items.length === 0) return body;

  let serialised = doc.toString();
  if (serialised.endsWith('\n')) serialised = serialised.slice(0, -1);
  return `---\n${serialised}\n---\n${body}`;
}
