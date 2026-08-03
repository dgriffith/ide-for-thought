/**
 * YAML frontmatter round-trip engine for the note Properties panel (#1596).
 *
 * Parses a note's leading `---` frontmatter block into typed rows, and applies
 * edits by mutating the YAML document and splicing the reserialized block back
 * into the note content by byte offset — preserving comments, key order, and the
 * body. Extracted from PropertiesPanel.svelte (a zero-test, data-loss-prone
 * surface) into this pure, unit-tested module, beside the property-shape helpers
 * it complements.
 */
import YAML from 'yaml';

export type ValueShape =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: string }
  | { kind: 'string-list'; value: string[] }
  | { kind: 'wiki-link'; target: string; display: string | null; raw: string }
  | { kind: 'yaml'; raw: string };

export interface Row {
  key: string;
  shape: ValueShape;
}

export interface ParseResult {
  ok: true;
  rows: Row[];
  /** Raw frontmatter block (between `---` fences, exclusive). */
  body: string;
  /** Index in `content` where the frontmatter block begins (`---\n`). */
  blockStart: number;
  /** Index in `content` where the frontmatter block ends (after the closing `---\n`). */
  blockEnd: number;
}

export interface ParseError {
  ok: false;
  error: string;
}

export interface NoFrontmatter {
  ok: true;
  rows: [];
  body: '';
  blockStart: 0;
  blockEnd: 0;
  none: true;
}

export function keyToString(k: unknown): string | null {
  if (YAML.isScalar(k)) return String(k.value);
  if (typeof k === 'string') return k;
  return null;
}

/** Matches a single `[[target]]` or `[[target|display]]` (un-typed)
 *  with no surrounding whitespace. Typed wiki-links (`type::target`)
 *  fall through to the plain-string editor — the picker only knows
 *  how to pick note paths. */
const WIKI_LINK_RE = /^\[\[([^|\]\n[]+)(?:\|([^\]\n]+))?\]\]$/;

export function detectShape(value: unknown): ValueShape {
  if (YAML.isScalar(value)) {
    const v = value.value;
    if (typeof v === 'boolean') return { kind: 'boolean', value: v };
    if (typeof v === 'number') return { kind: 'number', value: v };
    if (v instanceof Date) {
      return { kind: 'date', value: v.toISOString().slice(0, 10) };
    }
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { kind: 'date', value: v };
      const wl = v.match(WIKI_LINK_RE);
      if (wl) {
        return {
          kind: 'wiki-link',
          target: wl[1]!.trim(),
          display: wl[2]?.trim() ?? null,
          raw: v,
        };
      }
      return { kind: 'string', value: v };
    }
    // null, undefined, or an oddball scalar shape — treat as empty
    // string so the row is still editable. Bare `String(obj)` would
    // surface "[object Object]" so we go through JSON.
    if (v == null) return { kind: 'string', value: '' };
    return { kind: 'string', value: JSON.stringify(v) };
  }
  if (YAML.isSeq(value)) {
    const items = value.items;
    const stringValues: string[] = [];
    let allStrings = true;
    for (const it of items) {
      if (YAML.isScalar(it) && typeof it.value === 'string') {
        stringValues.push(it.value);
      } else {
        allStrings = false;
        break;
      }
    }
    if (allStrings) {
      return { kind: 'string-list', value: stringValues };
    }
    return { kind: 'yaml', raw: YAML.stringify(value).trimEnd() };
  }
  if (YAML.isMap(value)) {
    return { kind: 'yaml', raw: YAML.stringify(value).trimEnd() };
  }
  return { kind: 'yaml', raw: YAML.stringify(value).trimEnd() };
}

export function parseFrontmatter(text: string): ParseResult | ParseError | NoFrontmatter {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) {
    return { ok: true, rows: [], body: '', blockStart: 0, blockEnd: 0, none: true };
  }
  const body = m[1]!;
  const blockEnd = m[0].length;
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(body);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (doc.errors.length > 0) {
    return { ok: false, error: doc.errors[0]!.message };
  }
  if (!YAML.isMap(doc.contents)) {
    return { ok: false, error: 'Frontmatter is not a key/value map.' };
  }
  const out: Row[] = [];
  for (const pair of doc.contents.items) {
    const key = keyToString(pair.key);
    if (key === null) continue;
    const value = pair.value;
    out.push({ key, shape: detectShape(value) });
  }
  return { ok: true, rows: out, body, blockStart: 0, blockEnd };
}

/**
 * Apply a mutation to a note's frontmatter and return the new note content, or
 * `null` to no-op. Mutator runs inside a successfully-parsed YAML doc; if parsing
 * fails we return null rather than overwrite the user's work-in-progress. Three
 * cases: no frontmatter yet (build a fresh block), a deletion that empties the
 * map (drop the whole block, since `---\n\n---` reads as malformed), and the
 * normal splice-by-offset rewrite that preserves the note body.
 */
export function applyFrontmatterMutation(
  content: string,
  fn: (doc: YAML.Document) => void,
): string | null {
  const parsed = parseFrontmatter(content);
  if (!parsed.ok) return null;
  if ('none' in parsed) {
    const doc = new YAML.Document({});
    fn(doc);
    const yaml = doc.toString().trimEnd();
    return `---\n${yaml}\n---\n${content}`;
  }
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(parsed.body);
    if (doc.errors.length > 0) return null;
  } catch {
    return null;
  }
  fn(doc);
  let serialised = doc.toString();
  if (serialised.endsWith('\n')) serialised = serialised.slice(0, -1);
  // If the deletion left the map empty, drop the entire block — an empty
  // `---\n\n---` block reads as malformed YAML to readers.
  if (YAML.isMap(doc.contents) && doc.contents.items.length === 0) {
    return content.slice(parsed.blockEnd);
  }
  return content.slice(0, parsed.blockStart) +
    `---\n${serialised}\n---\n` +
    content.slice(parsed.blockEnd);
}
