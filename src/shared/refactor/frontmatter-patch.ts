import YAML from 'yaml';

/**
 * Patch a note's YAML frontmatter with a shallow key/value merge.
 *
 * Counterpart to the tag-focused helpers in `auto-tag.ts`. Used by the
 * `set_properties` LLM tool flow — the LLM proposes a property bundle,
 * the user approves, and the IPC handler runs this helper per note.
 *
 * Semantics:
 *  - Existing keys are overwritten with the patched value.
 *  - A `null` value deletes the key (lets the LLM clear properties
 *    without needing a separate "delete" tool).
 *  - Unmentioned keys are left untouched.
 *  - If the patched frontmatter ends up empty, the entire `--- … ---`
 *    block is removed — same convention as `removeTagsFromContent`,
 *    keeps round-tripping clean.
 *  - Notes without an existing frontmatter block get one created.
 *  - Malformed YAML in the existing block is treated as "no frontmatter"
 *    rather than thrown — overwriting a broken block with valid YAML is
 *    a recoverable outcome; failing the whole tool call isn't.
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Scalar | array of scalars | nested object | null. Mirrors what
 *  `YAML.stringify` round-trips cleanly. The LLM's tool input is
 *  validated against this loosely at runtime via `isPropertyValue`
 *  in tools.ts; the static type is intentionally `unknown` rather
 *  than a recursive union so the IPC boundary doesn't trip Svelte 5's
 *  reactive-proxy type-inference (TS2589 "type instantiation is
 *  excessively deep" when a `$state.snapshot()` of a recursive type
 *  crosses an `api.*` call). */
export type PropertyValue = unknown;

export interface PropertyPatch {
  [key: string]: PropertyValue;
}

export interface PatchResult {
  content: string;
  /** Keys whose value actually changed (set or deleted). Keys whose patch
   *  value matched what was already there are omitted — lets the caller
   *  report "no-op" cleanly when the LLM proposes a redundant update. */
  changedKeys: string[];
  /** Keys explicitly deleted (subset of `changedKeys`). Useful for the
   *  approval-card "removed:" line. */
  deletedKeys: string[];
}

export function patchFrontmatterProperties(content: string, patch: PropertyPatch): PatchResult {
  const match = content.match(FRONTMATTER_RE);
  let fm: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed: unknown = YAML.parse(match[1]!);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fm = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed frontmatter — treat as empty so the patch produces a
      // valid block. The user's broken YAML is replaced, not preserved.
    }
  }

  const changedKeys: string[] = [];
  const deletedKeys: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (key in fm) {
        delete fm[key];
        changedKeys.push(key);
        deletedKeys.push(key);
      }
      continue;
    }
    if (deepEqual(fm[key], value)) continue;
    fm[key] = value;
    changedKeys.push(key);
  }

  if (changedKeys.length === 0) {
    return { content, changedKeys: [], deletedKeys: [] };
  }

  const body = match ? content.slice(match[0].length) : content;
  if (Object.keys(fm).length === 0) {
    // Frontmatter ended up empty — drop the block entirely. Same logic
    // as removeTagsFromContent, so a note that gets all properties
    // cleared doesn't end up with a vestigial `---\n---` header.
    return {
      content: body.replace(/^\n+/, ''),
      changedKeys,
      deletedKeys,
    };
  }

  const yamlBlock = YAML.stringify(fm).trimEnd();
  const rendered = `---\n${yamlBlock}\n---\n`;
  const separator = body.startsWith('\n') || body === '' ? '' : '\n';
  return { content: rendered + separator + body, changedKeys, deletedKeys };
}

/**
 * Read frontmatter as a plain object. Returns `{}` when the note has no
 * frontmatter or its YAML is malformed. Counterpart to the writer above;
 * used by `fetch_properties` so the tool result is symmetric with what
 * `set_properties` accepts.
 */
export function readFrontmatterProperties(content: string): Record<string, unknown> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};
  try {
    const parsed: unknown = YAML.parse(match[1]!);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* malformed — treat as empty */
  }
  return {};
}

/**
 * Deep-equality on the JSON-shaped values frontmatter holds. Avoids
 * `JSON.stringify` because object-key order would produce false
 * inequalities. Pulled out to a helper so the patch's "did this key
 * actually change?" check is consistent across cases (scalar swap,
 * array reorder, nested mapping update).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    if (typeof b !== 'object' || b === null || Array.isArray(b)) return false;
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!(k in bo)) return false;
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}
