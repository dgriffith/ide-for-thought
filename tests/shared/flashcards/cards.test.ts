/**
 * Flashcard model + extractor (#851).
 *
 * collectCards parses `[!card]` callouts into front/back/deck/id, resolves the
 * deck by precedence, and skips malformed cards with a warning instead of
 * throwing.
 */

import { describe, it, expect } from 'vitest';
import { collectCards, resolveDeck, folderDeck, DEFAULT_DECK } from '../../../src/shared/flashcards/cards';

describe('collectCards', () => {
  it('parses a blockquote [!card] into front / back', () => {
    const note = [
      '# Geography',
      '',
      '> [!card]',
      '> What is the capital of France?',
      '> ---',
      '> **Paris**',
      '',
      'more prose',
    ].join('\n');
    const { cards, warnings } = collectCards(note, 'geo.md');
    expect(warnings).toEqual([]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      front: 'What is the capital of France?',
      back: '**Paris**',
      sourceLine: 3,
    });
  });

  it('parses the bare (no `>`) form, ending at a blank line', () => {
    const note = '[!card]\nQ front\n---\nA back\n\nnext paragraph';
    const { cards } = collectCards(note, 'x.md');
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Q front');
    expect(cards[0].back).toBe('A back');
  });

  it('preserves multi-line markdown in front and back', () => {
    const note = [
      '> [!card]',
      '> Explain **recursion**:',
      '> - base case',
      '> - recursive step',
      '> ---',
      '> A function that calls itself.',
      '>',
      '> ```js',
      '> f = () => f()',
      '> ```',
    ].join('\n');
    const { cards } = collectCards(note, 'x.md');
    expect(cards[0].front).toBe('Explain **recursion**:\n- base case\n- recursive step');
    expect(cards[0].back).toContain('```js');
    expect(cards[0].back).toContain('f = () => f()');
  });

  it('reads the deck from the callout title', () => {
    const { cards } = collectCards('> [!card] Capitals\n> Q\n> ---\n> A', 'x.md');
    expect(cards[0].deck).toBe('Capitals');
  });

  it('reads a trailing ^id as the card id, keeping the deck clean', () => {
    const { cards } = collectCards('> [!card] Capitals ^abc123\n> Q\n> ---\n> A', 'x.md');
    expect(cards[0].deck).toBe('Capitals');
    expect(cards[0].id).toBe('abc123');
  });

  it('parses an id with no deck', () => {
    const { cards } = collectCards('> [!card] ^abc123\n> Q\n> ---\n> A', 'x.md');
    expect(cards[0].id).toBe('abc123');
  });

  it('collects multiple cards from one note', () => {
    const note = '> [!card]\n> Q1\n> ---\n> A1\n\n> [!card]\n> Q2\n> ---\n> A2\n';
    const { cards } = collectCards(note, 'x.md');
    expect(cards.map((c) => c.front)).toEqual(['Q1', 'Q2']);
  });

  it('skips a card with no divider, recording a warning', () => {
    const { cards, warnings } = collectCards('> [!card]\n> just a front, no answer', 'x.md');
    expect(cards).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ line: 1 });
    expect(warnings[0].message).toContain('divider');
  });

  it('skips a card with an empty back, recording a warning', () => {
    const { cards, warnings } = collectCards('> [!card]\n> Q\n> ---\n>', 'x.md');
    expect(cards).toHaveLength(0);
    expect(warnings[0].message).toContain('empty');
  });

  it('ignores non-card callouts', () => {
    const { cards } = collectCards('> [!note] Heads up\n> not a card\n> ---\n> still not', 'x.md');
    expect(cards).toHaveLength(0);
  });

  it('honors the [!card]+ / [!card]- collapse flags', () => {
    const { cards } = collectCards('> [!card]- Deck\n> Q\n> ---\n> A', 'x.md');
    expect(cards).toHaveLength(1);
    expect(cards[0].deck).toBe('Deck');
  });
});

describe('deck precedence', () => {
  it('callout deck wins over frontmatter and folder', () => {
    expect(resolveDeck('Callout', 'Front', 'a/b/n.md')).toBe('Callout');
  });
  it('frontmatter cardDeck wins over folder when no callout deck', () => {
    expect(resolveDeck(undefined, 'FrontDeck', 'a/b/n.md')).toBe('FrontDeck');
  });
  it('falls back to the folder path mapped to :: hierarchy', () => {
    expect(resolveDeck(undefined, undefined, 'math/algebra/n.md')).toBe('math::algebra');
  });
});

describe('folderDeck', () => {
  it('maps nested folders to a :: deck path', () => {
    expect(folderDeck('a/b/c.md')).toBe('a::b');
  });
  it('uses the default deck for a root-level note', () => {
    expect(folderDeck('note.md')).toBe(DEFAULT_DECK);
  });
});
