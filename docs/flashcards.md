# Flashcards — author in Minerva, review in Anki

Minerva is a great place to **author** flashcards from your notes. It doesn't
schedule or review them — that's [Anki](https://apps.ankiweb.net/)'s job (desktop
+ mobile + sync). Minerva turns your notes into a deck and hands off via an
`.apkg` export.

## Authoring a card

A card is a `[!card]` callout with a `---` divider separating the **front**
(prompt) from the **back** (answer):

```markdown
> [!card] Capitals
> What is the capital of France?
> ---
> **Paris**
```

- The text after `[!card]` is an optional **deck** name.
- Everything before `---` is the front; everything after is the back.
- Markdown inside front and back is preserved (emphasis, code, lists, …).
- The leading `>` is optional — a bare `[!card]` paragraph works too — but the
  blockquote form is collapsible and reads best.

**Insert → Flashcard** drops a scaffold with the front placeholder selected.

Or let an LLM draft them: **Learning → Propose Flashcards** (`/cards`) reads the
active note and proposes atomic Q/A pairs for your review. You refine them in the
conversation; on approval they're filed — through the standard approval engine,
so nothing is written until you confirm — as a sibling note of `[!card]`
callouts the exporter then packages. Review happens in Anki; authoring is the
Minerva-native half.

In the preview the card renders as a themed callout with the front and back
separated by a divider rule.

## Decks

A card's deck is resolved by precedence:

1. the **callout** deck (the text after `[!card]`);
2. the note's **`cardDeck`** frontmatter key;
3. the note's **folder path**, mapped to Anki's `::` deck hierarchy
   (`math/algebra/note.md` → `math::algebra`). A note at the vault root falls
   back to Anki's `Default` deck.

So `> [!card] Spanish::Verbs` files a card under that exact deck regardless of
where the note lives, while `> [!card]` with no name inherits the note's
`cardDeck` or its folder.

## Card identity

Each card gets a stable `^id` block-id so re-exporting **updates** the matching
Anki card (preserving its review history) instead of duplicating it.

- Ids are assigned automatically on the first export — you don't write them by
  hand, though you'll see ` ^id` appended to the callout afterward. Only notes
  that gained an id are rewritten, and nothing else in the note changes.
- The Anki **guid** is derived deterministically from the note's path plus the
  card's `^id`. It depends only on identity, never on the card's text — so
  **editing the front or back keeps the guid** (Anki updates the note in place
  and keeps your scheduling), while deleting a card simply stops emitting it.
- Duplicate ids within a note are reported, never silently exported.
- Caveat: the guid currently keys off the note's path, so **renaming a note
  re-keys its cards** (Anki treats them as new). A note-level stable id would
  fix this and is a future improvement.

## Exporting to Anki

**Export → Anki Deck** packages the `[!card]` callouts in the selected scope
(note / folder / tree / whole base) into a `.apkg` file you import into Anki.

- Cards become Basic (Front/Back) notes; the front/back markdown is rendered to
  HTML so formatting survives.
- Decks come from the deck precedence above; Anki rebuilds the `::` hierarchy on
  import.
- Each note carries its stable guid, so **re-importing after edits updates the
  matching cards and preserves their scheduling** instead of duplicating them.
- The summary reports the card count and per-deck breakdown; malformed cards and
  duplicate ids are reported, never silently dropped. An empty scope says "no
  flashcards found" rather than writing an empty file.

Media (images) in cards is a planned follow-up — export is text-first today.
