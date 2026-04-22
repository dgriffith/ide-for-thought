/**
 * Cell-id infrastructure for notebook fences (#244).
 *
 * Executable fences can carry a stable id in their info string, Quarto-style:
 *
 *     ```sparql {id=9c8f3e21}
 *     SELECT …
 *     ```
 *
 * We inject the id lazily — on the first "Save as note" for that cell —
 * and preserve it thereafter, so re-saving the same cell can find its
 * previous destination rather than writing a duplicate note each time.
 * Users never type these ids by hand; they're short (8 hex chars) and
 * stay out of the way when reading the source.
 */

/**
 * Parsed view of a fence info string.
 *   `sparql`                       → { language: 'sparql', attrs: {} }
 *   `sparql {id=abc123}`           → { language: 'sparql', attrs: { id: 'abc123' } }
 *   `python {id=abc} {tag=chart}`  → { language: 'python', attrs: { id: 'abc', tag: 'chart' } }
 */
export interface ParsedFenceInfo {
  language: string;
  attrs: Record<string, string>;
}

export function parseFenceInfo(info: string): ParsedFenceInfo {
  const trimmed = info.trim();
  if (!trimmed) return { language: '', attrs: {} };

  // Language is the first whitespace-delimited token.
  const firstSpace = trimmed.search(/\s/);
  const language = firstSpace < 0 ? trimmed : trimmed.slice(0, firstSpace);
  const rest = firstSpace < 0 ? '' : trimmed.slice(firstSpace);

  // Attribute tokens come in `{key=value}` braces. Values can hold any
  // char except `}` and whitespace — simple enough to parse without a
  // real tokenizer.
  const attrs: Record<string, string> = {};
  const attrRe = /\{([a-zA-Z_][a-zA-Z0-9_-]*)=([^\s}]+)\}/g;
  for (const m of rest.matchAll(attrRe)) {
    attrs[m[1]] = m[2];
  }
  return { language, attrs };
}

/**
 * Serialize a parsed fence info back into a fence string. Attribute
 * order is alphabetical for idempotence — `stringifyFenceInfo(parseFenceInfo(x))`
 * is a canonical form rather than depending on the input ordering.
 */
export function stringifyFenceInfo(parsed: ParsedFenceInfo): string {
  const keys = Object.keys(parsed.attrs).sort();
  if (keys.length === 0) return parsed.language;
  const parts = [parsed.language];
  for (const k of keys) parts.push(`{${k}=${parsed.attrs[k]}}`);
  return parts.join(' ');
}

/** 8-char lowercase-hex id. Collision-free for the scale of a thoughtbase. */
export function generateCellId(): string {
  // `crypto.randomUUID` is available in both main (Node ≥ 19) and
  // renderer (modern Electron). Take the first 8 hex chars of its
  // body — 32 bits, enough entropy for a library-of-notes scale.
  const uuid = (globalThis.crypto as Crypto).randomUUID();
  return uuid.replace(/-/g, '').slice(0, 8);
}

/**
 * Ensure a fence info string carries an id. If one's already present,
 * return it unchanged; otherwise generate a new id and splice it in.
 * `newInfo` is the value to replace the fence's opening-line info with.
 */
export function ensureCellId(
  info: string,
  makeId: () => string = generateCellId,
): { id: string; newInfo: string; wasNew: boolean } {
  const parsed = parseFenceInfo(info);
  const existing = parsed.attrs.id;
  if (existing) {
    return { id: existing, newInfo: info, wasNew: false };
  }
  const id = makeId();
  const withId: ParsedFenceInfo = {
    language: parsed.language,
    attrs: { ...parsed.attrs, id },
  };
  return { id, newInfo: stringifyFenceInfo(withId), wasNew: true };
}

/**
 * Apply an info-string update to the opening fence line at `startOffset`
 * in a document. Returns the new doc text. Caller is responsible for
 * ensuring `startOffset` really points at an opening ``` line.
 */
export function rewriteFenceInfo(doc: string, startOffset: number, newInfo: string): string {
  const lineEnd = doc.indexOf('\n', startOffset);
  const stop = lineEnd < 0 ? doc.length : lineEnd;
  const opening = doc.slice(startOffset, stop);
  // Preserve the opening backticks; replace the info portion.
  const m = opening.match(/^(`{3,})/);
  if (!m) return doc; // not a fence, don't mangle
  const ticks = m[1];
  const replacement = newInfo.trim() ? `${ticks}${newInfo}` : ticks;
  return doc.slice(0, startOffset) + replacement + doc.slice(stop);
}
