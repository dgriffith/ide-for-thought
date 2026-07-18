/**
 * Frontmatter *property* (arbitrary key/value) manipulation, mirroring the
 * tag-specific helpers in `auto-tag.ts`. Powers the sidebar / editor
 * "Add Property" / "Remove Property" menu actions.
 *
 * A property is any frontmatter key other than `tags` (which has its own
 * Add/Remove Tag actions). Values are written as string scalars — the menu
 * flow is a text prompt; richer typing lives in the Properties panel.
 */
import YAML from 'yaml';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function parseFrontmatterObject(content: string): { fm: Record<string, unknown>; match: RegExpMatchArray } | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = YAML.parse(match[1]!); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { fm: parsed as Record<string, unknown>, match };
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
  /** False when the key was already set to this exact string (no write needed). */
  changed: boolean;
}

/**
 * Upsert `key: value` into the note's frontmatter, creating the block when the
 * note has none. `value` is stored as a string scalar (YAML quotes it as
 * needed — so a `[[wiki-link]]` value survives round-trip). No-op when the key
 * already holds the same string.
 */
export function setPropertyInContent(content: string, key: string, value: string): SetPropertyResult {
  const match = content.match(FRONTMATTER_RE);
  let fm: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed: unknown = YAML.parse(match[1]!);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fm = parsed as Record<string, unknown>;
      }
    } catch { /* malformed frontmatter — overwrite */ }
  }
  if (fm[key] === value) return { content, changed: false };
  fm[key] = value;
  const yamlBlock = YAML.stringify(fm).trimEnd();
  const rendered = `---\n${yamlBlock}\n---\n`;
  const body = match ? content.slice(match[0].length) : content;
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
  const parsed = parseFrontmatterObject(content);
  if (!parsed) return { content, removed: false };
  const { fm, match } = parsed;
  if (!(key in fm)) return { content, removed: false };
  delete fm[key];
  const body = content.slice(match[0].length);
  if (Object.keys(fm).length === 0) {
    return { content: body.replace(/^\n+/, ''), removed: true };
  }
  const yamlBlock = YAML.stringify(fm).trimEnd();
  const rendered = `---\n${yamlBlock}\n---\n`;
  const separator = body.startsWith('\n') || body === '' ? '' : '\n';
  return { content: rendered + separator + body, removed: true };
}
