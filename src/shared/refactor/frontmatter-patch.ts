import YAML from 'yaml';
import { spliceFrontmatter } from './frontmatter-splice';
import { ownRecord } from '../own-record';
import { editNote, findFrontmatter } from '../frontmatter-block';

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
 *  - The note's line endings and byte-order mark are kept (#2690): a CRLF
 *    note comes back CRLF.
 */

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
  return editNote(content, (text) => patchText(text, patch));
}

function patchText(content: string, patch: PropertyPatch): PatchResult {
  const deletedKeys: string[] = [];
  const result = spliceFrontmatter(content, (doc) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        if (doc.has(key)) {
          doc.delete(key);
          deletedKeys.push(key);
        }
        continue;
      }
      // Setting an equal value is harmless: the splice compares values and
      // leaves an unchanged key's text alone. A scalar is set in place, so a
      // quoted `'draft'` stays quoted when it becomes `'active'` (#2737).
      doc.set(key, typeof value === 'object' ? doc.createNode(value) : value);
    }
  }, { onMalformed: 'replace', blankLineAfterNewBlock: true, trimBodyOnDrop: true })!;
  // Report in the patch's own order, as before.
  const changed = new Set(result.changedKeys);
  const changedKeys = Object.keys(patch).filter((k) => changed.has(k));
  if (changedKeys.length === 0) return { content, changedKeys: [], deletedKeys: [] };
  return { content: result.content, changedKeys, deletedKeys };
}

/**
 * Read frontmatter as a plain object. Returns `{}` when the note has no
 * frontmatter or its YAML is malformed. Counterpart to the writer above;
 * used by `fetch_properties` so the tool result is symmetric with what
 * `set_properties` accepts.
 */
export function readFrontmatterProperties(content: string): Record<string, unknown> {
  const match = findFrontmatter(content);
  if (!match) return {};
  try {
    const parsed: unknown = YAML.parse(match.yaml);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return ownRecord(Object.entries(parsed));
    }
  } catch {
    /* malformed — treat as empty */
  }
  return {};
}
