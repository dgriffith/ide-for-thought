/**
 * Fuzzy-match scoring for the command palette (#463). Lifted from
 * GotoNoteDialog's heuristic — same matching feel across both
 * palettes. Exposed as a standalone module so it's unit-testable
 * and so future palettes can reuse it.
 */

const STOPWORDS: ReadonlySet<string> = new Set(['the', 'and', 'or', 'of', 'a', 'in', 'on', 'to', 'for']);

/**
 * Return a score in [0, 100] for how well `query` matches `name`.
 * Higher is better; zero means "no match — drop this row".
 *
 *   100  exact substring of the name
 *    90  first-letter match across word boundaries
 *    85  CamelCase prefix match
 *    80  exact substring of the secondary text (e.g. category)
 *    50  fuzzy match against the name
 *    30  fuzzy match against the secondary text
 *
 * The secondary text is typically the command's category — gets
 * matched after the name so "view toggle" doesn't outrank "Toggle
 * View" on identical input.
 */
export function scoreCommand(name: string, secondary: string, query: string): number {
  const q = query.trim();
  if (!q) return 1; // empty query → every row stays, all tied.
  const lowerName = name.toLowerCase();
  const lowerSecondary = secondary.toLowerCase();
  const lowerQ = q.toLowerCase();

  if (lowerName.includes(lowerQ)) return 100;
  if (firstLetterMatch(name, q)) return 90;
  if (camelCaseMatch(name, q)) return 85;
  if (lowerSecondary && lowerSecondary.includes(lowerQ)) return 80;
  if (fuzzyMatch(lowerName, lowerQ)) return 50;
  if (lowerSecondary && fuzzyMatch(lowerSecondary, lowerQ)) return 30;
  return 0;
}

/**
 * Each character of `q` matches the first letter of a word in
 * `name` (in order). "tnn" matches "Toggle New Note".
 */
export function firstLetterMatch(name: string, q: string): boolean {
  const words = name.split(/[\s\-_/]+/).filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase()));
  const letters = q.toLowerCase();
  if (letters.length === 0 || letters.length > words.length) return false;
  for (let i = 0; i < letters.length; i++) {
    if (words[i]![0]?.toLowerCase() !== letters[i]) return false;
  }
  return true;
}

/**
 * Uppercase letters / word-starts of `name` form a prefix matching
 * `q`. "TNn" matches "Toggle New note" by hitting the camelCase
 * peaks.
 */
export function camelCaseMatch(name: string, q: string): boolean {
  const peaks: string[] = [];
  for (let i = 0; i < name.length; i++) {
    const c = name[i]!;
    if (i === 0 || /[A-Z]/.test(c)) peaks.push(c.toLowerCase());
  }
  const lowerQ = q.toLowerCase();
  if (lowerQ.length > peaks.length) return false;
  for (let i = 0; i < lowerQ.length; i++) {
    if (peaks[i] !== lowerQ[i]) return false;
  }
  return true;
}

/** Standard fuzzy: each char of `query` appears in `text` in order. */
export function fuzzyMatch(text: string, query: string): boolean {
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const idx = text.indexOf(query[qi]!, ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}
