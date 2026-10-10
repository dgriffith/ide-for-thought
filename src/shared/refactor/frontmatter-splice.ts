/**
 * Edit a note's frontmatter and rewrite only what changed (#2737).
 *
 * Every frontmatter writer — the Properties panel, setting a note's type,
 * Add/Remove Property, Add/Remove Tag, the LLM property patch, bulk edits —
 * goes through `spliceFrontmatter`. It parses the block into a YAML document,
 * lets the caller mutate it, then compares each top-level key's value before
 * and after. A key whose value didn't change keeps its source text byte for
 * byte: its comments, quotes, `[a, b]` or `[ a, b ]`, folded `>` lines, long
 * lines and spacing. Only added, changed and removed keys are rewritten.
 *
 * It used to be otherwise, two ways: re-serialising the whole document with
 * yaml's defaults (which pad flow lists and fold at 80 columns), or rebuilding
 * the block from a plain object (which also turns flow lists into block lists,
 * empty values into `null`, drops comments and quotes, and added a blank line
 * before the body). In a thoughtbase under git, one edit touched every line.
 *
 * The span-and-splice technique comes from bulk property edits (#2716), which
 * did this first for many notes at once; it now lives here so all writers
 * share it.
 *
 * Works on LF text without a byte-order mark: callers wrap it in
 * `editNoteText` / `editNote`, which keep a CRLF note CRLF (#2690).
 */
import YAML from 'yaml';
import { findFrontmatter } from '../frontmatter-block';

/**
 * How a rewritten key is serialised: no padding inside flow collections
 * (`[a, b]`, the common hand-written and script-written form) and no folding
 * of long values. Untouched keys never pass through this at all.
 */
export const FRONTMATTER_STRINGIFY: YAML.ToStringOptions = {
  flowCollectionPadding: false,
  lineWidth: 0,
};

export interface SpliceOptions {
  /**
   * What to do with frontmatter that doesn't parse. `'refuse'` (default)
   * returns null so a work-in-progress isn't overwritten. `'replace'` treats
   * the broken block as empty and writes a fresh one in its place — the
   * documented behaviour of Add Property, Add Tag and the LLM patch.
   */
  onMalformed?: 'refuse' | 'replace';
  /** Put a blank line between a newly created block and the body. */
  blankLineAfterNewBlock?: boolean;
  /** When the edit empties the block, also drop blank lines it leaves at the
   *  top of the body. */
  trimBodyOnDrop?: boolean;
}

export interface SpliceResult {
  content: string;
  /** Top-level keys whose value was added, changed or removed, in order. */
  changedKeys: string[];
}

type AnyDocument = YAML.Document.Parsed | YAML.Document;

/**
 * Parse the note's frontmatter, run `mutate` on it, and splice back only the
 * keys whose value changed. Null when the frontmatter doesn't parse (or isn't
 * a key/value map) and `onMalformed` is `'refuse'`. An edit that changes no
 * value returns `content` itself and `changedKeys: []`.
 */
export function spliceFrontmatter(
  content: string,
  mutate: (doc: AnyDocument) => void,
  opts: SpliceOptions = {},
): SpliceResult | null {
  const block = findFrontmatter(content);
  if (!block) return createBlock(content, content, mutate, opts);

  const doc = parseMap(block.yaml);
  if (!doc) {
    if (opts.onMalformed !== 'replace') return null;
    return createBlock(content, content.slice(block.end), mutate, opts);
  }

  const map = doc.contents as YAML.YAMLMap;
  const before = valuesByKey(map);
  const spans = pairSpans(block.yaml, map);
  mutate(doc);
  if (!YAML.isMap(doc.contents)) return { content, changedKeys: [] };
  const after = valuesByKey(doc.contents);

  const changedKeys = [...new Set([...before.keys(), ...after.keys()])]
    .filter((k) => before.has(k) !== after.has(k) || !deepEqual(before.get(k), after.get(k)));
  if (changedKeys.length === 0) return { content, changedKeys };

  const body = content.slice(block.end);
  if (after.size === 0) {
    return { content: content.slice(0, block.start) + (opts.trimBodyOnDrop ? body.replace(/^\n+/, '') : body), changedKeys };
  }

  const yaml = block.yaml;
  const splices: { start: number; end: number; text: string }[] = [];
  let appended = '';
  for (const key of changedKeys) {
    const pair = findPair(doc.contents, key);
    const text = pair ? serializePair(pair) : '';
    const span = spans.get(key);
    if (span) splices.push({ start: span[0], end: span[1], text });
    else appended += text;
  }
  let next = yaml;
  for (const s of splices.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, s.start) + s.text + next.slice(s.end);
  }
  if (appended) next = next === '' ? appended : `${next.replace(/\n?$/, '\n')}${appended}`;
  next = next.replace(/\n$/, '');

  // `block.yaml` sits on the line after the opening `---`; splice the new
  // text over exactly that range so the fences and body are untouched.
  const yamlStart = content.indexOf('\n', block.start) + 1;
  return {
    content: content.slice(0, yamlStart) + next + content.slice(yamlStart + yaml.length),
    changedKeys,
  };
}

/** A fresh block from `mutate`, in front of `body`; `content` back unchanged
 *  when the mutation added nothing. */
function createBlock(
  content: string,
  body: string,
  mutate: (doc: AnyDocument) => void,
  opts: SpliceOptions,
): SpliceResult {
  const doc = new YAML.Document({});
  mutate(doc);
  const keys = YAML.isMap(doc.contents) ? [...valuesByKey(doc.contents).keys()] : [];
  if (keys.length === 0) return { content, changedKeys: [] };
  const yaml = doc.toString(FRONTMATTER_STRINGIFY).trimEnd();
  const separator = opts.blankLineAfterNewBlock && body !== '' && !body.startsWith('\n') ? '\n' : '';
  return { content: `---\n${yaml}\n---\n${separator}${body}`, changedKeys: keys };
}

/** The block parsed as a key/value map, or null if it isn't one. */
function parseMap(yaml: string): YAML.Document.Parsed | null {
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(yaml);
  } catch {
    return null;
  }
  if (doc.errors.length > 0) return null;
  // An empty block parses to null contents; edit it as an empty map.
  if (doc.contents === null) doc.contents = new YAML.YAMLMap() as YAML.Document.Parsed['contents'];
  return YAML.isMap(doc.contents) ? doc : null;
}

function keyOf(pair: YAML.Pair): string | null {
  const k: unknown = YAML.isScalar(pair.key) ? pair.key.value : pair.key;
  if (typeof k === 'string') return k;
  if (typeof k === 'number' || typeof k === 'boolean') return String(k);
  return null;
}

function findPair(map: YAML.YAMLMap, key: string): YAML.Pair | undefined {
  return map.items.find((p) => keyOf(p) === key);
}

/** Each top-level key's value, as a fresh JS value (so a later in-place
 *  mutation of the node can't change what was captured). */
function valuesByKey(map: YAML.YAMLMap): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const pair of map.items) {
    const key = keyOf(pair);
    if (key === null) continue;
    const v: unknown = YAML.isNode(pair.value) ? pair.value.toJSON() : pair.value;
    out.set(key, v instanceof Date ? v.toISOString() : v ?? null);
  }
  return out;
}

/**
 * Deep-equality on the JSON-shaped values frontmatter holds. Avoids
 * `JSON.stringify` because object-key order would produce false
 * inequalities. Decides which keys the splice rewrites: an equal value — including a
 * nested map in another key order — keeps its source text.
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


/** Offset of the start of the line holding `i`. */
function lineStart(text: string, i: number): number {
  return text.lastIndexOf('\n', Math.max(0, i - 1)) + 1;
}

/** Offset just past the newline ending the line holding `i` (or the text end). */
function lineEnd(text: string, i: number): number {
  const nl = text.indexOf('\n', i);
  return nl === -1 ? text.length : nl + 1;
}

/**
 * Each top-level pair's source span, whole lines: from its key's line to the
 * end of the line its value ends on. Comment lines between pairs belong to no
 * span, so they stay exactly where they are.
 */
function pairSpans(yaml: string, map: YAML.YAMLMap): Map<string, [number, number]> {
  const spans = new Map<string, [number, number]>();
  for (const pair of map.items) {
    const key = keyOf(pair);
    const keyRange = YAML.isNode(pair.key) ? pair.key.range : undefined;
    if (key === null || !keyRange) continue;
    const valueRange = YAML.isNode(pair.value) ? pair.value.range : undefined;
    const end = Math.max(keyRange[1], valueRange ? valueRange[1] : 0);
    spans.set(key, [lineStart(yaml, keyRange[0]), lineEnd(yaml, Math.max(keyRange[0], end - 1))]);
  }
  return spans;
}

/** One pair, serialised on its own — without the comment lines above it,
 *  which stay put in the source rather than being re-emitted. */
function serializePair(pair: YAML.Pair): string {
  const key = YAML.isNode(pair.key) ? pair.key : null;
  const saved = key?.commentBefore;
  if (key) delete key.commentBefore;
  const doc = new YAML.Document();
  const map = new YAML.YAMLMap();
  map.items.push(pair);
  doc.contents = map;
  const out = doc.toString(FRONTMATTER_STRINGIFY);
  if (key && saved !== undefined) key.commentBefore = saved;
  return out.endsWith('\n') ? out : `${out}\n`;
}
