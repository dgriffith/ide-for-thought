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
Anki card (preserving its review history) instead of duplicating it. Ids are
assigned automatically at export time (#852) — you don't write them by hand,
though you'll see them appended to the callout after the first export.

## Exporting to Anki

The Anki `.apkg` exporter (#853) is a follow-up; once it lands, **Export → Anki
deck** will package the cards in the selected scope (note / folder / tree /
whole base) into a file you import into Anki.
