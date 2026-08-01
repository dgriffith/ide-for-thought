/**
 * Type-keyed render card model (#1071). Pure projection from a note's typed
 * properties (#1063 read-back) to the small "card" shown in link cards, hover
 * previews, and the preview pane: a cover image + a selected set of property
 * chips. The selection is the type's `card:` template (user-overridable),
 * defaulting to the first few declared properties when a type declares none.
 *
 * Renderer-safe (no main imports) so the preview pipeline can build cards
 * directly, and pure so it tests without IPC.
 */
import type { NoteTypedProperties } from './type-def';

export interface CardField {
  name: string;
  label: string;
  /** Lexical value from the read-back, or null when the note leaves it empty. */
  value: string | null;
}

export interface ObjectCard {
  fields: CardField[];
  /** The cover property's value (an image locator), or null. */
  cover: string | null;
}

/** How many declared properties a card shows when the type declares no `card:`. */
export const DEFAULT_CARD_FIELD_COUNT = 3;

/**
 * Select the card's cover + property chips from a note's typed properties. The
 * cover property is never also rendered as a chip (it's the image). Returns
 * empty when the note has no resolved type.
 */
export function selectCardFields(rb: NoteTypedProperties): ObjectCard {
  const type = rb.type;
  if (!type) return { fields: [], cover: null };

  const byName = new Map(rb.properties.map((p) => [p.name, p]));
  const cover = type.cover ? byName.get(type.cover)?.value ?? null : null;

  const chosen = type.card && type.card.length > 0
    ? type.card
    : rb.properties.map((p) => p.name).slice(0, DEFAULT_CARD_FIELD_COUNT + (type.cover ? 1 : 0));

  const fields: CardField[] = [];
  for (const name of chosen) {
    if (name === type.cover) continue; // shown as the image, not a chip
    const pd = byName.get(name);
    if (!pd) continue;
    fields.push({ name: pd.name, label: pd.label ?? pd.name, value: pd.value });
    if (!type.card && fields.length >= DEFAULT_CARD_FIELD_COUNT) break;
  }
  return { fields, cover };
}
