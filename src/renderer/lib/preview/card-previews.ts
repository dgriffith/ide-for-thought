/**
 * The preview half of each lone-link live block (#2624): a top-level
 * paragraph that is one plain `[[link]]` drawn as its note's typed card
 * (#1071). Keyed by kind, so a card kind registered in `shared/live-blocks.ts`
 * without a preview here doesn't compile. `Preview.svelte` runs each after a
 * render.
 */
import type { CardBlockKind } from '../../../shared/live-blocks';
import { hydrateTypedCards, type TypedCardDeps } from './typed-link-render';

export const CARD_PREVIEWS: Record<CardBlockKind, (deps: TypedCardDeps) => Promise<void>> = {
  card: (deps) => hydrateTypedCards(deps),
};
