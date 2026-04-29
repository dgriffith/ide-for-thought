/**
 * Citekey generator (#114, #115).
 *
 * Builds `author-year-firstword` keys with deterministic collision
 * handling. Same input set in, same keys out — the property both the
 * Pandoc exporter (cite-rewriting) and the BibTeX exporter (entry
 * keys) need.
 *
 * "Stable" here means stable per export run, not stable forever:
 * adding a new source to the library can shift collision suffixes
 * for the entries it now collides with. Persisting the assigned key
 * on disk would give global stability but isn't required by either
 * exporter (the BibTeX importer reconstructs sources from
 * DOI/arXiv/etc., not from citekeys).
 */

import type { CslItem } from './csl/source-to-csl';

/**
 * Stop-words skipped when picking the "first title word" — matches
 * standard biblatex citekey conventions (`smith-2020-functions`, not
 * `smith-2020-the`). Kept short on purpose; long lists become a
 * portability problem when round-tripping with other tools.
 */
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor',
  'of', 'on', 'in', 'to', 'for', 'with', 'by', 'at', 'from', 'as',
]);

/**
 * Reduce a string to ASCII lowercase alphanumerics. Strip diacritics
 * via NFD-then-remove-combining-marks; replace anything else with
 * empty. Citekeys must round-trip through filesystems and BibTeX
 * tooling without surprises.
 */
function asciiSlug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function familyOnly(name: { family?: string; given?: string; literal?: string }): string {
  const family = name.family ?? name.literal ?? '';
  // Take only the trailing token of a multi-word family name (e.g.
  // "van der Berg" → "berg") — biblatex convention, and what most
  // people expect when they read a citekey.
  const tokens = family.split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? tokens[tokens.length - 1] : '';
}

function firstAuthor(item: CslItem): string {
  const a = item.author?.[0];
  if (!a) return 'anon';
  const slug = asciiSlug(familyOnly(a));
  return slug || 'anon';
}

function year(item: CslItem): string {
  const parts = item.issued?.['date-parts']?.[0];
  const y = parts && parts.length > 0 ? parts[0] : null;
  return y && Number.isFinite(y) ? String(y) : 'nodate';
}

function firstTitleWord(item: CslItem): string {
  if (!item.title) return '';
  const tokens = item.title
    .split(/\s+/)
    .map((t) => asciiSlug(t))
    .filter((t) => t.length > 0);
  for (const tok of tokens) {
    if (!TITLE_STOPWORDS.has(tok)) return tok;
  }
  // All stopwords (or only one short word) — fall back to the first.
  return tokens[0] ?? '';
}

/** Build the "stem" — the base citekey before collision suffixing. */
export function citekeyStem(item: CslItem): string {
  const a = firstAuthor(item);
  const y = year(item);
  const w = firstTitleWord(item);
  return w ? `${a}-${y}-${w}` : `${a}-${y}`;
}

/**
 * Assign a citekey per item. Items are processed in source-id sort
 * order so collision suffixes ('a', 'b', …) are deterministic across
 * runs. Suffix only applied when ≥2 items share a stem.
 */
export function assignCitekeys(items: CslItem[]): Map<string, string> {
  const out = new Map<string, string>();
  // Group by stem, preserving the input → sorted-by-source-id order
  // inside each group so the first item gets 'a', the second 'b', etc.
  const byStem = new Map<string, CslItem[]>();
  for (const item of items) {
    const stem = citekeyStem(item);
    const bucket = byStem.get(stem);
    if (bucket) bucket.push(item);
    else byStem.set(stem, [item]);
  }
  for (const [stem, group] of byStem) {
    if (group.length === 1) {
      out.set(group[0].id, stem);
      continue;
    }
    // Sort by source-id so collision suffixes survive re-runs that
    // load items in different filesystem-iteration order.
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((item, i) => {
      const suffix = String.fromCharCode('a'.charCodeAt(0) + i);
      // After 'z' we wrap with 'aa', 'ab', … — vanishingly rare, but
      // pathological libraries with 26+ same-author-same-year-same-firstword
      // entries shouldn't crash.
      const safeSuffix = i < 26
        ? suffix
        : `a${String.fromCharCode('a'.charCodeAt(0) + (i - 26))}`;
      out.set(item.id, `${stem}${safeSuffix}`);
    });
  }
  return out;
}
