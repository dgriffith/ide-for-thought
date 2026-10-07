/**
 * Patch a single frontmatter key in a note's content, and read current values,
 * for the typed-property form (#1066). Edits round-trip through the YAML parser
 * so the body, other keys, and comments survive — the form is a view over
 * frontmatter, never a separate store (the vision's central hazard: YAML is the
 * storage, never the interface).
 */
import YAML from 'yaml';
import { ownRecord } from './own-record';
import { editNoteText, findFrontmatter } from './frontmatter-block';

/** Display string for a scalar YAML value (Date → `YYYY-MM-DD`); non-scalars → ''. */
function toDisplay(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return ''; // null, objects, arrays — no editable scalar
}

/** Current frontmatter values as a `key → display string` map. Empty if there's
 *  no (or malformed) frontmatter. Non-scalar values become ''. A null-prototype
 *  record (keys are user text — a `__proto__:` key must survive, and an absent
 *  `constructor` must read as undefined); read by key through `getOwn`. */
export function getFrontmatterValues(content: string): Record<string, string> {
  const block = findFrontmatter(content);
  if (!block) return ownRecord([]);
  let parsed: unknown;
  try {
    parsed = YAML.parse(block.yaml);
  } catch {
    return ownRecord([]);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return ownRecord([]);
  return ownRecord(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, toDisplay(v)] as const));
}

/**
 * Set (or clear) one frontmatter key, returning the new content. An empty-string
 * / null value keeps the key present but empty (`key:`) — matching the scaffold,
 * so a form field the user clears doesn't drop out of the schema. Refuses to
 * touch malformed frontmatter (returns content unchanged) so a WIP isn't lost.
 * Keeps the note's line endings and byte-order mark (#2690).
 */
export function setFrontmatterProperty(content: string, key: string, value: string | number | null): string {
  return editNoteText(content, (text) => setInText(text, key, value));
}

function setInText(content: string, key: string, value: string | number | null): string {
  const clear = value === '' || value === null;
  const block = findFrontmatter(content);
  if (!block) {
    if (clear) return content; // nothing to clear
    const doc = new YAML.Document({});
    doc.set(key, value);
    return `---\n${doc.toString().trimEnd()}\n---\n${content}`;
  }
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(block.yaml);
    if (doc.errors.length > 0) return content;
  } catch {
    return content;
  }
  if (clear) doc.delete(key);
  else doc.set(key, value);

  const body = content.slice(block.end);
  // A cleared last key would leave an empty `---\n\n---` block — drop it instead.
  if (YAML.isMap(doc.contents) && doc.contents.items.length === 0) return body;

  let serialised = doc.toString();
  if (serialised.endsWith('\n')) serialised = serialised.slice(0, -1);
  return `---\n${serialised}\n---\n${body}`;
}
