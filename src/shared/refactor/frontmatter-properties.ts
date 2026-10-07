/**
 * Frontmatter *property* (arbitrary key/value) manipulation, mirroring the
 * tag-specific helpers in `auto-tag.ts`. Powers the sidebar / editor
 * "Add Property" / "Remove Property" menu actions.
 *
 * A property is any frontmatter key other than `tags` (which has its own
 * Add/Remove Tag actions). Values are typed: the "Add Property" dialog now
 * collects a type (string / number / boolean / date) alongside the value, so
 * `setPropertyInContent` takes the already-coerced JS value and lets the YAML
 * serializer render it — a real boolean `false` becomes `key: false`, not
 * `key: "false"`.
 */
import YAML from 'yaml';
import { ownRecord } from '../own-record';
import { editNote, findFrontmatter, type FrontmatterBlock } from '../frontmatter-block';

/*
 * Every parsed map is copied into a null-prototype record (`ownRecord`) before
 * it is read or written by key: keys are user text, so on an ordinary object
 * `key in fm` / `fm[key]` would see `constructor`, `toString`, … as present,
 * and `fm['__proto__'] = v` would hit the prototype setter instead of adding
 * the key. `YAML.stringify` serialises a null-prototype record as usual.
 *
 * The writers keep the note's line endings and byte-order mark (#2690).
 */

function parseFrontmatterObject(content: string): { fm: Record<string, unknown>; match: FrontmatterBlock } | null {
  const match = findFrontmatter(content);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = YAML.parse(match.yaml); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { fm: ownRecord(Object.entries(parsed)), match };
}

/**
 * Frontmatter property keys present on the note — every key except `tags`.
 * Used by Remove Property's autocomplete so it only offers keys that are
 * actually there.
 */
export function extractPropertyKeysFromContent(content: string): string[] {
  const parsed = parseFrontmatterObject(content);
  if (!parsed) return [];
  return Object.keys(parsed.fm).filter((k) => k !== 'tags');
}

export interface SetPropertyResult {
  content: string;
  /** False when the key already held this exact value (no write needed). */
  changed: boolean;
}

/**
 * Upsert `key: value` into the note's frontmatter, creating the block when the
 * note has none. `value` is a JS scalar (string, number, or boolean); the YAML
 * serializer renders it in the right shape and quotes strings as needed — so a
 * `[[wiki-link]]` string survives round-trip while a boolean `false` stays a
 * boolean. No-op when the key already holds the same value.
 */
export function setPropertyInContent(content: string, key: string, value: unknown): SetPropertyResult {
  return editNote(content, (text) => setPropertyInText(text, key, value));
}

function setPropertyInText(content: string, key: string, value: unknown): SetPropertyResult {
  const match = findFrontmatter(content);
  let fm: Record<string, unknown> = ownRecord([]);
  if (match) {
    try {
      const parsed: unknown = YAML.parse(match.yaml);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fm = ownRecord(Object.entries(parsed));
      }
    } catch { /* malformed frontmatter — overwrite */ }
  }
  if (fm[key] === value) return { content, changed: false };
  fm[key] = value;
  const yamlBlock = YAML.stringify(fm).trimEnd();
  const rendered = `---\n${yamlBlock}\n---\n`;
  const body = match ? content.slice(match.end) : content;
  const separator = body.startsWith('\n') || body === '' ? '' : '\n';
  return { content: rendered + separator + body, changed: true };
}

export interface RemovePropertyResult {
  content: string;
  /** False when the key wasn't present. */
  removed: boolean;
}

/**
 * Remove `key` from the note's frontmatter. If the block becomes empty it's
 * dropped entirely (same rationale as `removeTagsFromContent`). No-op when the
 * key isn't present.
 */
export function removePropertyFromContent(content: string, key: string): RemovePropertyResult {
  return editNote(content, (text) => removePropertyFromText(text, key));
}

function removePropertyFromText(content: string, key: string): RemovePropertyResult {
  const parsed = parseFrontmatterObject(content);
  if (!parsed) return { content, removed: false };
  const { fm, match } = parsed;
  if (!(key in fm)) return { content, removed: false };
  delete fm[key];
  const body = content.slice(match.end);
  if (Object.keys(fm).length === 0) {
    return { content: body.replace(/^\n+/, ''), removed: true };
  }
  const yamlBlock = YAML.stringify(fm).trimEnd();
  const rendered = `---\n${yamlBlock}\n---\n`;
  const separator = body.startsWith('\n') || body === '' ? '' : '\n';
  return { content: rendered + separator + body, removed: true };
}
