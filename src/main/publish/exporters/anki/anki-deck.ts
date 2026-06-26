/**
 * Anki deck exporter (#850 / #853) — emits a `.apkg` from the `[!card]` callouts
 * in the export scope. Registered as another format in the #802 pipeline.
 *
 * Per note: assign + persist card ids (#852 write-back, via the safe write path),
 * extract cards (#851), derive each card's stable guid, map decks, and render the
 * front/back markdown to HTML. Cards aggregate across the scope into one package
 * keyed by guid, so re-importing after an edit updates cards instead of dupes.
 *
 * Text-first: media is a follow-up. Malformed cards and id collisions are
 * reported in the summary, never silently dropped.
 */

import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { writeFile } from '../../../notebase/fs';
import { collectCards } from '../../../../shared/flashcards/cards';
import { assignCardIds, cardGuid, findDuplicateCardIds } from '../../../../shared/flashcards/guid';
import { buildApkg, type AnkiCard } from './apkg';
import type { Exporter, ExportPlan } from '../../types';

// Card fields are markdown; Anki renders HTML, so convert. `breaks: true` turns
// a single newline into <br> (cards are short and line-oriented). Raw HTML is
// dropped (html: false) — the field is the user's note text, not trusted markup.
const cardMd = new MarkdownIt({ html: false, linkify: true, breaks: true });
const renderField = (md: string): string => cardMd.render(md).trim();

/** Filename for the package, derived from the scope. */
function deckFileName(plan: ExportPlan): string {
  if (plan.inputKind === 'single-note') {
    const note = plan.inputs.find((f) => f.kind === 'note');
    if (note) return `${path.basename(note.relativePath).replace(/\.md$/i, '')}.apkg`;
  }
  return 'flashcards.apkg';
}

export const ankiDeckExporter: Exporter = {
  id: 'anki-deck',
  label: 'Anki Deck (.apkg)',
  group: 'anki',
  // Note / folder / tree / project — anything but a source viewer.
  accepts: (input) => input.kind !== 'source',
  acceptedKinds: ['single-note', 'folder', 'tree', 'project'],

  async run(plan): Promise<{ files: { path: string; contents: Uint8Array }[]; summary: string }> {
    const cards: AnkiCard[] = [];
    const warnings: string[] = [];
    const deckCounts = new Map<string, number>();

    for (const file of plan.inputs) {
      if (file.kind !== 'note') continue;

      // #852 — assign ids to id-less cards and persist them back to the note so
      // the next export matches. Only rewrite notes that actually gained ids.
      let content = file.content;
      const assigned = assignCardIds(content);
      if (assigned.assignedCount > 0 && plan.rootPath) {
        await writeFile(plan.rootPath, file.relativePath, assigned.content);
        content = assigned.content;
      }

      const noteDeck = typeof file.frontmatter.cardDeck === 'string' ? file.frontmatter.cardDeck : undefined;
      const { cards: noteCards, warnings: noteWarnings } = collectCards(content, file.relativePath, noteDeck);
      for (const w of noteWarnings) warnings.push(`${file.relativePath}:${w.line} — ${w.message}`);

      const dupes = new Set(findDuplicateCardIds(noteCards));
      for (const d of dupes) warnings.push(`${file.relativePath} — duplicate card id ^${d}; skipped`);

      for (const c of noteCards) {
        if (!c.id || dupes.has(c.id)) continue;
        cards.push({
          guid: cardGuid(file.relativePath, c.id),
          deck: c.deck,
          front: renderField(c.front),
          back: renderField(c.back),
        });
        deckCounts.set(c.deck, (deckCounts.get(c.deck) ?? 0) + 1);
      }
    }

    if (cards.length === 0) {
      const tail = warnings.length ? ` (${warnings.length} skipped — see ${warnings[0]})` : '';
      return { files: [], summary: `No flashcards found in this scope.${tail}` };
    }

    const apkg = await buildApkg(cards);
    const breakdown = [...deckCounts.entries()].map(([d, n]) => `${d} (${n})`).join(', ');
    const n = cards.length;
    let summary = `${n} card${n === 1 ? '' : 's'} across ${deckCounts.size} deck${deckCounts.size === 1 ? '' : 's'}: ${breakdown}.`;
    if (warnings.length) summary += ` ${warnings.length} skipped.`;

    return { files: [{ path: deckFileName(plan), contents: apkg }], summary };
  },
};
