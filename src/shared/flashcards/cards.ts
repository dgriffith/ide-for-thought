/**
 * Flashcard model + extractor (#850 / #851).
 *
 * A card is authored as a `[!card]` callout in a note — the existing callout
 * infrastructure (`callout-plugin.ts`), with a `---` divider splitting the
 * front (prompt) from the back (answer):
 *
 *     > [!card] Optional Deck ^cardid
 *     > What is the capital of France?
 *     > ---
 *     > **Paris**
 *
 * The leading `>` (blockquote form) is optional — a bare `[!card]` paragraph
 * works too, matching the callout plugin's leniency. `collectCards` is a pure
 * extractor the Anki exporter (#853) and any UI consume; it's robust to
 * malformed callouts (skipped with a recorded warning, never throws).
 *
 * `^cardid` is the stable per-card block-id (#852) — surfaced here as `Card.id`
 * when present; assignment / write-back is the exporter's job.
 */

export interface Card {
  /** Front (prompt) markdown. */
  front: string;
  /** Back (answer) markdown. */
  back: string;
  /** Resolved deck name (callout → frontmatter → folder; see `resolveDeck`). */
  deck: string;
  /** Stable block-id, when the callout carries a trailing `^id`. */
  id?: string;
  /** 1-based line of the `[!card]` marker — for write-back + warnings. */
  sourceLine: number;
}

export interface CardWarning {
  /** 1-based line of the offending callout. */
  line: number;
  message: string;
}

export interface CollectResult {
  cards: Card[];
  warnings: CardWarning[];
}

/** Anki's fallback deck when a card has no deck of its own and sits at the vault root. */
export const DEFAULT_DECK = 'Default';

// A `[!card]` marker line (leading `>` already stripped). Captures the optional
// collapse flag, then the title (deck + maybe a trailing `^id`).
// Exported (with TRAILING_ID_RE) so the identity layer (`guid.ts`) detects card
// markers the exact same way the extractor does.
export const CARD_MARKER_RE = /^\[!card\][+-]?(?:[ \t]+(.*))?$/i;
// A trailing `^block-id` at the end of the title (deck optionally precedes it).
export const TRAILING_ID_RE = /^(.*?)\s*\^([\w-]+)\s*$/;
// A thematic-break divider line separating front from back.
const DIVIDER_RE = /^-{3,}$/;

/**
 * Map a note's folder to an Anki deck path. `notes/math/algebra.md` →
 * `notes::math`; a root-level note → `DEFAULT_DECK`. Anki uses `::` for deck
 * hierarchy.
 */
export function folderDeck(relativePath: string): string {
  const norm = relativePath.replace(/\\/g, '/');
  const slash = norm.lastIndexOf('/');
  if (slash < 0) return DEFAULT_DECK;
  const dir = norm.slice(0, slash).replace(/^\/+|\/+$/g, '');
  return dir === '' ? DEFAULT_DECK : dir.split('/').join('::');
}

/**
 * Resolve a card's deck by precedence: the callout's own deck, else the note's
 * `cardDeck` frontmatter, else the note's folder path.
 */
export function resolveDeck(
  calloutDeck: string | undefined,
  noteDeck: string | undefined,
  relativePath: string,
): string {
  const fromCallout = calloutDeck?.trim();
  if (fromCallout) return fromCallout;
  const fromNote = noteDeck?.trim();
  if (fromNote) return fromNote;
  return folderDeck(relativePath);
}

/** Strip a single leading blockquote marker (`>` or `> `) from a line. */
export function stripQuote(line: string): { quoted: boolean; rest: string } {
  const m = /^>[ \t]?(.*)$/.exec(line);
  return m ? { quoted: true, rest: m[1]! } : { quoted: false, rest: line };
}

/**
 * Extract every `[!card]` callout from `content`. `noteDeck` is the note's
 * `cardDeck` frontmatter (caller-supplied; this stays free of a YAML parser).
 * Malformed callouts (no divider, empty front/back) are skipped with a warning.
 */
export function collectCards(
  content: string,
  relativePath = '',
  noteDeck?: string,
): CollectResult {
  const lines = content.split('\n');
  const cards: Card[] = [];
  const warnings: CardWarning[] = [];

  let i = 0;
  while (i < lines.length) {
    const first = stripQuote(lines[i]!);
    const marker = CARD_MARKER_RE.exec(first.rest.trim());
    if (!marker) { i++; continue; }

    const sourceLine = i + 1;
    const titleRaw = marker[1] ?? '';
    const idMatch = TRAILING_ID_RE.exec(titleRaw);
    const calloutDeck = (idMatch ? idMatch[1]! : titleRaw).trim() || undefined;
    const id = idMatch?.[2];

    // Collect the callout body. Blockquote form runs while lines stay quoted;
    // bare form runs until a blank line (a markdown paragraph break).
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (first.quoted) {
        const q = stripQuote(lines[j]!);
        if (!q.quoted) break;
        body.push(q.rest);
      } else {
        const bare = lines[j]!;
        if (bare.trim() === '') break;
        body.push(bare);
      }
    }
    i = j;

    const dividerIdx = body.findIndex((l) => DIVIDER_RE.test(l.trim()));
    if (dividerIdx < 0) {
      warnings.push({ line: sourceLine, message: 'card has no `---` divider between front and back; skipped' });
      continue;
    }
    const front = body.slice(0, dividerIdx).join('\n').trim();
    const back = body.slice(dividerIdx + 1).join('\n').trim();
    if (!front || !back) {
      warnings.push({ line: sourceLine, message: 'card has an empty front or back; skipped' });
      continue;
    }

    cards.push({
      front,
      back,
      deck: resolveDeck(calloutDeck, noteDeck, relativePath),
      id,
      sourceLine,
    });
  }

  return { cards, warnings };
}
