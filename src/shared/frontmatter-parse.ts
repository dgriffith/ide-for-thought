/**
 * Frontmatter parsing — the ONE way a note's YAML block becomes a record
 * (#2683). Moved verbatim out of `main/graph/parser.ts`, where the graph
 * indexer was its only user, so that search (and any other caller holding
 * only raw note text) reads `title:` exactly as the graph does instead of
 * with a hand-rolled line regex. Pure: `yaml` and string work only, no Node
 * builtins, so the renderer can share it too.
 *
 * The block boundary is `findFrontmatter` (frontmatter-block.ts), shared with
 * `stripFrontmatter` and every other reader. It accepts `\r\n` line endings
 * and a leading byte-order mark (#2690); a CRLF note's frontmatter used to
 * index as none here while the preview and publish read it.
 */
import YAML from 'yaml';
import { ownRecord } from './own-record';
import { findFrontmatter } from './frontmatter-block';

/** A frontmatter value after YAML parsing — preserves type info the indexer needs. */
export type FrontmatterScalar = string | number | boolean | Date | null;
/** A nested YAML mapping. The indexer materialises it as a blank node. */
export interface FrontmatterMap { [key: string]: FrontmatterValue }
export type FrontmatterValue = FrontmatterScalar | FrontmatterValue[] | FrontmatterMap;

/**
 * The note's frontmatter as a NULL-PROTOTYPE record (as is every nested map).
 * Keys are user text: into a `{}`, a `__proto__:` key would hit the prototype
 * setter — dropped, and an object value re-parents the record so later reads
 * see its members as inherited keys — and an absent `constructor` / `toString`
 * would read back as `Object.prototype`'s. `yaml` itself is safe here (it
 * defines `__proto__` as an own data property on an ordinary object); the copy
 * below is where it used to go wrong. Key-driven lookups against other plain
 * records (e.g. `mapFrontmatterKey`) still go through `getOwn`.
 */
export function parseFrontmatter(content: string): Record<string, FrontmatterValue> {
  const block = findFrontmatter(content);
  if (!block) return ownRecord([]);

  const raw = parseYamlOrEmpty(block.yaml);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ownRecord([]);
  return sanitizedEntries(raw as Record<string, unknown>, 0);
}

/** Malformed frontmatter indexes as none (the empty map is copied into a
 *  null-prototype record by the caller like any other). */
function parseYamlOrEmpty(text: string): unknown {
  try {
    return YAML.parse(text);
  } catch {
    return {};
  }
}

/** Own entries of a YAML mapping → a null-prototype record of sanitised values,
 *  keys trimmed, blank keys and unsanitisable values dropped. */
function sanitizedEntries(raw: Record<string, unknown>, depth: number): Record<string, FrontmatterValue> {
  const entries: Array<[string, FrontmatterValue]> = [];
  for (const [key, value] of Object.entries(raw)) {
    const sanitized = sanitizeFrontmatterValue(value, depth);
    if (sanitized !== undefined && key.trim()) entries.push([key.trim(), sanitized]);
  }
  return ownRecord(entries);
}

/** Deepest nesting level a frontmatter mapping is materialised to before we
 *  stop recursing — a guard against pathological / cyclic structures. */
const MAX_FRONTMATTER_DEPTH = 8;

function sanitizeFrontmatterValue(value: unknown, depth = 0): FrontmatterValue | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    const items: FrontmatterValue[] = [];
    for (const item of value) {
      const s = sanitizeFrontmatterValue(item, depth + 1);
      if (s !== undefined && s !== null) items.push(s);
    }
    return items;
  }
  // Nested mapping — kept (the indexer materialises it as a blank node with the
  // sub-keys as its own predicates). Recurse so deeply-nested maps and lists
  // survive; bail past the depth cap. An empty map (nothing sanitisable inside)
  // collapses to `undefined` so no dangling blank node is emitted.
  if (typeof value === 'object' && depth < MAX_FRONTMATTER_DEPTH) {
    const map: FrontmatterMap = sanitizedEntries(value as Record<string, unknown>, depth + 1);
    return Object.keys(map).length > 0 ? map : undefined;
  }
  return undefined;
}
